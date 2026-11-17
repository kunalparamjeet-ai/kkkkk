import { Router, type Request, type Response } from 'express';
import { getDb, mutateDb, applyWalletCredit, getOrCreateWallet, logSystemError } from '../db/store.ts';
import { generateId, generateSecureApiKey, sha256 } from '../lib/crypto.ts';
import { requireAuth, resolveSessionUser, type AuthenticatedRequest } from '../middleware/auth.ts';
import {
  calculateCreditCost,
} from '../services/ai-orchestrator.ts';
import {
  executeEngineCompletion,
  executeEngineEmbedding,
  isProviderGenuinelyAvailable,
  resolveEngineRoute,
  streamEngineCompletion,
} from '../engine/router.ts';
import type { EngineChatMessage } from '../engine/types.ts';
import { validateSelfHostedModelHealth } from '../services/model-hosting.ts';
import type { GatewayLogRecord, PlanRecord, VektorApiKeyRecord } from '../types.ts';

export const keysRouter = Router();
export const gatewayV1Router = Router();

export const ALLOWED_API_SCOPES = [
  'chat.completions',
  'embeddings',
  'models.read',
  'usage.read',
] as const;

// In-memory sliding window rate limit tracker per key ID
const rateWindowMap = new Map<string, number[]>();

function checkRateLimit(
  keyId: string,
  limitRpm: number
): { allowed: boolean; limit: number; remaining: number; resetSeconds: number } {
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (rateWindowMap.get(keyId) || []).filter((ts) => ts > windowStart);
  const oldest = timestamps[0] ?? now;
  const resetSeconds = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));

  if (timestamps.length >= limitRpm) {
    rateWindowMap.set(keyId, timestamps);
    return { allowed: false, limit: limitRpm, remaining: 0, resetSeconds };
  }
  timestamps.push(now);
  rateWindowMap.set(keyId, timestamps);
  return {
    allowed: true,
    limit: limitRpm,
    remaining: Math.max(0, limitRpm - timestamps.length),
    resetSeconds,
  };
}

function getUserPlanLimits(userId: string): {
  plan: PlanRecord | null;
  rateLimitRpm: number;
  dailyRequestLimit: number;
} {
  const db = getDb();
  const sub = db.subscriptions.find((s) => s.userId === userId && s.status === 'active');
  const plan =
    (sub ? db.plans.find((p) => p.id === sub.planId) : null) ||
    db.plans.find((p) => p.slug === 'free') ||
    null;
  return {
    plan,
    rateLimitRpm: plan?.rateLimitRpm ?? 20,
    dailyRequestLimit: plan?.dailyRequestLimit ?? 200,
  };
}

function getDailyRequestUsage(userId: string): number {
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const db = getDb();
  return db.gatewayLogs.filter(
    (l) => l.userId === userId && l.createdAt.startsWith(todayPrefix)
  ).length;
}

function sanitizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...ALLOWED_API_SCOPES];
  const valid = raw
    .map(String)
    .filter((p) => (ALLOWED_API_SCOPES as readonly string[]).includes(p));
  return valid.length > 0 ? Array.from(new Set(valid)) : [...ALLOWED_API_SCOPES];
}

function buildUsageAnalytics(userLogs: GatewayLogRecord[]) {
  // 14-day daily time series
  const dayBuckets = new Map<
    string,
    { date: string; requests: number; okRequests: number; errorRequests: number; tokens: number; credits: number }
  >();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    dayBuckets.set(d, { date: d, requests: 0, okRequests: 0, errorRequests: 0, tokens: 0, credits: 0 });
  }

  const byModelMap = new Map<string, { model: string; requests: number; tokens: number; credits: number }>();

  for (const log of userLogs) {
    const day = log.createdAt.slice(0, 10);
    const bucket = dayBuckets.get(day);
    const tokens = log.promptTokens + log.completionTokens;
    if (bucket) {
      bucket.requests += 1;
      if (log.statusCode >= 400) bucket.errorRequests += 1;
      else bucket.okRequests += 1;
      bucket.tokens += tokens;
      bucket.credits += log.creditsCharged;
    }

    const modelKey = log.routedModel || log.requestedModel;
    const mEntry = byModelMap.get(modelKey) || { model: modelKey, requests: 0, tokens: 0, credits: 0 };
    mEntry.requests += 1;
    mEntry.tokens += tokens;
    mEntry.credits += log.creditsCharged;
    byModelMap.set(modelKey, mEntry);
  }

  return {
    usageByDay: Array.from(dayBuckets.values()),
    usageByModel: Array.from(byModelMap.values()).sort((a, b) => b.requests - a.requests),
  };
}

keysRouter.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const wallet = getOrCreateWallet(user.id);
  const { plan, rateLimitRpm, dailyRequestLimit } = getUserPlanLimits(user.id);
  const activeSub = db.subscriptions.find((s) => s.userId === user.id && s.status === 'active') || null;
  const userLogs = db.gatewayLogs.filter((l) => l.userId === user.id);

  const keyStatsMap = new Map<string, { requestsCount: number; tokensUsed: number; creditsUsed: number }>();
  for (const l of userLogs) {
    if (!l.apiKeyId) continue;
    const cur = keyStatsMap.get(l.apiKeyId) || { requestsCount: 0, tokensUsed: 0, creditsUsed: 0 };
    cur.requestsCount += 1;
    cur.tokensUsed += l.promptTokens + l.completionTokens;
    cur.creditsUsed += l.creditsCharged;
    keyStatsMap.set(l.apiKeyId, cur);
  }

  const keys = db.vektorApiKeys
    .filter((k) =>
      user.role === 'super_admin'
        ? k.userId === user.id || k.isInternal
        : k.userId === user.id && !k.isInternal
    )
    .map((k) => {
      const stats = keyStatsMap.get(k.id) || { requestsCount: 0, tokensUsed: 0, creditsUsed: 0 };
      return {
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        permissions: k.permissions,
        rateLimitRpm: k.rateLimitRpm,
        isInternal: k.isInternal,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
        requestsCount: stats.requestsCount,
        tokensUsed: stats.tokensUsed,
        creditsUsed: stats.creditsUsed,
      };
    });

  const requestsToday = getDailyRequestUsage(user.id);
  const totalRequests = userLogs.length;
  const totalTokens = userLogs.reduce((acc, l) => acc + l.promptTokens + l.completionTokens, 0);
  const avgLatencyMs =
    totalRequests > 0
      ? Math.round(userLogs.reduce((acc, l) => acc + l.latencyMs, 0) / totalRequests)
      : 0;
  const successCount = userLogs.filter((l) => l.statusCode < 400).length;
  const successRatePct = totalRequests > 0 ? Math.round((successCount / totalRequests) * 100) : 100;

  const { usageByDay, usageByModel } = buildUsageAnalytics(userLogs);
  const plans = db.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);

  const sh = db.selfHostedConfig;
  const selfHostedStatus = {
    installed: sh.status === 'healthy',
    configured: Boolean(sh.inferenceServerUrl),
    status: sh.status,
    modelName: sh.modelName,
    discoveredModels: sh.discoveredModels || [],
    runtimeDetected: sh.runtimeDetected || null,
    latencyMs: sh.latencyMs ?? null,
    lastCheckedAt: sh.lastCheckedAt,
    message: sh.lastMessage,
  };

  // Expose VEKTOR model catalog with honest installation/readiness flags & zero third-party keys
  const models = db.aiModels
    .filter((m) => m.enabled)
    .map((m) => {
      const prov = db.aiProviders.find((p) => p.id === m.providerId);
      const isSelfHosted = prov?.kind === 'vektor_self_hosted';
      const available = prov ? isProviderGenuinelyAvailable(prov) : false;
      return {
        id: m.id,
        displayName: m.displayName,
        roleTag: m.roleTag,
        engineTier: isSelfHosted ? 'self_hosted' : 'managed_cloud',
        installed: isSelfHosted ? selfHostedStatus.installed : available,
        available,
        inputCreditsPer1k: m.inputCreditsPer1k,
        outputCreditsPer1k: m.outputCreditsPer1k,
      };
    });

  const invoices = db.invoices.filter((i) => i.userId === user.id).slice(0, 20);

  res.json({
    keys,
    logs: userLogs.slice(0, 100),
    usageSummary: {
      creditsRemaining: wallet.balanceCredits,
      lifetimeCreditsUsed: wallet.lifetimeCreditsUsed,
      lowCreditThreshold: wallet.lowCreditThreshold,
      requestsToday,
      dailyRequestLimit,
      totalRequests,
      totalTokens,
      avgLatencyMs,
      successRatePct,
      rateLimitRpm,
      activePlan: plan
        ? {
            id: plan.id,
            slug: plan.slug,
            name: plan.name,
            monthlyCredits: plan.monthlyCredits,
            rateLimitRpm: plan.rateLimitRpm,
            dailyRequestLimit: plan.dailyRequestLimit,
          }
        : null,
      subscriptionPeriodEnd: activeSub?.currentPeriodEnd || null,
    },
    usageByDay,
    usageByModel,
    selfHostedStatus,
    models,
    plans,
    invoices,
    gateways: {
      razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  });
});

keysRouter.post('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { name, permissions, rateLimitRpm, expiresInDays } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'API key name is required.' });
    return;
  }

  const { rateLimitRpm: maxRpm } = getUserPlanLimits(user.id);
  const requestedRpm =
    typeof rateLimitRpm === 'number' && Number.isFinite(rateLimitRpm)
      ? Math.max(1, Math.min(Math.trunc(rateLimitRpm), maxRpm))
      : maxRpm;

  let expiresAt: string | null = null;
  if (typeof expiresInDays === 'number' && Number.isFinite(expiresInDays) && expiresInDays > 0) {
    const clampedDays = Math.min(Math.trunc(expiresInDays), 3650);
    expiresAt = new Date(Date.now() + clampedDays * 86400000).toISOString();
  }

  const rawKey = generateSecureApiKey();
  const keyRecord: VektorApiKeyRecord = {
    id: generateId('vkey'),
    userId: user.id,
    name: name.trim().slice(0, 60),
    keyPrefix: rawKey.slice(0, 16),
    keyHash: sha256(rawKey),
    permissions: sanitizePermissions(permissions),
    rateLimitRpm: requestedRpm,
    isInternal: false,
    expiresAt,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
  };

  mutateDb((state) => {
    state.vektorApiKeys.unshift(keyRecord);
  });

  res.status(201).json({
    key: {
      id: keyRecord.id,
      name: keyRecord.name,
      keyPrefix: keyRecord.keyPrefix,
      permissions: keyRecord.permissions,
      rateLimitRpm: keyRecord.rateLimitRpm,
      expiresAt: keyRecord.expiresAt,
      revokedAt: keyRecord.revokedAt,
      lastUsedAt: keyRecord.lastUsedAt,
      createdAt: keyRecord.createdAt,
    },
    plaintextKey: rawKey,
  });
});

keysRouter.patch('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { name, permissions, rateLimitRpm, expiresInDays } = req.body || {};
  const { rateLimitRpm: maxRpm } = getUserPlanLimits(user.id);

  const updated = mutateDb((db) => {
    const existing = db.vektorApiKeys.find(
      (k) => k.id === req.params.id && (k.userId === user.id || user.role === 'super_admin')
    );
    if (!existing || existing.revokedAt) return null;

    if (typeof name === 'string' && name.trim()) {
      existing.name = name.trim().slice(0, 60);
    }
    if (Array.isArray(permissions)) {
      existing.permissions = sanitizePermissions(permissions);
    }
    if (typeof rateLimitRpm === 'number' && Number.isFinite(rateLimitRpm) && rateLimitRpm > 0) {
      existing.rateLimitRpm =
        user.role === 'super_admin' && existing.isInternal
          ? Math.trunc(rateLimitRpm)
          : Math.max(1, Math.min(Math.trunc(rateLimitRpm), maxRpm));
    }
    if (expiresInDays === null) {
      existing.expiresAt = null;
    } else if (typeof expiresInDays === 'number' && Number.isFinite(expiresInDays) && expiresInDays > 0) {
      const clampedDays = Math.min(Math.trunc(expiresInDays), 3650);
      existing.expiresAt = new Date(Date.now() + clampedDays * 86400000).toISOString();
    }
    return existing;
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
      expiresAt: updated.expiresAt,
      revokedAt: updated.revokedAt,
      lastUsedAt: updated.lastUsedAt,
      createdAt: updated.createdAt,
    },
  });
});

keysRouter.post('/:id/rotate', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const newRawKey = generateSecureApiKey();
  const rotated = mutateDb((db) => {
    const existing = db.vektorApiKeys.find(
      (k) => k.id === req.params.id && (k.userId === user.id || user.role === 'super_admin')
    );
    if (!existing || existing.revokedAt) return null;
    existing.keyPrefix = newRawKey.slice(0, 16);
    existing.keyHash = sha256(newRawKey);
    return existing;
  });
  if (!rotated) {
    res.status(404).json({ error: 'Active API key not found.' });
    return;
  }
  res.json({
    key: {
      id: rotated.id,
      name: rotated.name,
      keyPrefix: rotated.keyPrefix,
      permissions: rotated.permissions,
      rateLimitRpm: rotated.rateLimitRpm,
      expiresAt: rotated.expiresAt,
      revokedAt: rotated.revokedAt,
      lastUsedAt: rotated.lastUsedAt,
      createdAt: rotated.createdAt,
    },
    plaintextKey: newRawKey,
  });
});

keysRouter.delete('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const revoked = mutateDb((db) => {
    const existing = db.vektorApiKeys.find(
      (k) => k.id === req.params.id && (k.userId === user.id || user.role === 'super_admin')
    );
    if (!existing) return false;
    existing.revokedAt = new Date().toISOString();
    return true;
  });
  if (!revoked) {
    res.status(404).json({ error: 'API key not found.' });
    return;
  }
  res.json({ ok: true });
});

function extractApiKeyFromRequest(req: Request): string | null {
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.trim()) {
    return xApiKey.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && !token.startsWith('vk_sess_')) {
      return token;
    }
  }
  return null;
}

// Authenticate /v1/* requests via VEKTOR API Key (Bearer or x-api-key) OR active user session
function authenticateGatewayRequest(
  req: Request,
  res: Response,
  requiredScope?: string
): {
  userId: string;
  apiKey: VektorApiKeyRecord | null;
  error?: string;
  status?: number;
  errorType?: string;
} {
  const rawKey = extractApiKeyFromRequest(req);
  if (rawKey) {
    const keyHash = sha256(rawKey);
    const db = getDb();
    const keyRec = db.vektorApiKeys.find((k) => k.keyHash === keyHash);
    if (!keyRec) {
      return { userId: '', apiKey: null, error: 'Invalid VEKTOR API key.', status: 401, errorType: 'authentication_error' };
    }
    if (keyRec.revokedAt) {
      return { userId: '', apiKey: null, error: 'This VEKTOR API key has been revoked.', status: 401, errorType: 'authentication_error' };
    }
    if (keyRec.expiresAt && Date.parse(keyRec.expiresAt) <= Date.now()) {
      return { userId: '', apiKey: null, error: 'This VEKTOR API key has expired.', status: 401, errorType: 'authentication_error' };
    }

    const owner = db.users.find((u) => u.id === keyRec.userId);
    if (!owner || owner.status !== 'active') {
      return { userId: '', apiKey: null, error: 'API key owner account is suspended or missing.', status: 403, errorType: 'permission_error' };
    }

    if (requiredScope && !keyRec.permissions.includes(requiredScope)) {
      return {
        userId: '',
        apiKey: keyRec,
        error: `API key lacks ${requiredScope} permission.`,
        status: 403,
        errorType: 'permission_error',
      };
    }

    const planLimits = getUserPlanLimits(keyRec.userId);
    const effectiveRpm = keyRec.isInternal
      ? keyRec.rateLimitRpm
      : Math.min(keyRec.rateLimitRpm, planLimits.rateLimitRpm);

    const rl = checkRateLimit(keyRec.id, effectiveRpm);
    res.setHeader('X-RateLimit-Limit', String(rl.limit));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    res.setHeader('X-RateLimit-Reset', String(rl.resetSeconds));

    if (!rl.allowed) {
      return {
        userId: '',
        apiKey: keyRec,
        error: `Rate limit exceeded (${effectiveRpm} RPM). Retry in ${rl.resetSeconds}s.`,
        status: 429,
        errorType: 'rate_limit_error',
      };
    }

    const usedToday = getDailyRequestUsage(keyRec.userId);
    res.setHeader('X-DailyLimit-Limit', String(planLimits.dailyRequestLimit));
    res.setHeader('X-DailyLimit-Remaining', String(Math.max(0, planLimits.dailyRequestLimit - usedToday)));
    if (!keyRec.isInternal && usedToday >= planLimits.dailyRequestLimit) {
      return {
        userId: '',
        apiKey: keyRec,
        error: `Daily request limit exceeded (${planLimits.dailyRequestLimit}/day on your plan). Upgrade plan to increase quota.`,
        status: 429,
        errorType: 'rate_limit_error',
      };
    }

    mutateDb((state) => {
      const k = state.vektorApiKeys.find((x) => x.id === keyRec.id);
      if (k) k.lastUsedAt = new Date().toISOString();
    });
    return { userId: keyRec.userId, apiKey: keyRec };
  }

  const session = resolveSessionUser(req);
  if (session) {
    if (session.user.status !== 'active') {
      return { userId: '', apiKey: null, error: 'User account is suspended.', status: 403, errorType: 'permission_error' };
    }
    const planLimits = getUserPlanLimits(session.user.id);
    const usedToday = getDailyRequestUsage(session.user.id);
    res.setHeader('X-RateLimit-Limit', String(planLimits.rateLimitRpm));
    res.setHeader('X-DailyLimit-Limit', String(planLimits.dailyRequestLimit));
    res.setHeader('X-DailyLimit-Remaining', String(Math.max(0, planLimits.dailyRequestLimit - usedToday)));
    return { userId: session.user.id, apiKey: null };
  }
  return {
    userId: '',
    apiKey: null,
    error: 'Missing Authorization: Bearer vk_live_... or x-api-key header.',
    status: 401,
    errorType: 'authentication_error',
  };
}

gatewayV1Router.get('/health', async (_req, res) => {
  const selfHosted = await validateSelfHostedModelHealth();
  const db = getDb();
  const selfHostedInstalled = selfHosted.status === 'healthy';
  const managedEnginesReady = db.aiProviders.filter(
    (p) => p.kind !== 'vektor_self_hosted' && isProviderGenuinelyAvailable(p)
  ).length;

  res.json({
    status: selfHostedInstalled || managedEnginesReady > 0 ? 'ok' : 'degraded',
    service: 'vektor-api-gateway',
    timestamp: new Date().toISOString(),
    engines: {
      selfHostedReady: selfHostedInstalled,
      managedCloudReadyCount: managedEnginesReady,
    },
    selfHostedEngine: {
      installed: selfHostedInstalled,
      configured: Boolean(selfHosted.inferenceServerUrl),
      modelName: selfHosted.modelName,
      status: selfHosted.status,
      runtimeDetected: selfHosted.runtimeDetected || null,
      discoveredModels: selfHosted.discoveredModels || [],
      latencyMs: selfHosted.latencyMs ?? null,
      message: selfHosted.lastMessage,
    },
  });
});

gatewayV1Router.get('/models', (req, res) => {
  const auth = authenticateGatewayRequest(req, res, 'models.read');
  if (auth.error) {
    res.status(auth.status || 401).json({ error: { message: auth.error, type: auth.errorType || 'authentication_error' } });
    return;
  }

  const db = getDb();
  const catalog = db.aiModels
    .filter((m) => m.enabled)
    .map((m) => {
      const prov = db.aiProviders.find((p) => p.id === m.providerId);
      const isSelfHosted = prov?.kind === 'vektor_self_hosted';
      const ready = prov ? isProviderGenuinelyAvailable(prov) : false;
      return {
        id: m.id,
        object: 'model',
        owned_by: 'vektor-ai',
        display_name: m.displayName,
        role_tag: m.roleTag,
        engine_tier: isSelfHosted ? 'self_hosted' : 'managed_cloud',
        installed: isSelfHosted ? db.selfHostedConfig.status === 'healthy' : ready,
        available: ready,
        supports_streaming: m.supportsStreaming,
        max_context_tokens: m.maxContextTokens,
        input_credits_per_1k: m.inputCreditsPer1k,
        output_credits_per_1k: m.outputCreditsPer1k,
      };
    });

  const anyEngineReady = catalog.some((m) => m.available);
  const data = [
    {
      id: 'vektor-auto',
      object: 'model',
      owned_by: 'vektor-ai',
      display_name: 'VEKTOR Auto Router',
      role_tag: 'Intelligent Engine Router (Self-Hosted Preferred)',
      engine_tier: db.selfHostedConfig.status === 'healthy' ? 'self_hosted' : 'managed_cloud',
      installed: anyEngineReady,
      available: anyEngineReady,
      supports_streaming: true,
      max_context_tokens: 128000,
      input_credits_per_1k: 1.0,
      output_credits_per_1k: 2.0,
    },
    ...catalog,
  ];

  res.json({ object: 'list', data });
});

gatewayV1Router.get('/models/:modelId', (req, res) => {
  const auth = authenticateGatewayRequest(req, res, 'models.read');
  if (auth.error) {
    res.status(auth.status || 401).json({ error: { message: auth.error, type: auth.errorType || 'authentication_error' } });
    return;
  }

  const db = getDb();
  const targetId = req.params.modelId;
  if (targetId === 'vektor-auto' || targetId === 'vektor-core-1') {
    const anyReady = db.aiProviders.some((p) => isProviderGenuinelyAvailable(p));
    res.json({
      id: targetId,
      object: 'model',
      owned_by: 'vektor-ai',
      display_name: 'VEKTOR Auto Router',
      engine_tier: db.selfHostedConfig.status === 'healthy' ? 'self_hosted' : 'managed_cloud',
      installed: anyReady,
      available: anyReady,
    });
    return;
  }

  const model = db.aiModels.find((m) => m.id === targetId && m.enabled);
  if (!model) {
    res.status(404).json({ error: { message: `Model "${targetId}" not found.`, type: 'invalid_request_error' } });
    return;
  }
  const prov = db.aiProviders.find((p) => p.id === model.providerId);
  const isSelfHosted = prov?.kind === 'vektor_self_hosted';
  const ready = prov ? isProviderGenuinelyAvailable(prov) : false;

  res.json({
    id: model.id,
    object: 'model',
    owned_by: 'vektor-ai',
    display_name: model.displayName,
    role_tag: model.roleTag,
    engine_tier: isSelfHosted ? 'self_hosted' : 'managed_cloud',
    installed: isSelfHosted ? db.selfHostedConfig.status === 'healthy' : ready,
    available: ready,
    supports_streaming: model.supportsStreaming,
    max_context_tokens: model.maxContextTokens,
    input_credits_per_1k: model.inputCreditsPer1k,
    output_credits_per_1k: model.outputCreditsPer1k,
  });
});

gatewayV1Router.get('/usage', (req, res) => {
  const auth = authenticateGatewayRequest(req, res, 'usage.read');
  if (auth.error) {
    res.status(auth.status || 401).json({ error: { message: auth.error, type: auth.errorType || 'authentication_error' } });
    return;
  }

  const db = getDb();
  const wallet = getOrCreateWallet(auth.userId);
  const { plan, rateLimitRpm, dailyRequestLimit } = getUserPlanLimits(auth.userId);
  const userLogs = db.gatewayLogs.filter((l) => l.userId === auth.userId);
  const requestsToday = getDailyRequestUsage(auth.userId);
  const totalTokens = userLogs.reduce((acc, l) => acc + l.promptTokens + l.completionTokens, 0);
  const totalCreditsCharged = userLogs.reduce((acc, l) => acc + l.creditsCharged, 0);
  const { usageByDay, usageByModel } = buildUsageAnalytics(userLogs);

  res.json({
    object: 'usage_summary',
    plan: plan ? { id: plan.id, slug: plan.slug, name: plan.name } : null,
    credits: {
      balance: wallet.balanceCredits,
      lifetime_used: wallet.lifetimeCreditsUsed,
      gateway_credits_charged: totalCreditsCharged,
    },
    limits: {
      rate_limit_rpm: auth.apiKey ? Math.min(auth.apiKey.rateLimitRpm, rateLimitRpm) : rateLimitRpm,
      daily_request_limit: dailyRequestLimit,
      requests_today: requestsToday,
      daily_requests_remaining: Math.max(0, dailyRequestLimit - requestsToday),
    },
    totals: {
      requests: userLogs.length,
      tokens: totalTokens,
    },
    by_model: usageByModel,
    by_day: usageByDay,
    recent_requests: userLogs.slice(0, 20).map((l) => ({
      id: l.id,
      endpoint: l.endpoint,
      requested_model: l.requestedModel,
      routed_model: l.routedModel,
      tokens: l.promptTokens + l.completionTokens,
      credits_charged: l.creditsCharged,
      latency_ms: l.latencyMs,
      status_code: l.statusCode,
      created_at: l.createdAt,
    })),
  });
});

gatewayV1Router.post('/chat/completions', async (req, res) => {
  const start = Date.now();
  const reqId = generateId('chatcmpl');
  res.setHeader('X-Request-Id', reqId);

  const auth = authenticateGatewayRequest(req, res, 'chat.completions');
  if (auth.error) {
    res.status(auth.status || 401).json({ error: { message: auth.error, type: auth.errorType || 'authentication_error' } });
    return;
  }

  const { model: requestedModel, messages, stream, temperature, max_tokens, allow_fallback } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { message: 'messages array is required.', type: 'invalid_request_error' } });
    return;
  }

  const wallet = getOrCreateWallet(auth.userId);
  if (wallet.balanceCredits < 2) {
    res.status(402).json({ error: { message: 'Insufficient credits in wallet.', type: 'insufficient_quota' } });
    return;
  }

  const modelId = typeof requestedModel === 'string' && requestedModel ? requestedModel.trim() : 'vektor-auto';
  const taskType = modelId.includes('coder') ? 'coding' : 'orchestration';

  // Strict honesty: if user explicitly requests a self-hosted model when no self-hosted server is installed/healthy
  // and did NOT pass allow_fallback: true, return 503 instead of silently substituting another model.
  const routeOutcome = resolveEngineRoute({
    taskType,
    requestedModelId: modelId,
    allowFallbackOnExplicitSelfHosted: Boolean(allow_fallback) || modelId === 'vektor-auto' || modelId === 'vektor-core-1',
  });

  if (!routeOutcome.route) {
    const errMsg = routeOutcome.errorMessage || 'No configured AI engine is currently available on the server.';
    res.status(503).json({
      error: {
        message: errMsg,
        type: routeOutcome.errorCode || 'provider_unavailable',
      },
    });
    return;
  }

  const resolved = routeOutcome.route;

  const normalizedMessages: EngineChatMessage[] = messages.map((m: { role?: unknown; content?: unknown }) => ({
    role: m.role === 'system' || m.role === 'assistant' ? m.role : 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
  }));

  const systemMessages = normalizedMessages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const conversationPrompt = normalizedMessages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n');

  const engineReq = {
    model: resolved.model,
    provider: resolved.provider,
    systemInstruction: systemMessages || 'You are VEKTOR AI, a senior full-stack software engineering assistant.',
    prompt: conversationPrompt,
    messages: normalizedMessages,
    temperature: typeof temperature === 'number' ? temperature : undefined,
    maxTokens: typeof max_tokens === 'number' ? max_tokens : undefined,
  };

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    const createdTs = Math.floor(Date.now() / 1000);
    let sentRole = false;

    try {
      const result = await streamEngineCompletion(
        { ...engineReq, signal: abortController.signal },
        {
          onDelta: (delta) => {
            const chunkPayload = {
              id: reqId,
              object: 'chat.completion.chunk',
              created: createdTs,
              model: resolved.model.id,
              choices: [
                {
                  index: 0,
                  delta: sentRole ? { content: delta } : { role: 'assistant', content: delta },
                  finish_reason: null,
                },
              ],
            };
            sentRole = true;
            res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
          },
        }
      );

      const creditsCharged = calculateCreditCost(resolved.model, result.promptTokens, result.completionTokens);
      applyWalletCredit({
        userId: auth.userId,
        amount: -creditsCharged,
        type: 'deduction',
        idempotencyKey: `gw:${reqId}`,
        referenceId: auth.apiKey?.id || null,
        description: `VEKTOR API Gateway stream (${resolved.model.id})`,
        metadata: { endpoint: '/v1/chat/completions', tokens: result.totalTokens, stream: true },
      });

      mutateDb((db) => {
        db.gatewayLogs.unshift({
          id: generateId('glog'),
          apiKeyId: auth.apiKey?.id || null,
          userId: auth.userId,
          endpoint: '/v1/chat/completions',
          requestedModel: modelId,
          routedModel: resolved.model.id,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          creditsCharged,
          latencyMs: result.latencyMs,
          statusCode: 200,
          errorMessage: null,
          createdAt: new Date().toISOString(),
        });
        if (db.gatewayLogs.length > 500) db.gatewayLogs = db.gatewayLogs.slice(0, 500);
      });

      const finalChunk = {
        id: reqId,
        object: 'chat.completion.chunk',
        created: createdTs,
        model: resolved.model.id,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          total_tokens: result.totalTokens,
        },
        vektor: {
          request_id: reqId,
          engine_tier: resolved.engineTier,
          used_fallback: resolved.usedFallback,
          latency_ms: result.latencyMs,
          credits_charged: creditsCharged,
        },
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    } catch (err) {
      if (abortController.signal.aborted) {
        return;
      }
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      logSystemError('gateway', 'error', msg, { modelId, userId: auth.userId, stream: true });
      mutateDb((db) => {
        db.gatewayLogs.unshift({
          id: generateId('glog'),
          apiKeyId: auth.apiKey?.id || null,
          userId: auth.userId,
          endpoint: '/v1/chat/completions',
          requestedModel: modelId,
          routedModel: resolved.model.id,
          promptTokens: 0,
          completionTokens: 0,
          creditsCharged: 0,
          latencyMs,
          statusCode: 502,
          errorMessage: msg,
          createdAt: new Date().toISOString(),
        });
      });
      res.write(`data: ${JSON.stringify({ error: { message: msg, type: 'upstream_error' } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
  }

  try {
    const result = await executeEngineCompletion(engineReq);
    const creditsCharged = calculateCreditCost(resolved.model, result.promptTokens, result.completionTokens);

    applyWalletCredit({
      userId: auth.userId,
      amount: -creditsCharged,
      type: 'deduction',
      idempotencyKey: `gw:${reqId}`,
      referenceId: auth.apiKey?.id || null,
      description: `VEKTOR API Gateway (${resolved.model.id})`,
      metadata: { endpoint: '/v1/chat/completions', tokens: result.totalTokens },
    });

    mutateDb((db) => {
      db.gatewayLogs.unshift({
        id: generateId('glog'),
        apiKeyId: auth.apiKey?.id || null,
        userId: auth.userId,
        endpoint: '/v1/chat/completions',
        requestedModel: modelId,
        routedModel: resolved.model.id,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        creditsCharged,
        latencyMs: result.latencyMs,
        statusCode: 200,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      });
      if (db.gatewayLogs.length > 500) db.gatewayLogs = db.gatewayLogs.slice(0, 500);
    });

    res.json({
      id: reqId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: resolved.model.id,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: result.text },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        total_tokens: result.totalTokens,
      },
      vektor: {
        request_id: reqId,
        engine_tier: resolved.engineTier,
        used_fallback: resolved.usedFallback,
        latency_ms: result.latencyMs,
        credits_charged: creditsCharged,
      },
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    logSystemError('gateway', 'error', msg, { modelId, userId: auth.userId });
    mutateDb((db) => {
      db.gatewayLogs.unshift({
        id: generateId('glog'),
        apiKeyId: auth.apiKey?.id || null,
        userId: auth.userId,
        endpoint: '/v1/chat/completions',
        requestedModel: modelId,
        routedModel: resolved.model.id,
        promptTokens: 0,
        completionTokens: 0,
        creditsCharged: 0,
        latencyMs,
        statusCode: 502,
        errorMessage: msg,
        createdAt: new Date().toISOString(),
      });
    });
    res.status(502).json({ error: { message: msg, type: 'upstream_error' } });
  }
});

gatewayV1Router.post('/embeddings', async (req, res) => {
  const start = Date.now();
  const reqId = generateId('emb');
  res.setHeader('X-Request-Id', reqId);

  const auth = authenticateGatewayRequest(req, res, 'embeddings');
  if (auth.error) {
    res.status(auth.status || 401).json({ error: { message: auth.error, type: auth.errorType || 'authentication_error' } });
    return;
  }

  const { model: requestedModel, input, allow_fallback } = req.body || {};
  const inputList = Array.isArray(input)
    ? input.map((v) => String(v))
    : typeof input === 'string' && input.trim()
      ? [input]
      : [];

  if (inputList.length === 0) {
    res.status(400).json({ error: { message: 'input string or string[] is required.', type: 'invalid_request_error' } });
    return;
  }

  const wallet = getOrCreateWallet(auth.userId);
  if (wallet.balanceCredits < 1) {
    res.status(402).json({ error: { message: 'Insufficient credits in wallet.', type: 'insufficient_quota' } });
    return;
  }

  const modelId = typeof requestedModel === 'string' && requestedModel ? requestedModel.trim() : 'vektor-auto';
  const routeOutcome = resolveEngineRoute({
    taskType: 'orchestration',
    requestedModelId: modelId,
    allowFallbackOnExplicitSelfHosted: Boolean(allow_fallback) || modelId === 'vektor-auto' || modelId === 'vektor-core-1',
  });

  if (!routeOutcome.route) {
    res.status(503).json({
      error: {
        message: routeOutcome.errorMessage || 'No configured AI embedding engine is available.',
        type: routeOutcome.errorCode || 'provider_unavailable',
      },
    });
    return;
  }

  const resolved = routeOutcome.route;

  try {
    const result = await executeEngineEmbedding({
      model: resolved.model,
      provider: resolved.provider,
      input: inputList.slice(0, 32),
    });

    const creditsCharged = Math.max(1, Math.ceil((result.promptTokens / 1000) * resolved.model.inputCreditsPer1k));
    applyWalletCredit({
      userId: auth.userId,
      amount: -creditsCharged,
      type: 'deduction',
      idempotencyKey: `gw:${reqId}`,
      referenceId: auth.apiKey?.id || null,
      description: `VEKTOR API Embeddings (${resolved.model.id})`,
      metadata: { endpoint: '/v1/embeddings', tokens: result.totalTokens },
    });

    mutateDb((db) => {
      db.gatewayLogs.unshift({
        id: generateId('glog'),
        apiKeyId: auth.apiKey?.id || null,
        userId: auth.userId,
        endpoint: '/v1/embeddings',
        requestedModel: modelId,
        routedModel: resolved.model.id,
        promptTokens: result.promptTokens,
        completionTokens: 0,
        creditsCharged,
        latencyMs: result.latencyMs,
        statusCode: 200,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      });
      if (db.gatewayLogs.length > 500) db.gatewayLogs = db.gatewayLogs.slice(0, 500);
    });

    res.json({
      object: 'list',
      model: resolved.model.id,
      data: result.embeddings.map((embedding, index) => ({
        object: 'embedding',
        index,
        embedding,
      })),
      usage: {
        prompt_tokens: result.promptTokens,
        total_tokens: result.totalTokens,
      },
      vektor: {
        request_id: reqId,
        engine_tier: resolved.engineTier,
        latency_ms: result.latencyMs,
        credits_charged: creditsCharged,
      },
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    logSystemError('gateway', 'error', msg, { modelId, endpoint: '/v1/embeddings' });
    mutateDb((db) => {
      db.gatewayLogs.unshift({
        id: generateId('glog'),
        apiKeyId: auth.apiKey?.id || null,
        userId: auth.userId,
        endpoint: '/v1/embeddings',
        requestedModel: modelId,
        routedModel: resolved.model.id,
        promptTokens: 0,
        completionTokens: 0,
        creditsCharged: 0,
        latencyMs,
        statusCode: 502,
        errorMessage: msg,
        createdAt: new Date().toISOString(),
      });
    });
    res.status(502).json({ error: { message: msg, type: 'upstream_error' } });
  }
});
