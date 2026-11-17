import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type {
  VektorDatabaseState,
  UserRecord,
  WalletRecord,
  CreditTransactionRecord,
  PlanRecord,
  AiProviderRecord,
  AiModelRecord,
  TaskRoutingRule,
  ProjectRecord,
  ProjectFileRecord,
  DeploymentRecord,
} from '../types.ts';
import { generateId, generateRandomToken, generateSecureApiKey, hashPassword, sha256 } from '../lib/crypto.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'vektor-store.json');

// Optional PostgreSQL pool when DATABASE_URL is configured (Render / Production)
let pgPool: Pool | null = null;
export function getPgPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 10000,
    });
    pgPool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });
  }
  return pgPool;
}

const SHOWCASE_TREASURY_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Meridian Treasury Ops — Hosted on VEKTOR AI</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    header { display:flex; justify-content:space-between; align-items:center; padding:18px 32px; background:#fff; border-bottom:1px solid #e2e8f0; }
    main { max-width:1100px; margin:32px auto; padding:0 24px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-bottom:24px; }
    .card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:18px; }
    .label { font-size:12px; color:#64748b; margin-bottom:6px; }
    .val { font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
    th, td { text-align:left; padding:12px 16px; border-bottom:1px solid #f1f5f9; font-size:14px; }
    th { background:#f8fafc; color:#475569; font-weight:600; }
    .num { text-align:right; font-variant-numeric:tabular-nums; }
    button { background:#2563eb; color:#fff; border:none; padding:9px 16px; border-radius:8px; font-weight:600; cursor:pointer; }
  </style>
</head>
<body>
  <header>
    <strong>Meridian Treasury Ops</strong>
    <button onclick="rebalance()">Simulate Sweep</button>
  </header>
  <main>
    <div class="grid">
      <div class="card"><div class="label">Total Liquidity</div><div class="val" id="liq">$48,920,400</div></div>
      <div class="card"><div class="label">30-Day Net Yield</div><div class="val">+$214,880</div></div>
      <div class="card"><div class="label">Active Operating Accounts</div><div class="val">14</div></div>
    </div>
    <table>
      <thead><tr><th>Account</th><th>Bank</th><th>Currency</th><th class="num">Balance</th></tr></thead>
      <tbody id="rows">
        <tr><td>Primary Operating</td><td>JPMorgan Chase</td><td>USD</td><td class="num">$18,420,100</td></tr>
        <tr><td>Treasury Reserve</td><td>Silicon Valley Commercial</td><td>USD</td><td class="num">$24,500,300</td></tr>
        <tr><td>EMEA Settlement</td><td>HSBC London</td><td>EUR</td><td class="num">€5,610,000</td></tr>
      </tbody>
    </table>
  </main>
  <script>
    function rebalance() {
      const el = document.getElementById('liq');
      const next = 48920400 + Math.floor(Math.random() * 45000);
      el.textContent = '$' + next.toLocaleString('en-US');
    }
  </script>
</body>
</html>`;

const SHOWCASE_COMMERCE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Aeterna Stoneware — Hosted on VEKTOR AI</title>
  <style>
    body { font-family: Georgia, serif; margin:0; background:#faf9f6; color:#1c1917; }
    header { display:flex; justify-content:space-between; align-items:center; padding:20px 36px; border-bottom:1px solid #e7e5e4; font-family:system-ui,sans-serif; }
    .hero { max-width:1040px; margin:40px auto; padding:0 24px; display:grid; grid-template-columns:1fr 1fr; gap:32px; align-items:center; }
    .catalog { max-width:1040px; margin:32px auto 64px; padding:0 24px; display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:20px; }
    .item { background:#fff; border:1px solid #e7e5e4; padding:18px; border-radius:8px; font-family:system-ui,sans-serif; }
    .btn { background:#1c1917; color:#fff; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-size:13px; }
  </style>
</head>
<body>
  <header>
    <strong>AETERNA</strong>
    <span id="cart" style="font-size:14px;">Bag (0)</span>
  </header>
  <section class="hero">
    <div>
      <h1 style="font-size:40px; line-height:1.1; margin:0 0 12px;">Architectural Stoneware &amp; Linen</h1>
      <p style="font-family:system-ui,sans-serif; color:#57534e; line-height:1.6;">Small-batch travertine vessels and Belgian linen textiles crafted for quiet residential interiors.</p>
    </div>
    <div style="background:#e7e5e4; border-radius:8px; padding:48px; text-align:center; font-family:system-ui,sans-serif;">Autumn Collection · 12 Pieces</div>
  </section>
  <section class="catalog">
    <div class="item"><h3>Aura Travertine Vase</h3><p>$280</p><button class="btn" onclick="add()">Add to Bag</button></div>
    <div class="item"><h3>Serra Linen Lamp</h3><p>$340</p><button class="btn" onclick="add()">Add to Bag</button></div>
    <div class="item"><h3>Petra Serving Bowl</h3><p>$195</p><button class="btn" onclick="add()">Add to Bag</button></div>
  </section>
  <script>
    let c = 0;
    function add() { c++; document.getElementById('cart').textContent = 'Bag (' + c + ')'; }
  </script>
</body>
</html>`;

const SHOWCASE_CLINIC_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>CareGrid Clinical Intake — Hosted on VEKTOR AI</title>
  <style>
    body { font-family: system-ui, sans-serif; margin:0; background:#f4f4f5; color:#18181b; }
    header { background:#fff; border-bottom:1px solid #e4e4e7; padding:16px 28px; display:flex; justify-content:space-between; align-items:center; }
    main { max-width:980px; margin:28px auto; padding:0 20px; }
    .slot { background:#fff; border:1px solid #e4e4e7; border-radius:8px; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .btn { background:#2563eb; color:#fff; border:none; padding:7px 14px; border-radius:6px; cursor:pointer; font-size:13px; }
  </style>
</head>
<body>
  <header><strong>CareGrid Diagnostics</strong><span>Today · Outpatient Wing B</span></header>
  <main>
    <h2 style="font-size:20px;">Scheduled Intake Queue</h2>
    <div class="slot"><div><strong>09:30 AM</strong> — Liam Brown · Thoracic Scan Review</div><button class="btn" onclick="this.textContent='Checked In';this.style.background='#16a34a'">Check In</button></div>
    <div class="slot"><div><strong>10:15 AM</strong> — Emily Chen · Follow-up Consultation</div><button class="btn" onclick="this.textContent='Checked In';this.style.background='#16a34a'">Check In</button></div>
    <div class="slot"><div><strong>11:00 AM</strong> — Marcus Rivera · Lab Panel Sync</div><button class="btn" onclick="this.textContent='Checked In';this.style.background='#16a34a'">Check In</button></div>
  </main>
</body>
</html>`;

function createInitialState(): VektorDatabaseState {
  const now = new Date().toISOString();

  const plans: PlanRecord[] = [
    {
      id: 'plan_free',
      slug: 'free',
      name: 'Free',
      audience: 'For solo exploration',
      monthlyPriceUsd: 0,
      annualPriceUsd: 0,
      monthlyPriceInr: 0,
      monthlyCredits: 500,
      maxProjects: 3,
      rateLimitRpm: 20,
      dailyRequestLimit: 200,
      customDomainsEnabled: false,
      features: [
        '500 monthly credits',
        '20 RPM / 200 daily API requests',
        'Up to 3 active projects',
        'VEKTOR Managed Hosting',
      ],
      active: true,
      sortOrder: 1,
    },
    {
      id: 'plan_basic',
      slug: 'basic',
      name: 'Basic',
      audience: 'For solo API developers',
      monthlyPriceUsd: 9,
      annualPriceUsd: 7,
      monthlyPriceInr: 749,
      monthlyCredits: 1500,
      maxProjects: 8,
      rateLimitRpm: 40,
      dailyRequestLimit: 1000,
      customDomainsEnabled: false,
      features: [
        '1,500 monthly credits',
        '40 RPM / 1,000 daily API requests',
        'Up to 8 projects',
        'Full VEKTOR API Gateway access',
      ],
      active: true,
      sortOrder: 2,
    },
    {
      id: 'plan_starter',
      slug: 'starter',
      name: 'Starter',
      audience: 'For independent builders',
      monthlyPriceUsd: 19,
      annualPriceUsd: 15,
      monthlyPriceInr: 1599,
      monthlyCredits: 3000,
      maxProjects: 15,
      rateLimitRpm: 60,
      dailyRequestLimit: 2500,
      customDomainsEnabled: false,
      features: [
        '3,000 monthly credits',
        '60 RPM / 2,500 daily API requests',
        'GitHub OAuth & branch sync',
        'Priority VEKTOR Coding Model routing',
      ],
      active: true,
      sortOrder: 3,
    },
    {
      id: 'plan_pro',
      slug: 'pro',
      name: 'Pro',
      audience: 'For production shipping',
      monthlyPriceUsd: 49,
      annualPriceUsd: 39,
      monthlyPriceInr: 3999,
      monthlyCredits: 10000,
      maxProjects: 50,
      rateLimitRpm: 180,
      dailyRequestLimit: 10000,
      customDomainsEnabled: true,
      features: [
        '10,000 monthly credits',
        '180 RPM / 10,000 daily API requests',
        'Custom domains with SSL',
        '50 active projects',
      ],
      active: true,
      sortOrder: 4,
    },
    {
      id: 'plan_business',
      slug: 'business',
      name: 'Business',
      audience: 'For product teams',
      monthlyPriceUsd: 129,
      annualPriceUsd: 99,
      monthlyPriceInr: 10499,
      monthlyCredits: 35000,
      maxProjects: 200,
      rateLimitRpm: 600,
      dailyRequestLimit: 50000,
      customDomainsEnabled: true,
      features: [
        '35,000 monthly credits',
        '600 RPM / 50,000 daily API requests',
        'Multi-provider fallback routing',
        'Custom domains & audit logs',
      ],
      active: true,
      sortOrder: 5,
    },
    {
      id: 'plan_agency',
      slug: 'agency',
      name: 'Agency',
      audience: 'For client delivery studios',
      monthlyPriceUsd: 299,
      annualPriceUsd: 239,
      monthlyPriceInr: 24999,
      monthlyCredits: 100000,
      maxProjects: 1000,
      rateLimitRpm: 1500,
      dailyRequestLimit: 150000,
      customDomainsEnabled: true,
      features: [
        '100,000 monthly credits',
        '1,500 RPM / 150k daily API requests',
        'White-label hosted slugs',
        '1,000 client workspaces',
      ],
      active: true,
      sortOrder: 6,
    },
    {
      id: 'plan_enterprise',
      slug: 'enterprise',
      name: 'Enterprise',
      audience: 'For large-scale organizations',
      monthlyPriceUsd: 799,
      annualPriceUsd: 649,
      monthlyPriceInr: 64999,
      monthlyCredits: 350000,
      maxProjects: 10000,
      rateLimitRpm: 5000,
      dailyRequestLimit: 1000000,
      customDomainsEnabled: true,
      features: [
        '350,000+ monthly credits',
        '5,000 RPM / 1M+ daily API requests',
        'Self-hosted VEKTOR weights VPC',
        'Custom SLA & SSO/SAML',
      ],
      active: true,
      sortOrder: 7,
    },
  ];

  const superAdminId = 'usr_superadmin';
  const adminId = 'usr_admin';
  const builderId = 'usr_builder';

  const users: UserRecord[] = [
    {
      id: superAdminId,
      email: 'superadmin@vektor.ai',
      name: 'VEKTOR Super Admin',
      passwordHash: hashPassword('VektorSuperAdmin!2026'),
      googleId: null,
      avatarUrl: null,
      role: 'super_admin',
      status: 'active',
      emailVerified: true,
      preferredTheme: 'light',
      onboardingCompleted: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: adminId,
      email: 'admin@vektor.ai',
      name: 'VEKTOR Operations Admin',
      passwordHash: hashPassword('VektorAdmin!2026'),
      googleId: null,
      avatarUrl: null,
      role: 'admin',
      status: 'active',
      emailVerified: true,
      preferredTheme: 'light',
      onboardingCompleted: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: builderId,
      email: 'builder@vektor.ai',
      name: 'Alex Mercer',
      passwordHash: hashPassword('VektorBuilder!2026'),
      googleId: null,
      avatarUrl: null,
      role: 'user',
      status: 'active',
      emailVerified: true,
      preferredTheme: 'light',
      onboardingCompleted: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const wallets: WalletRecord[] = [
    { userId: superAdminId, balanceCredits: 50000, lifetimeCreditsPurchased: 50000, lifetimeCreditsUsed: 0, lowCreditThreshold: 500, updatedAt: now },
    { userId: adminId, balanceCredits: 25000, lifetimeCreditsPurchased: 25000, lifetimeCreditsUsed: 0, lowCreditThreshold: 500, updatedAt: now },
    { userId: builderId, balanceCredits: 2500, lifetimeCreditsPurchased: 2500, lifetimeCreditsUsed: 120, lowCreditThreshold: 200, updatedAt: now },
  ];

  const creditTransactions: CreditTransactionRecord[] = [
    {
      id: generateId('txn'),
      userId: superAdminId,
      type: 'grant',
      amount: 50000,
      balanceAfter: 50000,
      idempotencyKey: 'seed:superadmin:init',
      referenceId: 'plan_enterprise',
      description: 'Initial Enterprise Super-Admin allocation',
      metadata: {},
      createdAt: now,
    },
    {
      id: generateId('txn'),
      userId: builderId,
      type: 'grant',
      amount: 2500,
      balanceAfter: 2500,
      idempotencyKey: 'seed:builder:init',
      referenceId: 'plan_pro',
      description: 'Initial Builder Starter allocation',
      metadata: {},
      createdAt: now,
    },
  ];

  const aiProviders: AiProviderRecord[] = [
    {
      id: 'prov_vektor_self_hosted',
      name: 'VEKTOR Inference Server',
      kind: 'vektor_self_hosted',
      baseUrl: process.env.VEKTOR_INFERENCE_URL || null,
      apiKeyEnvVar: 'VEKTOR_INFERENCE_API_KEY',
      encryptedApiKey: null,
      enabled: true,
      status: process.env.VEKTOR_INFERENCE_URL ? 'offline' : 'unconfigured',
      lastCheckedAt: null,
    },
    {
      id: 'prov_gemini',
      name: 'Google Gemini',
      kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKeyEnvVar: 'GEMINI_API_KEY',
      encryptedApiKey: null,
      enabled: true,
      status: process.env.GEMINI_API_KEY ? 'available' : 'unconfigured',
      lastCheckedAt: now,
    },
    {
      id: 'prov_openai',
      name: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      encryptedApiKey: null,
      enabled: true,
      status: process.env.OPENAI_API_KEY ? 'available' : 'unconfigured',
      lastCheckedAt: now,
    },
    {
      id: 'prov_deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeyEnvVar: 'DEEPSEEK_API_KEY',
      encryptedApiKey: null,
      enabled: true,
      status: process.env.DEEPSEEK_API_KEY ? 'available' : 'unconfigured',
      lastCheckedAt: now,
    },
  ];

  const aiModels: AiModelRecord[] = [
    {
      id: 'vektor-orchestrator-1',
      providerId: 'prov_vektor_self_hosted',
      modelIdentifier: 'vektor-orchestrator-1',
      displayName: 'VEKTOR Senior Orchestrator',
      roleTag: 'Central Orchestrator',
      inputCreditsPer1k: 1.0,
      outputCreditsPer1k: 2.0,
      maxContextTokens: 128000,
      supportsStreaming: true,
      enabled: true,
      isPreferredCoding: false,
    },
    {
      id: 'vektor-coder-1',
      providerId: 'prov_vektor_self_hosted',
      modelIdentifier: process.env.VEKTOR_MODEL_NAME || 'vektor-coder-1',
      displayName: 'VEKTOR Coding Model',
      roleTag: 'Preferred Coding Engine',
      inputCreditsPer1k: 0.8,
      outputCreditsPer1k: 1.5,
      maxContextTokens: 128000,
      supportsStreaming: true,
      enabled: true,
      isPreferredCoding: true,
    },
    {
      id: 'gemini-4-hydrogen',
      providerId: 'prov_gemini',
      modelIdentifier: 'gemini-4-hydrogen',
      displayName: 'Gemini 4 Hydrogen',
      roleTag: 'App Creation & UI/UX',
      inputCreditsPer1k: 1.0,
      outputCreditsPer1k: 2.0,
      maxContextTokens: 1000000,
      supportsStreaming: true,
      enabled: true,
      isPreferredCoding: false,
    },
    {
      id: 'gpt-4.1',
      providerId: 'prov_openai',
      modelIdentifier: 'gpt-4.1',
      displayName: 'OpenAI GPT-4.1',
      roleTag: 'Complex Reasoning',
      inputCreditsPer1k: 2.5,
      outputCreditsPer1k: 5.0,
      maxContextTokens: 128000,
      supportsStreaming: true,
      enabled: true,
      isPreferredCoding: false,
    },
    {
      id: 'deepseek-coder',
      providerId: 'prov_deepseek',
      modelIdentifier: 'deepseek-coder',
      displayName: 'DeepSeek Coder',
      roleTag: 'Technical & Debugging',
      inputCreditsPer1k: 0.6,
      outputCreditsPer1k: 1.2,
      maxContextTokens: 128000,
      supportsStreaming: true,
      enabled: true,
      isPreferredCoding: false,
    },
  ];

  const taskRoutingRules: TaskRoutingRule[] = [
    { taskType: 'orchestration', primaryModelId: 'vektor-orchestrator-1', fallbackModelId: 'gemini-4-hydrogen', description: 'Senior request decomposition, delegation, and synthesis', updatedAt: now },
    { taskType: 'coding', primaryModelId: 'vektor-coder-1', fallbackModelId: 'gemini-4-hydrogen', description: 'Fast full-stack code synthesis and file edits', updatedAt: now },
    { taskType: 'app_creation', primaryModelId: 'gemini-4-hydrogen', fallbackModelId: 'vektor-coder-1', description: 'End-to-end web application scaffolding', updatedAt: now },
    { taskType: 'reasoning', primaryModelId: 'gpt-4.1', fallbackModelId: 'gemini-4-hydrogen', description: 'Architectural trade-offs and multi-step logic', updatedAt: now },
    { taskType: 'design_ux', primaryModelId: 'gemini-4-hydrogen', fallbackModelId: 'vektor-coder-1', description: 'Visual hierarchy, layout structure, and CSS design', updatedAt: now },
    { taskType: 'testing_debug', primaryModelId: 'deepseek-coder', fallbackModelId: 'gemini-4-hydrogen', description: 'Static checks, edge cases, and verification', updatedAt: now },
    { taskType: 'publishing', primaryModelId: 'vektor-orchestrator-1', fallbackModelId: 'gemini-4-hydrogen', description: 'Build packaging, bundle manifest, and deployment', updatedAt: now },
  ];

  // Auto-generate internal VEKTOR API key on initialization
  const rawInternalKey = generateRandomToken('vk_live_internal_');
  const internalKeyId = generateId('vkey');

  const showcaseProjects: ProjectRecord[] = [
    {
      id: 'prj_showcase_treasury',
      userId: builderId,
      name: 'Meridian Treasury Ops',
      description: 'Institutional cashflow dashboard with real-time liquidity sweep simulation and account breakdown.',
      status: 'published',
      selectedModelId: 'vektor-auto',
      previewSlug: 'meridian-treasury',
      activeVersionId: 'ver_showcase_1',
      totalTokensUsed: 4820,
      githubRepoFullName: null,
      githubBranch: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prj_showcase_aeterna',
      userId: builderId,
      name: 'Aeterna Stoneware Storefront',
      description: 'Minimalist homeware storefront with interactive shopping bag state and editorial layout.',
      status: 'published',
      selectedModelId: 'vektor-auto',
      previewSlug: 'aeterna-stoneware',
      activeVersionId: 'ver_showcase_2',
      totalTokensUsed: 3910,
      githubRepoFullName: null,
      githubBranch: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prj_showcase_caregrid',
      userId: builderId,
      name: 'CareGrid Clinical Intake',
      description: 'Outpatient diagnostics queue and one-click check-in console.',
      status: 'published',
      selectedModelId: 'vektor-auto',
      previewSlug: 'caregrid-intake',
      activeVersionId: 'ver_showcase_3',
      totalTokensUsed: 3240,
      githubRepoFullName: null,
      githubBranch: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const showcaseFiles: ProjectFileRecord[] = [
    { id: 'file_sh_1', projectId: 'prj_showcase_treasury', path: 'index.html', content: SHOWCASE_TREASURY_HTML, language: 'html', updatedAt: now },
    { id: 'file_sh_2', projectId: 'prj_showcase_aeterna', path: 'index.html', content: SHOWCASE_COMMERCE_HTML, language: 'html', updatedAt: now },
    { id: 'file_sh_3', projectId: 'prj_showcase_caregrid', path: 'index.html', content: SHOWCASE_CLINIC_HTML, language: 'html', updatedAt: now },
  ];

  const showcaseDeployments: DeploymentRecord[] = [
    {
      id: 'dep_sh_1',
      projectId: 'prj_showcase_treasury',
      userId: builderId,
      slug: 'meridian-treasury',
      liveUrl: '/hosted/meridian-treasury',
      versionId: 'ver_showcase_1',
      status: 'live',
      logs: ['[VEKTOR Host] Bundle verified (index.html)', '[VEKTOR Host] Published live at /hosted/meridian-treasury'],
      publishedAt: now,
    },
    {
      id: 'dep_sh_2',
      projectId: 'prj_showcase_aeterna',
      userId: builderId,
      slug: 'aeterna-stoneware',
      liveUrl: '/hosted/aeterna-stoneware',
      versionId: 'ver_showcase_2',
      status: 'live',
      logs: ['[VEKTOR Host] Bundle verified (index.html)', '[VEKTOR Host] Published live at /hosted/aeterna-stoneware'],
      publishedAt: now,
    },
    {
      id: 'dep_sh_3',
      projectId: 'prj_showcase_caregrid',
      userId: builderId,
      slug: 'caregrid-intake',
      liveUrl: '/hosted/caregrid-intake',
      versionId: 'ver_showcase_3',
      status: 'live',
      logs: ['[VEKTOR Host] Bundle verified (index.html)', '[VEKTOR Host] Published live at /hosted/caregrid-intake'],
      publishedAt: now,
    },
  ];

  return {
    users,
    onboardingProfiles: [
      {
        userId: superAdminId,
        preferredTheme: 'light',
        discoverySource: 'Other',
        projectPurpose: 'Organization',
        projectScale: 'Enterprise',
        completedAt: now,
      },
      {
        userId: builderId,
        preferredTheme: 'light',
        discoverySource: 'Google',
        projectPurpose: 'Business',
        projectScale: 'Medium',
        completedAt: now,
      },
    ],
    sessions: [],
    passwordResets: [],
    plans,
    wallets,
    creditTransactions,
    subscriptions: [
      {
        id: 'sub_superadmin',
        userId: superAdminId,
        planId: 'plan_enterprise',
        status: 'active',
        billingCycle: 'annual',
        provider: 'internal',
        externalSubscriptionId: null,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(Date.now() + 365 * 86400000).toISOString(),
        createdAt: now,
      },
      {
        id: 'sub_builder',
        userId: builderId,
        planId: 'plan_pro',
        status: 'active',
        billingCycle: 'monthly',
        provider: 'internal',
        externalSubscriptionId: null,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: now,
      },
    ],
    payments: [],
    invoices: [],
    aiProviders,
    aiModels,
    taskRoutingRules,
    selfHostedConfig: {
      modelName: process.env.VEKTOR_MODEL_NAME || 'vektor-coder-1',
      inferenceServerUrl: process.env.VEKTOR_INFERENCE_URL || '',
      weightsPath: process.env.VEKTOR_MODEL_WEIGHTS_PATH || '',
      hasApiKey: Boolean(process.env.VEKTOR_INFERENCE_API_KEY),
      status: 'unconfigured',
      lastCheckedAt: null,
      lastMessage: 'Inference server URL and model weights path are not configured.',
    },
    vektorApiKeys: [
      {
        id: internalKeyId,
        userId: superAdminId,
        name: 'VEKTOR Internal Orchestrator Key',
        keyPrefix: rawInternalKey.slice(0, 18),
        keyHash: sha256(rawInternalKey),
        permissions: ['chat.completions', 'models.read', 'usage.read', 'orchestrator.internal'],
        rateLimitRpm: 5000,
        isInternal: true,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: now,
      },
    ],
    gatewayLogs: [],
    projects: showcaseProjects,
    projectFiles: showcaseFiles,
    projectVersions: [
      {
        id: 'ver_showcase_1',
        projectId: 'prj_showcase_treasury',
        versionNumber: 1,
        summary: 'Initial institutional treasury dashboard build',
        filesSnapshot: [{ path: 'index.html', content: SHOWCASE_TREASURY_HTML, language: 'html' }],
        createdAt: now,
      },
      {
        id: 'ver_showcase_2',
        projectId: 'prj_showcase_aeterna',
        versionNumber: 1,
        summary: 'Initial luxury stoneware storefront build',
        filesSnapshot: [{ path: 'index.html', content: SHOWCASE_COMMERCE_HTML, language: 'html' }],
        createdAt: now,
      },
      {
        id: 'ver_showcase_3',
        projectId: 'prj_showcase_caregrid',
        versionNumber: 1,
        summary: 'Initial clinical intake console build',
        filesSnapshot: [{ path: 'index.html', content: SHOWCASE_CLINIC_HTML, language: 'html' }],
        createdAt: now,
      },
    ],
    chatMessages: [],
    orchestrationJobs: [],
    deployments: showcaseDeployments,
    customDomains: [],
    githubConnections: [],
    errorLogs: [],
  };
}

let cachedState: VektorDatabaseState | null = null;

function reconcileStoreSchema(state: VektorDatabaseState): void {
  const defaults = createInitialState();
  // Ensure all default plans (including plan_basic) and dailyRequestLimit exist
  for (const defPlan of defaults.plans) {
    const existing = state.plans.find((p) => p.id === defPlan.id);
    if (!existing) {
      state.plans.push(defPlan);
    } else {
      if (typeof existing.dailyRequestLimit !== 'number') {
        existing.dailyRequestLimit = defPlan.dailyRequestLimit;
      }
      existing.sortOrder = defPlan.sortOrder;
    }
  }
  state.plans.sort((a, b) => a.sortOrder - b.sortOrder);

  for (const k of state.vektorApiKeys) {
    if (k.expiresAt === undefined) k.expiresAt = null;
  }

  // Ensure every registered user has at least one personal API key record
  for (const u of state.users) {
    const hasPersonalKey = state.vektorApiKeys.some((k) => k.userId === u.id && !k.isInternal);
    if (!hasPersonalKey) {
      const rawKey = generateSecureApiKey();
      state.vektorApiKeys.push({
        id: generateId('vkey'),
        userId: u.id,
        name: 'Default Developer Key',
        keyPrefix: rawKey.slice(0, 16),
        keyHash: sha256(rawKey),
        permissions: ['chat.completions', 'embeddings', 'models.read', 'usage.read'],
        rateLimitRpm: 20,
        isInternal: false,
        expiresAt: null,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

export function createDefaultApiKeyForUser(userId: string, rateLimitRpm = 20): { keyId: string; plaintextKey: string; keyPrefix: string } {
  const plaintextKey = generateSecureApiKey();
  const keyPrefix = plaintextKey.slice(0, 16);
  const keyId = generateId('vkey');
  mutateDb((db) => {
    db.vektorApiKeys.unshift({
      id: keyId,
      userId,
      name: 'Default Developer Key',
      keyPrefix,
      keyHash: sha256(plaintextKey),
      permissions: ['chat.completions', 'embeddings', 'models.read', 'usage.read'],
      rateLimitRpm,
      isInternal: false,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
    });
  });
  return { keyId, plaintextKey, keyPrefix };
}

function ensureStoreLoaded(): VektorDatabaseState {
  if (cachedState) return cachedState;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      cachedState = JSON.parse(raw) as VektorDatabaseState;
      reconcileStoreSchema(cachedState);
      // Refresh runtime env provider availability without wiping admin edits
      refreshEnvProviderStatus(cachedState);
      persistStore(cachedState);
      return cachedState;
    }
  } catch (err) {
    console.error('Failed to read store, reinitializing:', err);
  }
  cachedState = createInitialState();
  reconcileStoreSchema(cachedState);
  persistStore(cachedState);
  return cachedState;
}

function refreshEnvProviderStatus(state: VektorDatabaseState): void {
  const now = new Date().toISOString();
  for (const prov of state.aiProviders) {
    if (prov.kind === 'gemini') {
      prov.status = process.env.GEMINI_API_KEY || prov.encryptedApiKey ? 'available' : 'unconfigured';
      prov.lastCheckedAt = now;
    } else if (prov.kind === 'openai') {
      prov.status = process.env.OPENAI_API_KEY || prov.encryptedApiKey ? 'available' : 'unconfigured';
      prov.lastCheckedAt = now;
    } else if (prov.kind === 'deepseek') {
      prov.status = process.env.DEEPSEEK_API_KEY || prov.encryptedApiKey ? 'available' : 'unconfigured';
      prov.lastCheckedAt = now;
    }
  }
}

export function persistStore(state: VektorDatabaseState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

export function getDb(): VektorDatabaseState {
  return ensureStoreLoaded();
}

export function mutateDb<T>(fn: (state: VektorDatabaseState) => T): T {
  const state = ensureStoreLoaded();
  const result = fn(state);
  persistStore(state);
  return result;
}

export function logSystemError(source: string, severity: 'info' | 'warn' | 'error' | 'critical', message: string, context: Record<string, unknown> = {}): void {
  try {
    mutateDb((db) => {
      db.errorLogs.unshift({
        id: generateId('err'),
        source,
        severity,
        message,
        context,
        createdAt: new Date().toISOString(),
      });
      if (db.errorLogs.length > 500) {
        db.errorLogs = db.errorLogs.slice(0, 500);
      }
    });
  } catch (e) {
    console.error('Failed to record error log:', e);
  }
}

export function getOrCreateWallet(userId: string): WalletRecord {
  return mutateDb((db) => {
    let wallet = db.wallets.find((w) => w.userId === userId);
    if (!wallet) {
      wallet = {
        userId,
        balanceCredits: 500,
        lifetimeCreditsPurchased: 0,
        lifetimeCreditsUsed: 0,
        lowCreditThreshold: 100,
        updatedAt: new Date().toISOString(),
      };
      db.wallets.push(wallet);
      db.creditTransactions.unshift({
        id: generateId('txn'),
        userId,
        type: 'grant',
        amount: 500,
        balanceAfter: 500,
        idempotencyKey: `wallet:init:${userId}`,
        referenceId: 'plan_free',
        description: 'Free plan initial credit grant',
        metadata: {},
        createdAt: new Date().toISOString(),
      });
    }
    return wallet;
  });
}

export function applyWalletCredit(params: {
  userId: string;
  amount: number;
  type: CreditTransactionRecord['type'];
  idempotencyKey: string;
  referenceId: string | null;
  description: string;
  metadata?: Record<string, unknown>;
}): { ok: boolean; duplicate?: boolean; balanceAfter: number; error?: string } {
  return mutateDb((db) => {
    const existing = db.creditTransactions.find((t) => t.idempotencyKey === params.idempotencyKey);
    const wallet = db.wallets.find((w) => w.userId === params.userId);
    if (!wallet) {
      return { ok: false, balanceAfter: 0, error: 'Wallet not found' };
    }
    if (existing) {
      return { ok: true, duplicate: true, balanceAfter: existing.balanceAfter };
    }
    if (params.amount < 0 && wallet.balanceCredits + params.amount < 0) {
      return { ok: false, balanceAfter: wallet.balanceCredits, error: 'Insufficient credits' };
    }
    wallet.balanceCredits += params.amount;
    if (params.amount > 0 && params.type === 'topup') {
      wallet.lifetimeCreditsPurchased += params.amount;
    }
    if (params.amount < 0 && params.type === 'deduction') {
      wallet.lifetimeCreditsUsed += Math.abs(params.amount);
    }
    wallet.updatedAt = new Date().toISOString();

    db.creditTransactions.unshift({
      id: generateId('txn'),
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      balanceAfter: wallet.balanceCredits,
      idempotencyKey: params.idempotencyKey,
      referenceId: params.referenceId,
      description: params.description,
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
    });
    return { ok: true, balanceAfter: wallet.balanceCredits };
  });
}
