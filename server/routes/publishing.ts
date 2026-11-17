import { Router } from 'express';
import dns from 'node:dns/promises';
import { getDb, mutateDb } from '../db/store.ts';
import { generateId, generateRandomToken } from '../lib/crypto.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';

const router = Router();

function makeSlug(name: string, projectId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'app';
  const suffix = projectId.slice(-5);
  return `${base}-${suffix}`;
}

// Publish or republish project to VEKTOR Managed Hosting
router.post('/projects/:id/publish', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const files = db.projectFiles.filter((f) => f.projectId === project.id);
  const indexHtml = files.find((f) => f.path === 'index.html');
  if (!indexHtml) {
    res.status(400).json({ error: 'Project must contain an index.html file to publish.' });
    return;
  }

  const slug = project.previewSlug || makeSlug(project.name, project.id);
  const liveUrl = `/hosted/${slug}`;
  const now = new Date().toISOString();
  const hostingDomain = process.env.VEKTOR_HOSTING_DOMAIN || 'vektor.app';

  const deployment = mutateDb((state) => {
    const p = state.projects.find((x) => x.id === project.id);
    if (p) {
      p.previewSlug = slug;
      p.status = 'published';
      p.updatedAt = now;
    }

    const logs = [
      `[${now}] VEKTOR Publishing Agent initialized for "${project.name}"`,
      `[${now}] Bundling ${files.length} workspace file(s) (version ${project.activeVersionId || 'latest'})`,
      `[${now}] Validating static entrypoint index.html (${indexHtml.content.length} bytes)`,
      `[${now}] Provisioned hosted route ${liveUrl} (edge alias: https://${slug}.${hostingDomain})`,
      `[${now}] Deployment status: LIVE`,
    ];

    const record = {
      id: generateId('dep'),
      projectId: project.id,
      userId: user.id,
      slug,
      liveUrl,
      versionId: project.activeVersionId,
      status: 'live' as const,
      logs,
      publishedAt: now,
    };
    state.deployments.unshift(record);
    return record;
  });

  res.status(201).json({
    deployment,
    liveUrl,
    edgeAlias: `https://${slug}.${hostingDomain}`,
  });
});

router.get('/projects/:id/deployments', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const project = db.projects.find((p) => p.id === req.params.id && p.userId === user.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const deployments = db.deployments
    .filter((d) => d.projectId === project.id)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  res.json({ deployments });
});

// Custom Domains (eligible paid users)
router.get('/domains', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const domains = db.customDomains.filter((d) => d.userId === user.id);
  res.json({ domains });
});

router.post('/domains', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { projectId, domain } = req.body || {};
  if (typeof projectId !== 'string' || typeof domain !== 'string') {
    res.status(400).json({ error: 'projectId and domain are required.' });
    return;
  }
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanDomain)) {
    res.status(400).json({ error: 'Invalid domain format (example: app.example.com).' });
    return;
  }

  const db = getDb();
  const sub = db.subscriptions.find((s) => s.userId === user.id && s.status === 'active');
  const plan = sub ? db.plans.find((p) => p.id === sub.planId) : db.plans.find((p) => p.slug === 'free');

  if (!plan?.customDomainsEnabled && user.role === 'user') {
    res.status(403).json({
      error: 'Custom domains require Pro, Business, Agency, or Enterprise plan.',
    });
    return;
  }

  const project = db.projects.find((p) => p.id === projectId && p.userId === user.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  if (db.customDomains.some((d) => d.domain === cleanDomain)) {
    res.status(409).json({ error: 'Domain is already registered.' });
    return;
  }

  const record = mutateDb((state) => {
    const d = {
      id: generateId('dom'),
      projectId: project.id,
      userId: user.id,
      domain: cleanDomain,
      verificationToken: `vektor-verify-${generateRandomToken('').slice(0, 20)}`,
      dnsVerified: false,
      sslStatus: 'pending' as const,
      status: 'pending_verification' as const,
      lastCheckedAt: null,
      createdAt: new Date().toISOString(),
    };
    state.customDomains.unshift(d);
    return d;
  });

  res.status(201).json({ domain: record });
});

router.post('/domains/:id/verify', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const db = getDb();
  const dom = db.customDomains.find((d) => d.id === req.params.id && (d.userId === user.id || user.role !== 'user'));
  if (!dom) {
    res.status(404).json({ error: 'Custom domain not found.' });
    return;
  }

  const hostingTarget = `edge.${process.env.VEKTOR_HOSTING_DOMAIN || 'vektor.app'}`;
  let txtMatched = false;
  let cnameMatched = false;
  const dnsErrors: string[] = [];

  try {
    const txtRecords = await dns.resolveTxt(`_vektor-verify.${dom.domain}`);
    const flatTxt = txtRecords.flat().map((v) => v.trim());
    txtMatched = flatTxt.includes(dom.verificationToken);
    if (!txtMatched) {
      dnsErrors.push(`TXT record at _vektor-verify.${dom.domain} did not contain ${dom.verificationToken}`);
    }
  } catch (err) {
    dnsErrors.push(`TXT lookup failed: ${err instanceof Error ? err.message : 'Not found'}`);
  }

  try {
    const cnames = await dns.resolveCname(dom.domain);
    cnameMatched = cnames.some((c) => c.toLowerCase().includes(hostingTarget.toLowerCase()));
    if (!cnameMatched) {
      dnsErrors.push(`CNAME for ${dom.domain} does not point to ${hostingTarget}`);
    }
  } catch (err) {
    dnsErrors.push(`CNAME lookup failed: ${err instanceof Error ? err.message : 'Not found'}`);
  }

  const verified = txtMatched && cnameMatched;
  const now = new Date().toISOString();

  const updated = mutateDb((state) => {
    const target = state.customDomains.find((d) => d.id === dom.id);
    if (!target) return null;
    target.dnsVerified = verified;
    target.lastCheckedAt = now;
    if (verified) {
      target.status = 'active';
      target.sslStatus = 'active';
    } else {
      target.status = 'pending_verification';
      target.sslStatus = 'pending';
    }
    return target;
  });

  res.json({
    domain: updated,
    verified,
    txtMatched,
    cnameMatched,
    diagnostics: dnsErrors,
  });
});

router.delete('/domains/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const removed = mutateDb((state) => {
    const before = state.customDomains.length;
    state.customDomains = state.customDomains.filter(
      (d) => !(d.id === req.params.id && (d.userId === user.id || user.role !== 'user'))
    );
    return state.customDomains.length < before;
  });
  if (!removed) {
    res.status(404).json({ error: 'Domain not found.' });
    return;
  }
  res.json({ ok: true });
});

export function serveHostedApp(req: import('express').Request, res: import('express').Response): void {
  const slug = req.params.slug;
  const subPath = (req.params[0] || 'index.html').replace(/^\/+/, '') || 'index.html';
  const db = getDb();
  const project = db.projects.find((p) => p.previewSlug === slug);
  if (!project) {
    res.status(404).send(`
      <!doctype html>
      <html><body style="font-family:system-ui,sans-serif;padding:48px;text-align:center;">
        <h1>404 — Hosted Application Not Found</h1>
        <p>No VEKTOR AI deployment matches <code>${slug}</code>.</p>
        <a href="/">Return to VEKTOR AI</a>
      </body></html>
    `);
    return;
  }

  const file =
    db.projectFiles.find((f) => f.projectId === project.id && f.path === subPath) ||
    db.projectFiles.find((f) => f.projectId === project.id && f.path === 'index.html');

  if (!file) {
    res.status(404).send('Entrypoint file not found.');
    return;
  }

  const ext = file.path.split('.').pop()?.toLowerCase();
  const mime =
    ext === 'html'
      ? 'text/html; charset=utf-8'
      : ext === 'css'
        ? 'text/css; charset=utf-8'
        : ext === 'js'
          ? 'application/javascript; charset=utf-8'
          : ext === 'json'
            ? 'application/json; charset=utf-8'
            : 'text/plain; charset=utf-8';

  res.setHeader('Content-Type', mime);
  res.send(file.content);
}

export default router;
