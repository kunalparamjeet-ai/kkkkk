import { Router } from 'express';
import { getDb, mutateDb, applyWalletCredit } from '../db/store.ts';
import { encryptSecret, generateId, generateSecureApiKey, maskSecret, sha256 } from '../lib/crypto.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth.ts';
import { isProviderGenuinelyAvailable } from '../services/ai-orchestrator.ts';
import { validateSelfHostedModelHealth } from '../services/model-hosting.ts';
import type { TaskType, UserRole, VektorApiKeyRecord } from '../types.ts';

const router = Router();

router.use(requireAuth, requireRole('admin', 'super_admin'));

router.get('/overview', async (_req, res) => {
  const selfHosted = await validateSelfHostedModelHealth();
  const db = getDb();

  const totalRevenueUsd = db.payments
    .filter((p) => p.status === 'verified')
    .reduce((acc, p) => acc + (p.currency === 'INR' ? p.amount / 83 : p.amount), 0);

  const totalCreditsConsumed = db.wallets.reduce((acc, w) => acc + w.lifetimeCreditsUsed, 0);

  res.json({
    metrics: {
      totalUsers: db.users.length,
      totalProjects: db.projects.length,
      liveDeployments: db.deployments.filter((d) => d.status === 'live').length,
      verifiedDomains: db.customDomains.filter((d) => d.dnsVerified).length,
      totalCreditsConsumed,
      totalRevenueUsd: Math.round(totalRevenueUsd * 100) / 100,
      gatewayRequests: db.gatewayLogs.length,
      errorCount: db.errorLogs.length,
    },
    selfHostedConfig: selfHosted,
    providers: db.aiProviders.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      apiKeyEnvVar: p.apiKeyEnvVar,
      hasCustomKey: Boolean(p.encryptedApiKey),
      maskedKey: maskSecret(p.apiKeyEnvVar ? process.env[p.apiKeyEnvVar] : null),
      enabled: p.enabled,
      available: isProviderGenuinelyAvailable(p),
      status: p.status,
      lastCheckedAt: p.lastCheckedAt,
    })),
    models: db.aiModels,
    routingRules: db.taskRoutingRules,
    plans: db.plans.sort((a, b) => a.sortOrder - b.sortOrder),
    users: db.users.map((u) => {
      const w = db.wallets.find((x) => x.userId === u.id);
      const activeSub = db.subscriptions.find((s) => s.userId === u.id && s.status === 'active');
      const activePlan = activeSub ? db.plans.find((p) => p.id === activeSub.planId) : db.plans.find((p) => p.slug === 'free');
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        onboardingCompleted: u.onboardingCompleted,
        balanceCredits: w?.balanceCredits ?? 0,
        lifetimeCreditsUsed: w?.lifetimeCreditsUsed ?? 0,
        planId: activePlan?.id || 'plan_free',
        planName: activePlan?.name || 'Free',
        createdAt: u.createdAt,
      };
    }),
    payments: db.payments.slice(0, 100),
    subscriptions: db.subscriptions.slice(0, 100).map((s) => {
      const owner = db.users.find((u) => u.id === s.userId);
      const plan = db.plans.find((p) => p.id === s.planId);
      return {
        ...s,
        userEmail: owner?.email || s.userId,
        planName: plan?.name || s.planId,
      };
    }),
    apiKeys: db.vektorApiKeys.map((k) => {
      const owner = db.users.find((u) => u.id === k.userId);
      return {
        id: k.id,
        userId: k.userId,
        userEmail: owner?.email || k.userId,
        name: k.name,
        keyPrefix: k.keyPrefix,
        permissions: k.permissions,
        rateLimitRpm: k.rateLimitRpm,
        isInternal: k.isInternal,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
      };
    }),
    gatewayLogs: db.gatewayLogs.slice(0, 100),
    deployments: db.deployments.slice(0, 100),
    domains: db.customDomains,
    errorLogs: db.errorLogs.slice(0, 100),
  });
});

// Users & Roles (role change restricted to super_admin)
router.patch('/users/:id', (req: AuthenticatedRequest, res) => {
  const actor = req.user!;
  const { role, status, creditAdjustment, adjustmentReason } = req.body || {};

  if (role !== undefined && actor.role !== 'super_admin') {
    res.status(403).json({ error: 'Only super_admin can modify user roles.' });
    return;
  }

  const target = getDb().users.find((u) => u.id === req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  mutateDb((db) => {
    const u = db.users.find((x) => x.id === req.params.id);
    if (!u) return;
    if (role && ['user', 'admin', 'super_admin'].includes(role)) {
      u.role = role as UserRole;
    }
    if (status && ['active', 'suspended'].includes(status)) {
      u.status = status;
    }
    u.updatedAt = new Date().toISOString();
  });

  if (typeof creditAdjustment === 'number' && creditAdjustment !== 0) {
    applyWalletCredit({
      userId: target.id,
      amount: Math.trunc(creditAdjustment),
      type: 'admin_adjustment',
      idempotencyKey: `admin:${actor.id}:${target.id}:${Date.now()}`,
      referenceId: actor.id,
      description: typeof adjustmentReason === 'string' && adjustmentReason ? adjustmentReason : `Admin adjustment by ${actor.email}`,
    });
  }

  res.json({ ok: true });
});

// Assign or update user's active subscription plan
router.put('/users/:id/subscription', (req: AuthenticatedRequest, res) => {
  const actor = req.user!;
  const { planId, status, grantPlanCredits } = req.body || {};
  const db = getDb();
  const targetUser = db.users.find((u) => u.id === req.params.id);
  if (!targetUser) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  const plan = db.plans.find((p) => p.id === planId);
  if (!plan) {
    res.status(404).json({ error: 'Plan not found.' });
    return;
  }

  const now = new Date().toISOString();
  const nextStatus = status === 'canceled' ? 'canceled' : 'active';
  const sub = mutateDb((state) => {
    for (const s of state.subscriptions) {
      if (s.userId === targetUser.id && s.status === 'active') {
        s.status = 'canceled';
      }
    }
    const created = {
      id: generateId('sub'),
      userId: targetUser.id,
      planId: plan.id,
      status: nextStatus as 'active' | 'canceled',
      billingCycle: 'monthly' as const,
      provider: 'internal' as const,
      externalSubscriptionId: null,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      createdAt: now,
    };
    state.subscriptions.unshift(created);
    return created;
  });

  if (grantPlanCredits && nextStatus === 'active' && plan.monthlyCredits > 0) {
    applyWalletCredit({
      userId: targetUser.id,
      amount: plan.monthlyCredits,
      type: 'admin_adjustment',
      idempotencyKey: `admin_sub:${actor.id}:${targetUser.id}:${sub.id}`,
      referenceId: sub.id,
      description: `Admin assigned ${plan.name} plan (${plan.monthlyCredits} credits)`,
    });
  }

  res.json({ subscription: sub });
});

// Plans configuration
router.patch('/plans/:id', (req, res) => {
  const { monthlyPriceUsd, annualPriceUsd, monthlyCredits, maxProjects, rateLimitRpm, dailyRequestLimit, customDomainsEnabled, active } = req.body || {};
  const updated = mutateDb((db) => {
    const plan = db.plans.find((p) => p.id === req.params.id);
    if (!plan) return null;
    if (typeof monthlyPriceUsd === 'number') plan.monthlyPriceUsd = monthlyPriceUsd;
    if (typeof annualPriceUsd === 'number') plan.annualPriceUsd = annualPriceUsd;
    if (typeof monthlyCredits === 'number') plan.monthlyCredits = monthlyCredits;
    if (typeof maxProjects === 'number') plan.maxProjects = maxProjects;
    if (typeof rateLimitRpm === 'number') plan.rateLimitRpm = rateLimitRpm;
    if (typeof dailyRequestLimit === 'number') plan.dailyRequestLimit = dailyRequestLimit;
    if (typeof customDomainsEnabled === 'boolean') plan.customDomainsEnabled = customDomainsEnabled;
    if (typeof active === 'boolean') plan.active = active;
    return plan;
  });
  if (!updated) {
    res.status(404).json({ error: 'Plan not found.' });
    return;
  }
  res.json({ plan: updated });
});

// Refund verified payment
router.post('/payments/:id/refund', (req: AuthenticatedRequest, res) => {
  const payment = getDb().payments.find((p) => p.id === req.params.id);
  if (!payment || payment.status !== 'verified') {
    res.status(400).json({ error: 'Only verified payments can be refunded.' });
    return;
  }
  mutateDb((db) => {
    const p = db.payments.find((x) => x.id === payment.id);
    if (p) p.status = 'refunded';
    const inv = db.invoices.find((i) => i.paymentId === payment.id);
    if (inv) inv.status = 'refunded';
  });
  if (payment.creditsGranted > 0) {
    applyWalletCredit({
      userId: payment.userId,
      amount: -payment.creditsGranted,
      type: 'refund',
      idempotencyKey: `refund:${payment.id}`,
      referenceId: payment.id,
      description: `Refund reversal for payment ${payment.id} by ${req.user!.email}`,
    });
  }
  res.json({ ok: true });
});

// AI Providers & Dynamic Model Registration
router.patch('/providers/:id', (req, res) => {
  const { enabled, baseUrl, apiKey } = req.body || {};
  const updated = mutateDb((db) => {
    const prov = db.aiProviders.find((p) => p.id === req.params.id);
    if (!prov) return null;
    if (typeof enabled === 'boolean') prov.enabled = enabled;
    if (typeof baseUrl === 'string') prov.baseUrl = baseUrl.trim() || null;
    if (typeof apiKey === 'string' && apiKey.trim()) {
      prov.encryptedApiKey = encryptSecret(apiKey.trim());
      prov.status = 'available';
    }
    prov.lastCheckedAt = new Date().toISOString();
    return prov;
  });
  if (!updated) {
    res.status(404).json({ error: 'Provider not found.' });
    return;
  }
  res.json({ ok: true });
});

router.post('/models', (req, res) => {
  const { providerId, modelIdentifier, displayName, roleTag, inputCreditsPer1k, outputCreditsPer1k, isPreferredCoding } = req.body || {};
  if (typeof providerId !== 'string' || typeof modelIdentifier !== 'string' || typeof displayName !== 'string') {
    res.status(400).json({ error: 'providerId, modelIdentifier, and displayName are required.' });
    return;
  }
  const db = getDb();
  if (!db.aiProviders.some((p) => p.id === providerId)) {
    res.status(404).json({ error: 'Provider not found.' });
    return;
  }
  const model = mutateDb((state) => {
    const rec = {
      id: modelIdentifier.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      providerId,
      modelIdentifier: modelIdentifier.trim(),
      displayName: displayName.trim(),
      roleTag: typeof roleTag === 'string' && roleTag ? roleTag.trim() : 'Custom Model',
      inputCreditsPer1k: typeof inputCreditsPer1k === 'number' ? inputCreditsPer1k : 1.0,
      outputCreditsPer1k: typeof outputCreditsPer1k === 'number' ? outputCreditsPer1k : 2.0,
      maxContextTokens: 128000,
      supportsStreaming: true,
      enabled: true,
      isPreferredCoding: Boolean(isPreferredCoding),
    };
    state.aiModels.push(rec);
    return rec;
  });
  res.status(201).json({ model });
});

router.patch('/models/:id', (req, res) => {
  const { enabled, inputCreditsPer1k, outputCreditsPer1k, isPreferredCoding } = req.body || {};
  const updated = mutateDb((db) => {
    const m = db.aiModels.find((x) => x.id === req.params.id);
    if (!m) return null;
    if (typeof enabled === 'boolean') m.enabled = enabled;
    if (typeof inputCreditsPer1k === 'number') m.inputCreditsPer1k = inputCreditsPer1k;
    if (typeof outputCreditsPer1k === 'number') m.outputCreditsPer1k = outputCreditsPer1k;
    if (typeof isPreferredCoding === 'boolean') m.isPreferredCoding = isPreferredCoding;
    return m;
  });
  if (!updated) {
    res.status(404).json({ error: 'Model not found.' });
    return;
  }
  res.json({ model: updated });
});

// Configurable Task Delegation Routing
router.put('/routing/:taskType', (req, res) => {
  const taskType = req.params.taskType as TaskType;
  const { primaryModelId, fallbackModelId } = req.body || {};
  const updated = mutateDb((db) => {
    const rule = db.taskRoutingRules.find((r) => r.taskType === taskType);
    if (!rule) return null;
    if (typeof primaryModelId === 'string') rule.primaryModelId = primaryModelId;
    if (fallbackModelId === null || typeof fallbackModelId === 'string') rule.fallbackModelId = fallbackModelId;
    rule.updatedAt = new Date().toISOString();
    return rule;
  });
  if (!updated) {
    res.status(404).json({ error: 'Routing rule not found.' });
    return;
  }
  res.json({ rule: updated });
});

// Self-Hosted VEKTOR Model Hosting config & health check
router.put('/self-hosted', async (req, res) => {
  const { modelName, inferenceServerUrl, weightsPath } = req.body || {};
  mutateDb((db) => {
    if (typeof modelName === 'string' && modelName.trim()) {
      db.selfHostedConfig.modelName = modelName.trim();
    }
    if (typeof inferenceServerUrl === 'string') {
      db.selfHostedConfig.inferenceServerUrl = inferenceServerUrl.trim();
    }
    if (typeof weightsPath === 'string') {
      db.selfHostedConfig.weightsPath = weightsPath.trim();
    }
  });
  const checked = await validateSelfHostedModelHealth();
  res.json({ selfHostedConfig: checked });
});

router.post('/self-hosted/health', async (_req, res) => {
  const checked = await validateSelfHostedModelHealth();
  res.json({ selfHostedConfig: checked });
});

router.post('/self-hosted/register-discovered', (req, res) => {
  const { modelIdentifier, displayName, roleTag, isPreferredCoding } = req.body || {};
  if (typeof modelIdentifier !== 'string' || !modelIdentifier.trim()) {
    res.status(400).json({ error: 'modelIdentifier is required.' });
    return;
  }
  const cleanIdentifier = modelIdentifier.trim();
  const cleanId = cleanIdentifier.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

  const model = mutateDb((state) => {
    const existing = state.aiModels.find(
      (m) => m.id === cleanId || (m.providerId === 'prov_vektor_self_hosted' && m.modelIdentifier === cleanIdentifier)
    );
    if (existing) {
      existing.enabled = true;
      if (typeof displayName === 'string' && displayName.trim()) {
        existing.displayName = displayName.trim();
      }
      if (typeof isPreferredCoding === 'boolean') {
        existing.isPreferredCoding = isPreferredCoding;
      }
      return existing;
    }

    const created = {
      id: cleanId,
      providerId: 'prov_vektor_self_hosted',
      modelIdentifier: cleanIdentifier,
      displayName:
        typeof displayName === 'string' && displayName.trim()
          ? displayName.trim()
          : `VEKTOR Self-Hosted (${cleanIdentifier})`,
      roleTag: typeof roleTag === 'string' && roleTag.trim() ? roleTag.trim() : 'Self-Hosted Open-Source Model',
      inputCreditsPer1k: 0.4,
      outputCreditsPer1k: 0.8,
      maxContextTokens: 128000,
      supportsStreaming: true,
      enabled: true,
      isPreferredCoding: Boolean(isPreferredCoding),
    };
    state.aiModels.push(created);
    return created;
  });

  res.status(201).json({ model });
});

router.post('/api-keys', (req, res) => {
  const { userId, name, permissions, rateLimitRpm, expiresInDays } = req.body || {};
  if (typeof userId !== 'string' || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'userId and key name are required.' });
    return;
  }
  const db = getDb();
  const owner = db.users.find((u) => u.id === userId);
  if (!owner) {
    res.status(404).json({ error: 'Target user not found.' });
    return;
  }
  const rawKey = generateSecureApiKey();
  const expiresAt =
    typeof expiresInDays === 'number' && expiresInDays > 0
      ? new Date(Date.now() + Math.min(Math.trunc(expiresInDays), 3650) * 86400000).toISOString()
      : null;

  const keyRec: VektorApiKeyRecord = {
    id: generateId('vkey'),
    userId: owner.id,
    name: name.trim().slice(0, 60),
    keyPrefix: rawKey.slice(0, 16),
    keyHash: sha256(rawKey),
    permissions: Array.isArray(permissions) && permissions.length > 0 ? permissions.map(String) : ['chat.completions', 'models.read', 'usage.read'],
    rateLimitRpm: typeof rateLimitRpm === 'number' && rateLimitRpm > 0 ? Math.trunc(rateLimitRpm) : 60,
    isInternal: false,
    expiresAt,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };

  mutateDb((state) => {
    state.vektorApiKeys.unshift(keyRec);
  });

  res.status(201).json({
    key: {
      id: keyRec.id,
      userId: keyRec.userId,
      userEmail: owner.email,
      name: keyRec.name,
      keyPrefix: keyRec.keyPrefix,
      permissions: keyRec.permissions,
      rateLimitRpm: keyRec.rateLimitRpm,
      expiresAt: keyRec.expiresAt,
      createdAt: keyRec.createdAt,
    },
    plaintextKey: rawKey,
  });
});

router.patch('/api-keys/:id', (req, res) => {
  const { name, rateLimitRpm, permissions, expiresAt } = req.body || {};
  const updated = mutateDb((db) => {
    const k = db.vektorApiKeys.find((x) => x.id === req.params.id);
    if (!k) return null;
    if (typeof name === 'string' && name.trim()) k.name = name.trim().slice(0, 60);
    if (typeof rateLimitRpm === 'number' && rateLimitRpm > 0) k.rateLimitRpm = Math.trunc(rateLimitRpm);
    if (Array.isArray(permissions) && permissions.length > 0) k.permissions = permissions.map(String);
    if (expiresAt === null || typeof expiresAt === 'string') k.expiresAt = expiresAt;
    return k;
  });
  if (!updated) {
    res.status(404).json({ error: 'API key not found.' });
    return;
  }
  res.json({
    key: {
      id: updated.id,
      name: updated.name,
      keyPrefix: updated.keyPrefix,
      permissions: updated.permissions,
      rateLimitRpm: updated.rateLimitRpm,
      expiresAt: updated.expiresAt,
      revokedAt: updated.revokedAt,
    },
  });
});

router.post('/api-keys/:id/regenerate', (req, res) => {
  const newRawKey = generateSecureApiKey();
  const updated = mutateDb((db) => {
    const k = db.vektorApiKeys.find((x) => x.id === req.params.id);
    if (!k || k.revokedAt) return null;
    k.keyPrefix = newRawKey.slice(0, 16);
    k.keyHash = sha256(newRawKey);
    return k;
  });
  if (!updated) {
    res.status(404).json({ error: 'Active API key not found.' });
    return;
  }
  res.json({
    key: {
      id: updated.id,
      name: updated.name,
      keyPrefix: updated.keyPrefix,
      permissions: updated.permissions,
      rateLimitRpm: updated.rateLimitRpm,
    },
    plaintextKey: newRawKey,
  });
});

router.delete('/api-keys/:id', (req, res) => {
  const revoked = mutateDb((db) => {
    const k = db.vektorApiKeys.find((x) => x.id === req.params.id);
    if (!k) return false;
    k.revokedAt = new Date().toISOString();
    return true;
  });
  if (!revoked) {
    res.status(404).json({ error: 'API key not found.' });
    return;
  }
  res.json({ ok: true });
});

export default router;
