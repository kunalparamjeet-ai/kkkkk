import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { createServer as createViteServer } from 'vite';

import { getDb, logSystemError } from './server/db/store.ts';
import { isProviderGenuinelyAvailable } from './server/services/ai-orchestrator.ts';
import { validateSelfHostedModelHealth } from './server/services/model-hosting.ts';

import authRoutes from './server/routes/auth.ts';
import workspaceRoutes from './server/routes/workspace.ts';
import githubRoutes from './server/routes/github.ts';
import publishingRoutes, { serveHostedApp } from './server/routes/publishing.ts';
import { keysRouter, gatewayV1Router } from './server/routes/gateway.ts';
import billingRoutes from './server/routes/billing.ts';
import adminRoutes from './server/routes/admin.ts';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  // Ensure initial store & internal VEKTOR API key are initialized on startup
  getDb();
  void validateSelfHostedModelHealth();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Health Check
  app.get('/api/health', (_req, res) => {
    const db = getDb();
    res.json({
      status: 'ok',
      service: 'vektor-ai',
      timestamp: new Date().toISOString(),
      providersAvailable: db.aiProviders.filter((p) => isProviderGenuinelyAvailable(p)).length,
    });
  });

  // Public bootstrap data (plans, models, showcase)
  app.get('/api/public/bootstrap', (_req, res) => {
    const db = getDb();
    const plans = db.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder);
    const models = db.aiModels
      .filter((m) => m.enabled)
      .map((m) => {
        const prov = db.aiProviders.find((p) => p.id === m.providerId);
        const available = prov ? isProviderGenuinelyAvailable(prov) : false;
        return {
          id: m.id,
          displayName: m.displayName,
          roleTag: m.roleTag,
          providerName: prov?.name || 'VEKTOR AI',
          engineTier: prov?.kind === 'vektor_self_hosted' ? 'self_hosted' : 'managed_cloud',
          installed: available,
          available,
          isPreferredCoding: m.isPreferredCoding,
          inputCreditsPer1k: m.inputCreditsPer1k,
          outputCreditsPer1k: m.outputCreditsPer1k,
        };
      });

    const showcase = ['prj_showcase_treasury', 'prj_showcase_aeterna', 'prj_showcase_caregrid']
      .map((id) => {
        const p = db.projects.find((x) => x.id === id);
        if (!p) return null;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          liveUrl: p.previewSlug ? `/hosted/${p.previewSlug}` : null,
        };
      })
      .filter(Boolean);

    res.json({ plans, models, showcase });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', workspaceRoutes);
  app.use('/api/github', githubRoutes);
  app.use('/api', publishingRoutes);
  app.use('/api/keys', keysRouter);
  app.use('/api/billing', billingRoutes);
  app.use('/api/admin', adminRoutes);

  // OpenAI-Compatible VEKTOR API Gateway
  app.use('/v1', gatewayV1Router);

  // First-Party VEKTOR Managed Hosting Live Apps
  app.get('/hosted/:slug', serveHostedApp);
  app.get('/hosted/:slug/*', serveHostedApp);

  // Unknown API routes return structured JSON 404
  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Frontend Vite Dev Middleware or Production Static Bundle
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  // Global Error Handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled Express error:', err);
    logSystemError('express', 'critical', err.message || 'Unhandled server error', {
      stack: err.stack?.slice(0, 500),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VEKTOR AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
