import { Router } from 'express';
import { getDb, mutateDb } from '../db/store.ts';
import { decryptSecret, encryptSecret } from '../lib/crypto.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';

const router = Router();

function getAppBaseUrl(req: import('express').Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

router.get('/status', requireAuth, (req: AuthenticatedRequest, res) => {
  const conn = getDb().githubConnections.find((g) => g.userId === req.user!.id);
  const callbackUrl = `${getAppBaseUrl(req)}/api/github/callback`;
  res.json({
    oauthConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    callbackUrl,
    connected: Boolean(conn),
    username: conn?.githubUsername || null,
    avatarUrl: conn?.avatarUrl || null,
    connectedAt: conn?.connectedAt || null,
  });
});

router.get('/auth-url', requireAuth, (req: AuthenticatedRequest, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = `${getAppBaseUrl(req)}/api/github/callback`;
  if (!clientId) {
    res.status(503).json({
      error: 'GitHub OAuth is not configured on the server (missing GITHUB_CLIENT_ID).',
      callbackUrl: redirectUri,
    });
    return;
  }

  // Bind state to userId via encrypted payload so callback links to the right user
  const state = encodeURIComponent(encryptSecret(JSON.stringify({ userId: req.user!.id, ts: Date.now() })));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo read:user',
    state,
  });

  res.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    callbackUrl: redirectUri,
  });
});

async function handleGithubCallback(req: import('express').Request, res: import('express').Response) {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!code || !stateParam || !clientId || !clientSecret) {
    res.status(400).send('<html><body><p>GitHub OAuth callback missing required parameters.</p></body></html>');
    return;
  }

  try {
    const decodedState = JSON.parse(decryptSecret(decodeURIComponent(stateParam))) as { userId: string };
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string };
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error_description || 'Failed to obtain GitHub access token');
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'vektor-ai-platform',
      },
    });
    if (!userRes.ok) {
      throw new Error('Failed to fetch GitHub user profile');
    }
    const ghUser = (await userRes.json()) as { id: number; login: string; avatar_url?: string };

    mutateDb((db) => {
      const idx = db.githubConnections.findIndex((g) => g.userId === decodedState.userId);
      const record = {
        userId: decodedState.userId,
        githubUserId: String(ghUser.id),
        githubUsername: ghUser.login,
        avatarUrl: ghUser.avatar_url || null,
        accessTokenEncrypted: encryptSecret(tokenJson.access_token!),
        connectedAt: new Date().toISOString(),
      };
      if (idx >= 0) db.githubConnections[idx] = record;
      else db.githubConnections.push(record);
    });

    res.send(`
      <!doctype html>
      <html>
        <body style="font-family:system-ui,sans-serif;padding:24px;">
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'github' }, '*');
              window.close();
            } else {
              window.location.href = '/workspace';
            }
          </script>
          <p>GitHub connected as @${ghUser.login}. Closing window...</p>
        </body>
      </html>
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`<html><body><p>GitHub OAuth error: ${msg}</p></body></html>`);
  }
}

router.get(['/callback', '/callback/'], handleGithubCallback);

router.post('/disconnect', requireAuth, (req: AuthenticatedRequest, res) => {
  mutateDb((db) => {
    db.githubConnections = db.githubConnections.filter((g) => g.userId !== req.user!.id);
  });
  res.json({ ok: true });
});

function getUserGithubToken(userId: string): string | null {
  const conn = getDb().githubConnections.find((g) => g.userId === userId);
  if (!conn) return null;
  try {
    return decryptSecret(conn.accessTokenEncrypted);
  } catch {
    return null;
  }
}

router.get('/repos', requireAuth, async (req: AuthenticatedRequest, res) => {
  const token = getUserGithubToken(req.user!.id);
  if (!token) {
    res.status(401).json({ error: 'GitHub account is not connected.' });
    return;
  }
  try {
    const ghRes = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'vektor-ai-platform',
      },
    });
    if (!ghRes.ok) {
      res.status(ghRes.status).json({ error: 'Failed to load GitHub repositories.' });
      return;
    }
    const repos = (await ghRes.json()) as Array<{
      id: number;
      full_name: string;
      name: string;
      private: boolean;
      default_branch: string;
      html_url: string;
    }>;
    res.json({
      repos: repos.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        private: r.private,
        defaultBranch: r.default_branch,
        htmlUrl: r.html_url,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'GitHub API error' });
  }
});

router.post('/repos', requireAuth, async (req: AuthenticatedRequest, res) => {
  const token = getUserGithubToken(req.user!.id);
  if (!token) {
    res.status(401).json({ error: 'GitHub account is not connected.' });
    return;
  }
  const { name, isPrivate, description } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Repository name is required.' });
    return;
  }

  try {
    const ghRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'vektor-ai-platform',
      },
      body: JSON.stringify({
        name: name.trim(),
        private: Boolean(isPrivate),
        description: typeof description === 'string' ? description : 'Built with VEKTOR AI',
        auto_init: true,
      }),
    });
    const data = (await ghRes.json()) as {
      id?: number;
      full_name?: string;
      name?: string;
      default_branch?: string;
      html_url?: string;
      message?: string;
    };
    if (!ghRes.ok || !data.full_name) {
      res.status(ghRes.status).json({ error: data.message || 'Failed to create repository.' });
      return;
    }
    res.status(201).json({
      repo: {
        id: data.id,
        fullName: data.full_name,
        name: data.name,
        defaultBranch: data.default_branch || 'main',
        htmlUrl: data.html_url,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'GitHub API error' });
  }
});

router.post('/push', requireAuth, async (req: AuthenticatedRequest, res) => {
  const token = getUserGithubToken(req.user!.id);
  if (!token) {
    res.status(401).json({ error: 'GitHub account is not connected.' });
    return;
  }
  const { projectId, repoFullName, branch, commitMessage } = req.body || {};
  if (typeof projectId !== 'string' || typeof repoFullName !== 'string') {
    res.status(400).json({ error: 'projectId and repoFullName are required.' });
    return;
  }

  const db = getDb();
  const project = db.projects.find((p) => p.id === projectId && p.userId === req.user!.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const files = db.projectFiles.filter((f) => f.projectId === project.id);
  if (files.length === 0) {
    res.status(400).json({ error: 'Project has no files to push.' });
    return;
  }

  const targetBranch = typeof branch === 'string' && branch.trim() ? branch.trim() : 'main';
  const msg = typeof commitMessage === 'string' && commitMessage.trim() ? commitMessage.trim() : `Update from VEKTOR AI: ${project.name}`;

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'vektor-ai-platform',
  };

  try {
    // Upsert each file via GitHub Contents API on the requested branch
    const pushedFiles: string[] = [];
    for (const file of files) {
      const apiPath = `https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(file.path).replace(/%2F/g, '/')}`;
      let existingSha: string | undefined;
      const checkRes = await fetch(`${apiPath}?ref=${encodeURIComponent(targetBranch)}`, { headers: ghHeaders });
      if (checkRes.ok) {
        const existingJson = (await checkRes.json()) as { sha?: string };
        existingSha = existingJson.sha;
      }

      const putRes = await fetch(apiPath, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify({
          message: msg,
          branch: targetBranch,
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      });
      if (!putRes.ok) {
        const errJson = (await putRes.json().catch(() => ({}))) as { message?: string };
        throw new Error(`Failed pushing ${file.path}: ${errJson.message || putRes.statusText}`);
      }
      pushedFiles.push(file.path);
    }

    mutateDb((state) => {
      const p = state.projects.find((x) => x.id === project.id);
      if (p) {
        p.githubRepoFullName = repoFullName;
        p.githubBranch = targetBranch;
        p.updatedAt = new Date().toISOString();
      }
    });

    res.json({
      ok: true,
      repoFullName,
      branch: targetBranch,
      pushedFiles,
      repoUrl: `https://github.com/${repoFullName}/tree/${targetBranch}`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'GitHub push failed' });
  }
});

export default router;
