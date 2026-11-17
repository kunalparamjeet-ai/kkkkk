import { Router } from 'express';
import { getDb, mutateDb, getOrCreateWallet, createDefaultApiKeyForUser } from '../db/store.ts';
import {
  generateId,
  generateRandomToken,
  hashPassword,
  sha256,
  verifyPassword,
} from '../lib/crypto.ts';
import { requireAuth, optionalAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import type { UserRecord, UserRole } from '../types.ts';

const router = Router();

function sanitizeUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    preferredTheme: user.preferredTheme,
    onboardingCompleted: user.onboardingCompleted,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

function createSessionForUser(userId: string, req: AuthenticatedRequest): string {
  const rawToken = generateRandomToken('vk_sess_');
  const tokenHash = sha256(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  mutateDb((db) => {
    db.sessions.push({
      id: generateId('sess'),
      userId,
      tokenHash,
      userAgent: String(req.headers['user-agent'] || 'unknown').slice(0, 200),
      ipAddress: String(req.ip || 'unknown'),
      expiresAt,
      createdAt: now.toISOString(),
    });
  });

  return rawToken;
}

function setSessionCookie(res: import('express').Response, rawToken: string): void {
  res.cookie('vk_session', rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function getAppBaseUrl(req: import('express').Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

router.post('/register', (req: AuthenticatedRequest, res) => {
  const { email, password, name } = req.body || {};
  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = typeof name === 'string' && name.trim().length > 0 ? name.trim().slice(0, 80) : cleanEmail.split('@')[0];

  const existing = getDb().users.find((u) => u.email === cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const userId = generateId('usr');
  const role: UserRole = cleanEmail === 'kunalparamjeet@gmail.com' ? 'super_admin' : 'user';

  const newUser: UserRecord = {
    id: userId,
    email: cleanEmail,
    name: cleanName,
    passwordHash: hashPassword(password),
    googleId: null,
    avatarUrl: null,
    role,
    status: 'active',
    emailVerified: true,
    preferredTheme: 'light',
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
  };

  mutateDb((db) => {
    db.users.push(newUser);
    db.subscriptions.push({
      id: generateId('sub'),
      userId,
      planId: 'plan_free',
      status: 'active',
      billingCycle: 'monthly',
      provider: 'internal',
      externalSubscriptionId: null,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      createdAt: now,
    });
  });

  getOrCreateWallet(userId);
  const defaultApiKey = createDefaultApiKeyForUser(userId, 20);
  const token = createSessionForUser(userId, req);
  setSessionCookie(res, token);

  res.status(201).json({
    token,
    user: sanitizeUser(newUser),
    defaultApiKey: {
      id: defaultApiKey.keyId,
      keyPrefix: defaultApiKey.keyPrefix,
      plaintextKey: defaultApiKey.plaintextKey,
    },
  });
});

router.post('/login', (req: AuthenticatedRequest, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  const cleanEmail = email.trim().toLowerCase();
  const user = getDb().users.find((u) => u.email === cleanEmail);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (user.status !== 'active') {
    res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    return;
  }

  const wallet = getOrCreateWallet(user.id);
  const token = createSessionForUser(user.id, req);
  setSessionCookie(res, token);

  const db = getDb();
  const onboarding = db.onboardingProfiles.find((o) => o.userId === user.id) || null;

  res.json({
    token,
    user: sanitizeUser(user),
    wallet,
    onboarding,
  });
});

router.post('/logout', optionalAuth, (req: AuthenticatedRequest, res) => {
  if (req.sessionId) {
    mutateDb((db) => {
      db.sessions = db.sessions.filter((s) => s.id !== req.sessionId);
    });
  }
  res.clearCookie('vk_session', { path: '/', sameSite: 'none', secure: true });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const wallet = getOrCreateWallet(user.id);
  const onboarding = db.onboardingProfiles.find((o) => o.userId === user.id) || null;
  const sub = db.subscriptions.find((s) => s.userId === user.id && s.status === 'active') || null;
  const plan = sub ? db.plans.find((p) => p.id === sub.planId) || null : db.plans.find((p) => p.slug === 'free') || null;
  const github = db.githubConnections.find((g) => g.userId === user.id);

  res.json({
    user: sanitizeUser(user),
    wallet,
    onboarding,
    subscription: sub,
    plan,
    github: github ? { connected: true, username: github.githubUsername, avatarUrl: github.avatarUrl } : { connected: false },
  });
});

router.post('/password-reset/request', (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email is required.' });
    return;
  }
  const cleanEmail = email.trim().toLowerCase();
  const user = getDb().users.find((u) => u.email === cleanEmail);
  if (!user) {
    // Do not leak user existence
    res.json({ ok: true, message: 'If an account matches that email, a reset token has been generated.' });
    return;
  }
  const rawResetToken = generateRandomToken('vkr_');
  const now = new Date();
  mutateDb((db) => {
    db.passwordResets.push({
      id: generateId('rst'),
      userId: user.id,
      tokenHash: sha256(rawResetToken),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      usedAt: null,
      createdAt: now.toISOString(),
    });
  });

  res.json({
    ok: true,
    message: 'Password reset token generated. Use it within 30 minutes to set a new password.',
    resetTokenPreview: process.env.NODE_ENV !== 'production' ? rawResetToken : undefined,
  });
});

router.post('/password-reset/confirm', (req, res) => {
  const { token, newPassword } = req.body || {};
  if (typeof token !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'Valid reset token and new password (min 8 chars) are required.' });
    return;
  }
  const tokenHash = sha256(token.trim());
  const now = Date.now();

  const result = mutateDb((db) => {
    const rec = db.passwordResets.find((r) => r.tokenHash === tokenHash && !r.usedAt);
    if (!rec || new Date(rec.expiresAt).getTime() < now) {
      return { ok: false, error: 'Reset token is invalid or expired.' };
    }
    const user = db.users.find((u) => u.id === rec.userId);
    if (!user) return { ok: false, error: 'User not found.' };
    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();
    rec.usedAt = new Date().toISOString();
    // Revoke existing sessions
    db.sessions = db.sessions.filter((s) => s.userId !== user.id);
    return { ok: true };
  });

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, message: 'Password updated successfully. You may now sign in.' });
});

router.post('/onboarding', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { preferredTheme, discoverySource, projectPurpose, projectScale } = req.body || {};

  const validThemes = ['light', 'dark'];
  const validSources = ['Google', 'Instagram', 'YouTube', 'Facebook', 'X', 'Other'];
  const validPurposes = ['Personal', 'Business', 'Organization', 'Institution', 'Government'];
  const validScales = ['Small', 'Medium', 'Large', 'Enterprise'];

  if (
    !validThemes.includes(preferredTheme) ||
    !validSources.includes(discoverySource) ||
    !validPurposes.includes(projectPurpose) ||
    !validScales.includes(projectScale)
  ) {
    res.status(400).json({ error: 'Invalid onboarding selection values.' });
    return;
  }

  const now = new Date().toISOString();
  const profile = mutateDb((db) => {
    const u = db.users.find((x) => x.id === user.id);
    if (u) {
      u.preferredTheme = preferredTheme;
      u.onboardingCompleted = true;
      u.updatedAt = now;
    }
    const existingIdx = db.onboardingProfiles.findIndex((o) => o.userId === user.id);
    const nextProfile = {
      userId: user.id,
      preferredTheme,
      discoverySource,
      projectPurpose,
      projectScale,
      completedAt: now,
    };
    if (existingIdx >= 0) {
      db.onboardingProfiles[existingIdx] = nextProfile;
    } else {
      db.onboardingProfiles.push(nextProfile);
    }
    return nextProfile;
  });

  res.json({ ok: true, onboarding: profile });
});

router.put('/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { name, preferredTheme } = req.body || {};
  const updated = mutateDb((db) => {
    const u = db.users.find((x) => x.id === user.id);
    if (!u) return null;
    if (typeof name === 'string' && name.trim().length > 0) {
      u.name = name.trim().slice(0, 80);
    }
    if (preferredTheme === 'light' || preferredTheme === 'dark') {
      u.preferredTheme = preferredTheme;
    }
    u.updatedAt = new Date().toISOString();
    return sanitizeUser(u);
  });
  res.json({ user: updated });
});

router.get('/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const now = Date.now();
  const sessions = getDb()
    .sessions.filter((s) => s.userId === user.id && Date.parse(s.expiresAt) > now)
    .map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.id === req.sessionId,
    }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  res.json({ sessions });
});

router.delete('/sessions/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const removed = mutateDb((db) => {
    const idx = db.sessions.findIndex((s) => s.id === req.params.id && s.userId === user.id);
    if (idx < 0) return false;
    db.sessions.splice(idx, 1);
    return true;
  });
  if (!removed) {
    res.status(404).json({ error: 'Session not found.' });
    return;
  }
  res.json({ ok: true });
});

router.post('/password/change', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }

  const dbUser = getDb().users.find((u) => u.id === user.id);
  if (!dbUser) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }
  if (dbUser.passwordHash) {
    if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, dbUser.passwordHash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
  }

  mutateDb((db) => {
    const u = db.users.find((x) => x.id === user.id);
    if (u) {
      u.passwordHash = hashPassword(newPassword);
      u.updatedAt = new Date().toISOString();
    }
  });
  res.json({ ok: true, message: 'Password updated successfully.' });
});

// Google OAuth 2.0 Popup Flow
router.get('/google/url', (req, res) => {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = `${getAppBaseUrl(req)}/api/auth/google/callback`;
  if (!clientId) {
    res.status(503).json({
      configured: false,
      callbackUrl: redirectUri,
      error: 'Google OAuth is not configured yet on the server (missing GOOGLE_OAUTH_CLIENT_ID).',
    });
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.json({
    configured: true,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    callbackUrl: redirectUri,
  });
});

async function handleGoogleCallback(req: AuthenticatedRequest, res: import('express').Response) {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = `${getAppBaseUrl(req)}/api/auth/google/callback`;

  if (!code || !clientId || !clientSecret) {
    res.status(400).send('<html><body><p>Google OAuth callback missing authorization code or server credentials.</p></body></html>');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new Error('Failed to exchange Google OAuth code');
    }
    const tokenData = (await tokenRes.json()) as { access_token: string };
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileRes.ok) {
      throw new Error('Failed to fetch Google user profile');
    }
    const profile = (await profileRes.json()) as { id: string; email: string; name?: string; picture?: string; verified_email?: boolean };
    const cleanEmail = profile.email.toLowerCase();
    const now = new Date().toISOString();

    const { user, isNew } = mutateDb((db) => {
      let existing = db.users.find((u) => u.googleId === profile.id || u.email === cleanEmail);
      if (existing) {
        existing.googleId = profile.id;
        existing.avatarUrl = profile.picture || existing.avatarUrl;
        existing.emailVerified = true;
        existing.updatedAt = now;
        return { user: existing, isNew: false };
      }
      const newUser: UserRecord = {
        id: generateId('usr'),
        email: cleanEmail,
        name: profile.name || cleanEmail.split('@')[0],
        passwordHash: null,
        googleId: profile.id,
        avatarUrl: profile.picture || null,
        role: cleanEmail === 'kunalparamjeet@gmail.com' ? 'super_admin' : 'user',
        status: 'active',
        emailVerified: Boolean(profile.verified_email ?? true),
        preferredTheme: 'light',
        onboardingCompleted: false,
        createdAt: now,
        updatedAt: now,
      };
      db.users.push(newUser);
      db.subscriptions.push({
        id: generateId('sub'),
        userId: newUser.id,
        planId: 'plan_free',
        status: 'active',
        billingCycle: 'monthly',
        provider: 'internal',
        externalSubscriptionId: null,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: now,
      });
      return { user: newUser, isNew: true };
    });

    getOrCreateWallet(user.id);
    if (isNew) {
      createDefaultApiKeyForUser(user.id, 20);
    }
    const sessionToken = createSessionForUser(user.id, req);
    setSessionCookie(res, sessionToken);

    res.send(`
      <!doctype html>
      <html>
        <body style="font-family:system-ui,sans-serif;padding:24px;">
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'VEKTOR_GOOGLE_AUTH_SUCCESS', token: ${JSON.stringify(sessionToken)} }, '*');
              window.close();
            } else {
              window.location.href = '/workspace';
            }
          </script>
          <p>Google authentication successful. Returning to VEKTOR AI...</p>
        </body>
      </html>
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`<html><body><p>Google login error: ${msg}</p></body></html>`);
  }
}

router.get(['/google/callback', '/google/callback/'], handleGoogleCallback);

export default router;
