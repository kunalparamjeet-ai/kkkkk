import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Check,
  Copy,
  CreditCard,
  Edit3,
  Key,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  User,
  Zap,
} from 'lucide-react';
import { useApp, type ClientPlan } from '../contexts/AppContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { TopNav } from '../components/TopNav.tsx';

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  rateLimitRpm: number;
  isInternal: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  requestsCount?: number;
  tokensUsed?: number;
  creditsUsed?: number;
}

interface GatewayLogItem {
  id: string;
  apiKeyId: string | null;
  endpoint: string;
  requestedModel: string;
  routedModel: string;
  promptTokens: number;
  completionTokens: number;
  creditsCharged: number;
  latencyMs: number;
  statusCode: number;
  errorMessage: string | null;
  createdAt: string;
}

interface UsageSummary {
  creditsRemaining: number;
  lifetimeCreditsUsed: number;
  lowCreditThreshold?: number;
  requestsToday: number;
  dailyRequestLimit: number;
  totalRequests: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRatePct?: number;
  rateLimitRpm: number;
  activePlan: {
    id: string;
    slug: string;
    name: string;
    monthlyCredits: number;
    rateLimitRpm: number;
    dailyRequestLimit: number;
  } | null;
  subscriptionPeriodEnd?: string | null;
}

interface DailyUsagePoint {
  date: string;
  requests: number;
  okRequests: number;
  errorRequests: number;
  tokens: number;
  credits: number;
}

interface ModelUsagePoint {
  model: string;
  requests: number;
  tokens: number;
  credits: number;
}

interface SelfHostedStatus {
  installed: boolean;
  configured: boolean;
  status: string;
  modelName: string;
  discoveredModels: string[];
  runtimeDetected: string | null;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  message: string;
}

interface CatalogModelItem {
  id: string;
  displayName: string;
  roleTag: string;
  engineTier: 'self_hosted' | 'managed_cloud';
  installed: boolean;
  available: boolean;
  inputCreditsPer1k: number;
  outputCreditsPer1k: number;
}

interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: string;
  issuedAt: string;
}

interface SessionItem {
  id: string;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

type DashboardTab = 'overview' | 'keys' | 'docs' | 'billing' | 'account';

const ALL_SCOPES = [
  { id: 'chat.completions', label: 'chat.completions' },
  { id: 'embeddings', label: 'embeddings' },
  { id: 'models.read', label: 'models.read' },
  { id: 'usage.read', label: 'usage.read' },
] as const;

export function ApiGatewayPage() {
  const { user, theme, setTheme, navigate, refreshAuth } = useApp();
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t === 'keys' || t === 'docs' || t === 'billing' || t === 'account' || t === 'overview') {
        return t;
      }
    }
    return 'overview';
  });

  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [logs, setLogs] = useState<GatewayLogItem[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageByDay, setUsageByDay] = useState<DailyUsagePoint[]>([]);
  const [usageByModel, setUsageByModel] = useState<ModelUsagePoint[]>([]);
  const [selfHostedStatus, setSelfHostedStatus] = useState<SelfHostedStatus | null>(null);
  const [catalogModels, setCatalogModels] = useState<CatalogModelItem[]>([]);
  const [plans, setPlans] = useState<ClientPlan[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [gateways, setGateways] = useState({ razorpayConfigured: false, stripeConfigured: false });

  // Key creation & editing state
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'chat.completions',
    'embeddings',
    'models.read',
    'usage.read',
  ]);
  const [expiresInDays, setExpiresInDays] = useState<string>('never');
  const [customRpm, setCustomRpm] = useState<string>('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editKeyName, setEditKeyName] = useState('');
  const [editKeyRpm, setEditKeyRpm] = useState('');
  const [editKeyScopes, setEditKeyScopes] = useState<string[]>([]);

  // Docs & Playground state
  const [docTab, setDocTab] = useState<'curl' | 'typescript' | 'python' | 'streaming' | 'embeddings' | 'headers'>('curl');
  const [testPrompt, setTestPrompt] = useState('Write a TypeScript sliding-window rate limiter.');
  const [testModel, setTestModel] = useState('vektor-auto');
  const [playgroundKey, setPlaygroundKey] = useState('');
  const [authHeaderMode, setAuthHeaderMode] = useState<'bearer' | 'x-api-key'>('bearer');
  const [streamMode, setStreamMode] = useState(false);
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [testHeadersInfo, setTestHeadersInfo] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Logs filter & Plans state
  const [logSearch, setLogSearch] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState<'all' | 'ok' | 'error'>('all');
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [checkoutProvider, setCheckoutProvider] = useState<'razorpay' | 'stripe'>('razorpay');
  const [planLoadingId, setPlanLoadingId] = useState<string | null>(null);

  // Account & Preferences state
  const [profileName, setProfileName] = useState('');
  const [lowCreditThreshold, setLowCreditThreshold] = useState('100');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-vektor-host';

  const loadData = async () => {
    try {
      if (user) {
        const [res, sessRes] = await Promise.all([
          apiRequest<{
            keys: ApiKeyItem[];
            logs: GatewayLogItem[];
            usageSummary: UsageSummary;
            usageByDay: DailyUsagePoint[];
            usageByModel: ModelUsagePoint[];
            selfHostedStatus: SelfHostedStatus;
            models: CatalogModelItem[];
            plans: ClientPlan[];
            invoices: InvoiceSummary[];
            gateways: { razorpayConfigured: boolean; stripeConfigured: boolean };
          }>('/api/keys'),
          apiRequest<{ sessions: SessionItem[] }>('/api/auth/sessions').catch(() => ({ sessions: [] })),
        ]);
        setKeys(res.keys);
        setLogs(res.logs);
        setUsage(res.usageSummary);
        setUsageByDay(res.usageByDay || []);
        setUsageByModel(res.usageByModel || []);
        setSelfHostedStatus(res.selfHostedStatus || null);
        setCatalogModels(res.models || []);
        setPlans(res.plans);
        setInvoices(res.invoices || []);
        setGateways(res.gateways);
        setSessions(sessRes.sessions || []);
        setProfileName(user.name);
        if (typeof res.usageSummary.lowCreditThreshold === 'number') {
          setLowCreditThreshold(String(res.usageSummary.lowCreditThreshold));
        }
      } else {
        const [pRes, bRes] = await Promise.all([
          apiRequest<{
            plans: ClientPlan[];
            gateways: { razorpayConfigured: boolean; stripeConfigured: boolean };
          }>('/api/billing/plans'),
          apiRequest<{
            models: Array<{
              id: string;
              displayName: string;
              roleTag: string;
              available: boolean;
              inputCreditsPer1k: number;
              outputCreditsPer1k: number;
            }>;
          }>('/api/public/bootstrap').catch(() => ({ models: [] })),
        ]);
        setPlans(pRes.plans);
        setGateways(pRes.gateways);
        setCatalogModels(
          (bRes.models || []).map((m) => ({
            id: m.id,
            displayName: m.displayName,
            roleTag: m.roleTag,
            engineTier: m.id.includes('vektor-') ? 'self_hosted' : 'managed_cloud',
            installed: m.available,
            available: m.available,
            inputCreditsPer1k: m.inputCreditsPer1k,
            outputCreditsPer1k: m.outputCreditsPer1k,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load developer dashboard');
    }
  };

  useEffect(() => {
    void loadData();
  }, [user]);

  const copyText = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 1800);
  };

  const toggleScope = (scope: string, target: 'create' | 'edit') => {
    const setter = target === 'create' ? setSelectedScopes : setEditKeyScopes;
    setter((prev) => {
      if (prev.includes(scope)) {
        return prev.length > 1 ? prev.filter((s) => s !== scope) : prev;
      }
      return [...prev, scope];
    });
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        name: newKeyName.trim(),
        permissions: selectedScopes,
      };
      if (expiresInDays !== 'never') {
        payload.expiresInDays = Number(expiresInDays);
      }
      if (customRpm.trim() && Number(customRpm) > 0) {
        payload.rateLimitRpm = Number(customRpm);
      }
      const res = await apiRequest<{ plaintextKey: string }>('/api/keys', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setRevealedKey(res.plaintextKey);
      setNewKeyName('');
      setCustomRpm('');
      setNotice('New VEKTOR API key generated and hashed.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    }
  };

  const startEditKey = (k: ApiKeyItem) => {
    setEditingKeyId(k.id);
    setEditKeyName(k.name);
    setEditKeyRpm(String(k.rateLimitRpm));
    setEditKeyScopes(k.permissions);
  };

  const handleSaveKeyEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKeyId) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/keys/${editingKeyId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editKeyName.trim(),
          rateLimitRpm: Number(editKeyRpm) || undefined,
          permissions: editKeyScopes,
        }),
      });
      setEditingKeyId(null);
      setNotice('API key permissions and limits updated.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update API key');
    }
  };

  const handleRotateKey = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ plaintextKey: string }>(`/api/keys/${id}/rotate`, { method: 'POST' });
      setRevealedKey(res.plaintextKey);
      setNotice('API key rotated. Previous key hash is now invalid.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate API key');
    }
  };

  const handleRevokeKey = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/keys/${id}`, { method: 'DELETE' });
      setNotice('API key revoked immediately.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key');
    }
  };

  const executePlayground = async (mode: 'completions' | 'embeddings' | 'models' | 'usage') => {
    if (!user && !playgroundKey.trim()) {
      navigate('/auth');
      return;
    }
    setTesting(true);
    setTestResponse(null);
    setTestHeadersInfo(null);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const trimmedKey = playgroundKey.trim();
      if (trimmedKey) {
        if (authHeaderMode === 'x-api-key') {
          headers['x-api-key'] = trimmedKey;
        } else {
          headers['Authorization'] = `Bearer ${trimmedKey}`;
        }
      }

      const url =
        mode === 'usage'
          ? '/v1/usage'
          : mode === 'models'
            ? '/v1/models'
            : mode === 'embeddings'
              ? '/v1/embeddings'
              : '/v1/chat/completions';

      const isGet = mode === 'usage' || mode === 'models';
      const bodyPayload =
        mode === 'embeddings'
          ? { model: testModel, input: testPrompt }
          : mode === 'completions'
            ? {
                model: testModel,
                messages: [{ role: 'user', content: testPrompt }],
                stream: streamMode,
              }
            : undefined;

      const fetchRes = await fetch(url, {
        method: isGet ? 'GET' : 'POST',
        headers,
        credentials: trimmedKey ? 'omit' : 'include',
        body: bodyPayload ? JSON.stringify(bodyPayload) : undefined,
      });

      const rlLimit = fetchRes.headers.get('X-RateLimit-Limit');
      const rlRem = fetchRes.headers.get('X-RateLimit-Remaining');
      const dlLimit = fetchRes.headers.get('X-DailyLimit-Limit');
      const dlRem = fetchRes.headers.get('X-DailyLimit-Remaining');
      const reqId = fetchRes.headers.get('X-Request-Id');
      const headerSummary = [
        `HTTP ${fetchRes.status}`,
        reqId ? `Request: ${reqId}` : null,
        rlLimit ? `RPM: ${rlRem}/${rlLimit}` : null,
        dlLimit ? `Daily: ${dlRem}/${dlLimit}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      setTestHeadersInfo(headerSummary);

      if (mode === 'completions' && streamMode && fetchRes.ok && fetchRes.body) {
        const reader = fetchRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assembled = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assembled += delta;
                setTestResponse(assembled);
              }
            } catch {
              // ignore non-json SSE lines
            }
          }
        }
      } else {
        const data = await fetchRes.json();
        setTestResponse(JSON.stringify(data, null, 2));
      }

      if (user) {
        await loadData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gateway request failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSelectPlan = async (planId: string) => {
    if (!user) {
      navigate('/auth');
      return;
    }
    setError(null);
    setNotice(null);
    setPlanLoadingId(planId);
    try {
      const res = await apiRequest<{
        activatedFreePlan?: boolean;
        provider?: string;
        checkoutUrl?: string;
        orderId?: string;
        amount?: number;
        currency?: string;
      }>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          kind: 'subscription',
          planId,
          provider: checkoutProvider,
          billingCycle: 'monthly',
        }),
      });
      if (res.activatedFreePlan) {
        setNotice('Switched to Free plan.');
        await refreshAuth();
        await loadData();
      } else if (res.provider === 'stripe' && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else if (res.provider === 'razorpay' && res.orderId) {
        setNotice(
          `Razorpay Order ${res.orderId} created (${res.currency} ${((res.amount || 0) / 100).toFixed(2)}). Complete verification in Billing to activate credits and rate limits.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan checkout failed');
    } finally {
      setPlanLoadingId(null);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await Promise.all([
        apiRequest('/api/auth/profile', {
          method: 'PUT',
          body: JSON.stringify({ name: profileName.trim(), preferredTheme: theme }),
        }),
        apiRequest('/api/billing/wallet/preferences', {
          method: 'PATCH',
          body: JSON.stringify({ lowCreditThreshold: Number(lowCreditThreshold) || 0 }),
        }),
      ]);
      setNotice('Customer profile and alert preferences saved.');
      await refreshAuth();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/password/change', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setError(null);
    try {
      await apiRequest(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
      setNotice('Session revoked.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session');
    }
  };

  const curlExample = `curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_VEKTOR_API_KEY" \\
  -d '{
    "model": "vektor-auto",
    "messages": [
      { "role": "user", "content": "Build an Express rate limiter middleware." }
    ]
  }'`;

  const tsExample = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.VEKTOR_API_KEY,
  baseURL: "${origin}/v1",
});

const completion = await client.chat.completions.create({
  model: "vektor-auto",
  messages: [{ role: "user", content: "Create a PostgreSQL pagination helper." }],
});`;

  const pythonExample = `import requests

resp = requests.post(
    "${origin}/v1/chat/completions",
    headers={
        "x-api-key": "YOUR_VEKTOR_API_KEY",
        "Content-Type": "application/json",
    },
    json={
        "model": "vektor-auto",
        "messages": [{"role": "user", "content": "Explain API key rotation."}],
    },
)
print(resp.json())`;

  const streamingExample = `curl -N ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_VEKTOR_API_KEY" \\
  -d '{
    "model": "vektor-auto",
    "stream": true,
    "messages": [{ "role": "user", "content": "Stream a deployment checklist." }]
  }'`;

  const embeddingsExample = `curl ${origin}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_VEKTOR_API_KEY" \\
  -d '{
    "model": "vektor-auto",
    "input": ["VEKTOR-AI independent gateway architecture"]
  }'`;

  const visiblePlans = showAllPlans
    ? plans
    : plans.filter((p) => ['free', 'basic', 'pro', 'enterprise'].includes(p.slug));

  const filteredLogs = logs.filter((l) => {
    if (logStatusFilter === 'ok' && l.statusCode >= 400) return false;
    if (logStatusFilter === 'error' && l.statusCode < 400) return false;
    if (logSearch.trim()) {
      const q = logSearch.trim().toLowerCase();
      return (
        l.endpoint.toLowerCase().includes(q) ||
        l.requestedModel.toLowerCase().includes(q) ||
        l.routedModel.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const dailyPct =
    usage && usage.dailyRequestLimit > 0
      ? Math.min(100, Math.round((usage.requestsToday / usage.dailyRequestLimit) * 100))
      : 0;

  const maxDayRequests = Math.max(1, ...usageByDay.map((d) => d.requests));

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100">
      <TopNav />
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* TOP HEADER + SEGMENTED NAV */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
          <div>
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1.5">
              VEKTOR-AI Developer Platform · Independent API Gateway
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Developer Dashboard &amp; API Gateway
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 max-w-2xl">
              Manage cryptographic VEKTOR API keys, inspect real-time usage analytics and rate limits, test /v1 endpoints, and configure billing or customer account settings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate('/billing')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Full Wallet &amp; Invoices</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/workspace')}
                  className="px-3.5 py-2 rounded-lg bg-zinc-950 dark:bg-blue-600 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open Studio
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/auth')}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                Sign In to Manage Keys
              </button>
            )}
          </div>
        </div>

        {/* DASHBOARD TAB BAR */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl w-fit">
          {(
            [
              ['overview', 'Overview & Analytics', BarChart3],
              ['keys', 'API Keys', Key],
              ['docs', 'Docs & Playground', BookOpen],
              ['billing', 'Rate Limits & Billing', CreditCard],
              ['account', 'Account', User],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === id
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-sm text-emerald-800 dark:text-emerald-200">
            {notice}
          </div>
        )}

        {revealedKey && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                Copy your VEKTOR API key now — only its SHA-256 hash is stored on the server.
              </span>
              <button
                type="button"
                onClick={() => setRevealedKey(null)}
                className="text-xs text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 bg-white dark:bg-zinc-950 px-3 py-2.5 rounded-lg border border-emerald-300 dark:border-emerald-800">
              <code className="font-mono text-xs break-all select-all">{revealedKey}</code>
              <button
                type="button"
                onClick={() => copyText(revealedKey, 'revealed')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 shrink-0 cursor-pointer"
              >
                {copiedId === 'revealed' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedId === 'revealed' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: OVERVIEW & ANALYTICS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {user && usage ? (
              <>
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Remaining Credits</span>
                      <Zap className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="font-mono text-2xl font-bold tabular-nums mt-2">
                      {usage.creditsRemaining.toLocaleString()}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Plan: {usage.activePlan?.name || 'Free'} · Used: {usage.lifetimeCreditsUsed.toLocaleString()}
                    </div>
                  </div>

                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Daily API Requests</span>
                      <Activity className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="font-mono text-2xl font-bold tabular-nums mt-2">
                      {usage.requestsToday} / {usage.dailyRequestLimit.toLocaleString()}
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all"
                        style={{ width: `${dailyPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Rate Limit Ceiling</span>
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="font-mono text-2xl font-bold tabular-nums mt-2">
                      {usage.rateLimitRpm} RPM
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 font-mono tabular-nums">
                      Total calls: {usage.totalRequests.toLocaleString()} · {usage.successRatePct ?? 100}% OK
                    </div>
                  </div>

                  <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Gateway Throughput</span>
                      <Key className="w-3.5 h-3.5 text-blue-600" />
                    </div>
                    <div className="font-mono text-2xl font-bold tabular-nums mt-2">
                      {usage.totalTokens.toLocaleString()} tok
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 font-mono tabular-nums">
                      Avg latency: {usage.avgLatencyMs}ms
                    </div>
                  </div>
                </section>

                {/* 14-DAY ANALYTICS + MODEL USAGE BREAKDOWN */}
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-base font-bold">14-Day API Request Volume</h2>
                      <span className="text-xs font-mono text-zinc-500 tabular-nums">
                        {usage.totalRequests} total requests
                      </span>
                    </div>
                    <div className="h-44 flex items-end gap-1.5 pt-4 border-b border-zinc-200 dark:border-zinc-800 pb-2">
                      {usageByDay.map((d) => {
                        const heightPct = d.requests > 0 ? Math.max(8, Math.round((d.requests / maxDayRequests) * 100)) : 3;
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                            <div
                              title={`${d.date}: ${d.requests} reqs · ${d.tokens} tok`}
                              className={`w-full rounded-t transition-colors ${
                                d.requests > 0 ? 'bg-blue-600 dark:bg-blue-500' : 'bg-zinc-200 dark:bg-zinc-800'
                              }`}
                              style={{ height: `${heightPct}%` }}
                            />
                            <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                              {d.date.slice(8)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-xs text-zinc-500 flex justify-between">
                      <span>Hover bars for daily request &amp; token totals</span>
                      <span className="font-mono tabular-nums">UTC Daily Buckets</span>
                    </div>
                  </div>

                  <div className="lg:col-span-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                    <h2 className="font-display text-base font-bold">Usage by Model</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                            <th className="pb-2">Routed Model</th>
                            <th className="pb-2 text-right">Requests</th>
                            <th className="pb-2 text-right">Tokens</th>
                            <th className="pb-2 text-right">Credits</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 font-mono tabular-nums">
                          {usageByModel.map((m) => (
                            <tr key={m.model}>
                              <td className="py-2 pr-2 font-medium text-zinc-900 dark:text-zinc-100">{m.model}</td>
                              <td className="py-2 pr-2 text-right">{m.requests}</td>
                              <td className="py-2 pr-2 text-right">{m.tokens.toLocaleString()}</td>
                              <td className="py-2 text-right">{m.credits}</td>
                            </tr>
                          ))}
                          {usageByModel.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-6 text-center text-zinc-500 font-sans">
                                No gateway calls recorded yet. Run a request in Docs &amp; Playground.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center space-y-3">
                <h2 className="font-display text-lg font-bold">Sign in to inspect your API usage analytics</h2>
                <p className="text-sm text-zinc-500 max-w-lg mx-auto">
                  Track daily quotas, RPM limits, per-key throughput, and credit deductions across every VEKTOR API Gateway request.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/auth')}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                >
                  Sign In / Register
                </button>
              </div>
            )}

            {/* HONEST ENGINE READINESS & SELF-HOSTED ARCHITECTURE */}
            <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-blue-600" />
                    <h2 className="font-display text-base font-bold">AI Engine &amp; Self-Hosted Model Status</h2>
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {selfHostedStatus
                      ? selfHostedStatus.installed
                        ? `Self-hosted open-source engine online (${selfHostedStatus.runtimeDetected || 'Inference Server'}${typeof selfHostedStatus.latencyMs === 'number' ? `, ${selfHostedStatus.latencyMs}ms` : ''}).`
                        : selfHostedStatus.message
                      : 'Self-hosted open-source inference engine is checked live on the server. When VEKTOR_INFERENCE_URL is not configured, no unconfigured local model is fabricated.'}
                  </p>
                </div>
                {user && (user.role === 'admin' || user.role === 'super_admin') && (
                  <button
                    type="button"
                    onClick={() => navigate('/admin')}
                    className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Configure in Admin
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="pb-2">Model ID</th>
                      <th className="pb-2">Role</th>
                      <th className="pb-2">Engine Tier</th>
                      <th className="pb-2">Readiness</th>
                      <th className="pb-2 text-right">Credits / 1k (In / Out)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {catalogModels.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2.5 pr-3 font-mono font-medium">{m.id}</td>
                        <td className="py-2.5 pr-3 text-zinc-600 dark:text-zinc-400">{m.roleTag}</td>
                        <td className="py-2.5 pr-3 font-mono text-[11px]">
                          {m.engineTier === 'self_hosted' ? 'Self-Hosted Open-Source' : 'Managed Cloud Adapter'}
                        </td>
                        <td
                          className={`py-2.5 pr-3 font-medium ${
                            m.available
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {m.available
                            ? 'Ready'
                            : m.engineTier === 'self_hosted'
                              ? 'Not Installed / Unconfigured'
                              : 'Server Key Not Set'}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums">
                          {m.inputCreditsPer1k} / {m.outputCreditsPer1k}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: API KEYS */}
        {activeTab === 'keys' && (
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-bold">VEKTOR Customer API Keys</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Keys are generated with 256-bit CSPRNG entropy and stored strictly as SHA-256 hashes. Third-party upstream keys are never exposed.
                </p>
              </div>
              {!user && (
                <button
                  type="button"
                  onClick={() => navigate('/auth')}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                >
                  Sign in to manage API keys
                </button>
              )}
            </div>

            {user && (
              <>
                <form
                  onSubmit={handleCreateKey}
                  className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-[11px] font-medium text-zinc-500 mb-1">Key Name</label>
                      <input
                        type="text"
                        required
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="Production Backend Service"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-500 mb-1">Expiration</label>
                      <select
                        value={expiresInDays}
                        onChange={(e) => setExpiresInDays(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      >
                        <option value="never">Never expires</option>
                        <option value="30">30 days</option>
                        <option value="90">90 days</option>
                        <option value="365">1 year</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-500 mb-1">
                        RPM Cap (Max {usage?.rateLimitRpm ?? 20})
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={usage?.rateLimitRpm ?? 5000}
                        value={customRpm}
                        onChange={(e) => setCustomRpm(e.target.value)}
                        placeholder={String(usage?.rateLimitRpm ?? 20)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <span className="text-zinc-500 font-medium">Permissions:</span>
                      {ALL_SCOPES.map((sc) => (
                        <label key={sc.id} className="inline-flex items-center gap-1.5 cursor-pointer font-mono">
                          <input
                            type="checkbox"
                            checked={selectedScopes.includes(sc.id)}
                            onChange={() => toggleScope(sc.id, 'create')}
                            className="rounded border-zinc-300 text-blue-600"
                          />
                          <span>{sc.label}</span>
                        </label>
                      ))}
                    </div>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Generate API Key</span>
                    </button>
                  </div>
                </form>

                {editingKeyId && (
                  <form
                    onSubmit={handleSaveKeyEdit}
                    className="p-4 rounded-xl bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Edit Key Permissions &amp; RPM</span>
                      <button
                        type="button"
                        onClick={() => setEditingKeyId(null)}
                        className="text-xs text-zinc-500 hover:underline cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        type="text"
                        required
                        value={editKeyName}
                        onChange={(e) => setEditKeyName(e.target.value)}
                        className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      />
                      <input
                        type="number"
                        min={1}
                        max={usage?.rateLimitRpm ?? 5000}
                        value={editKeyRpm}
                        onChange={(e) => setEditKeyRpm(e.target.value)}
                        className="px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                      >
                        Save Changes
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs font-mono">
                      {ALL_SCOPES.map((sc) => (
                        <label key={sc.id} className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editKeyScopes.includes(sc.id)}
                            onChange={() => toggleScope(sc.id, 'edit')}
                          />
                          <span>{sc.label}</span>
                        </label>
                      ))}
                    </div>
                  </form>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="pb-2.5">Name &amp; Scopes</th>
                        <th className="pb-2.5">Prefix</th>
                        <th className="pb-2.5">Limit</th>
                        <th className="pb-2.5 text-right">Usage</th>
                        <th className="pb-2.5">Last Used / Expires</th>
                        <th className="pb-2.5">Status</th>
                        <th className="pb-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {keys.map((k) => {
                        const isExpired = Boolean(k.expiresAt && Date.parse(k.expiresAt) <= Date.now());
                        const statusLabel = k.revokedAt ? 'Revoked' : isExpired ? 'Expired' : 'Active';
                        return (
                          <tr key={k.id}>
                            <td className="py-3 pr-4">
                              <div className="font-medium">
                                {k.name} {k.isInternal ? '· Internal' : ''}
                              </div>
                              <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                                {k.permissions.join(' · ')}
                              </div>
                            </td>
                            <td className="py-3 pr-4 font-mono">
                              <div className="inline-flex items-center gap-2">
                                <span>{k.keyPrefix}•••</span>
                                <button
                                  type="button"
                                  onClick={() => copyText(k.keyPrefix, `prefix:${k.id}`)}
                                  title="Copy prefix identifier"
                                  className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
                                >
                                  {copiedId === `prefix:${k.id}` ? (
                                    <Check className="w-3 h-3 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 pr-4 font-mono tabular-nums">{k.rateLimitRpm} RPM</td>
                            <td className="py-3 pr-4 text-right font-mono tabular-nums text-[11px]">
                              <div>{k.requestsCount ?? 0} req</div>
                              <div className="text-zinc-500">{(k.tokensUsed ?? 0).toLocaleString()} tok</div>
                            </td>
                            <td className="py-3 pr-4 text-zinc-500 font-mono text-[11px]">
                              <div>Used: {k.lastUsedAt ? k.lastUsedAt.slice(0, 10) : 'Never'}</div>
                              <div>Exp: {k.expiresAt ? k.expiresAt.slice(0, 10) : 'Never'}</div>
                            </td>
                            <td
                              className={`py-3 pr-4 font-medium ${
                                statusLabel === 'Active'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {statusLabel}
                            </td>
                            <td className="py-3 text-right space-x-3 whitespace-nowrap">
                              {!k.revokedAt && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => startEditKey(k)}
                                    className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300 hover:underline cursor-pointer"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRotateKey(k.id)}
                                    title="Rotate and regenerate secret key"
                                    className="inline-flex items-center gap-1 text-blue-600 hover:underline cursor-pointer"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    <span>Regenerate</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRevokeKey(k.id)}
                                    className="inline-flex items-center gap-1 text-red-600 hover:underline cursor-pointer"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Revoke</span>
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {keys.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-zinc-500">
                            No API keys found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* TAB 3: DOCS & LIVE PLAYGROUND */}
        {activeTab === 'docs' && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold">VEKTOR-AI API Documentation</h2>
                <div className="inline-flex flex-wrap gap-1 p-1 bg-zinc-100 dark:bg-zinc-950 rounded-lg text-xs">
                  {(
                    [
                      ['curl', 'cURL'],
                      ['typescript', 'TypeScript'],
                      ['python', 'Python'],
                      ['streaming', 'SSE Stream'],
                      ['embeddings', 'Embeddings'],
                      ['headers', 'Auth & Errors'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDocTab(id)}
                      className={`px-2.5 py-1 rounded cursor-pointer ${
                        docTab === id ? 'bg-white dark:bg-zinc-800 font-medium shadow-sm' : 'text-zinc-500'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs text-zinc-500 space-y-1.5">
                <div>
                  <code className="font-mono text-zinc-900 dark:text-zinc-100">GET /v1/health</code> — Gateway &amp; self-hosted inference availability
                </div>
                <div>
                  <code className="font-mono text-zinc-900 dark:text-zinc-100">GET /v1/models</code> &amp; <code className="font-mono text-zinc-900 dark:text-zinc-100">/v1/models/:id</code> — Model catalog &amp; readiness (<code className="font-mono">models.read</code>)
                </div>
                <div>
                  <code className="font-mono text-zinc-900 dark:text-zinc-100">GET /v1/usage</code> — Remaining credits, daily quota, &amp; analytics (<code className="font-mono">usage.read</code>)
                </div>
                <div>
                  <code className="font-mono text-zinc-900 dark:text-zinc-100">POST /v1/chat/completions</code> — Completions &amp; token SSE streaming (<code className="font-mono">chat.completions</code>)
                </div>
                <div>
                  <code className="font-mono text-zinc-900 dark:text-zinc-100">POST /v1/embeddings</code> — Vector embeddings endpoint (<code className="font-mono">embeddings</code>)
                </div>
              </div>

              {docTab !== 'headers' ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        docTab === 'curl'
                          ? curlExample
                          : docTab === 'typescript'
                            ? tsExample
                            : docTab === 'python'
                              ? pythonExample
                              : docTab === 'streaming'
                                ? streamingExample
                                : embeddingsExample,
                        `doc:${docTab}`
                      )
                    }
                    className="absolute right-3 top-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 text-zinc-200 text-[11px] hover:bg-zinc-700 cursor-pointer"
                  >
                    {copiedId === `doc:${docTab}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedId === `doc:${docTab}` ? 'Copied' : 'Copy'}</span>
                  </button>
                  <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-100 font-mono text-[11px] overflow-x-auto">
                    {docTab === 'curl'
                      ? curlExample
                      : docTab === 'typescript'
                        ? tsExample
                        : docTab === 'python'
                          ? pythonExample
                          : docTab === 'streaming'
                            ? streamingExample
                            : embeddingsExample}
                  </pre>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-[11px] space-y-2">
                  <div># Authentication (either header accepted)</div>
                  <div>Authorization: Bearer vk_live_...</div>
                  <div>x-api-key: vk_live_...</div>
                  <div className="pt-2"># Response Headers</div>
                  <div>X-Request-Id · X-RateLimit-Limit · X-RateLimit-Remaining · X-RateLimit-Reset</div>
                  <div>X-DailyLimit-Limit · X-DailyLimit-Remaining</div>
                  <div className="pt-2"># Status Codes</div>
                  <div>401 Unauthorized (invalid / revoked / expired key)</div>
                  <div>402 Insufficient Credits · 403 Missing Scope · 429 Quota Exceeded</div>
                  <div>503 Requested self-hosted model not installed/running on server</div>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
              <h2 className="font-display text-lg font-bold">Live Gateway Test Console</h2>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-zinc-500 mb-1">
                      VEKTOR API Key (optional — defaults to active session)
                    </label>
                    <input
                      type="password"
                      value={playgroundKey}
                      onChange={(e) => setPlaygroundKey(e.target.value)}
                      placeholder="vk_live_..."
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Auth Header</label>
                    <select
                      value={authHeaderMode}
                      onChange={(e) => setAuthHeaderMode(e.target.value as 'bearer' | 'x-api-key')}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    >
                      <option value="bearer">Authorization: Bearer</option>
                      <option value="x-api-key">x-api-key</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-zinc-500 mb-1">Model</label>
                    <select
                      value={testModel}
                      onChange={(e) => setTestModel(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    >
                      <option value="vektor-auto">vektor-auto (Smart Router · Active Engine)</option>
                      {catalogModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id} ({m.available ? 'Ready' : m.engineTier === 'self_hosted' ? 'Unconfigured' : 'No Key'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium pb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={streamMode}
                      onChange={(e) => setStreamMode(e.target.checked)}
                    />
                    <span>Stream SSE tokens</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Prompt / Input Text</label>
                  <textarea
                    rows={3}
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void executePlayground('completions')}
                    disabled={testing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{testing ? 'Executing...' : 'POST /v1/chat/completions'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void executePlayground('embeddings')}
                    disabled={testing}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <span>/v1/embeddings</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void executePlayground('models')}
                    disabled={testing}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <span>/v1/models</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void executePlayground('usage')}
                    disabled={testing}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>/v1/usage</span>
                  </button>
                </div>
                {testHeadersInfo && (
                  <div className="text-[11px] font-mono text-zinc-500">{testHeadersInfo}</div>
                )}
                {testResponse !== null && (
                  <pre className="p-3.5 rounded-xl bg-zinc-950 text-zinc-100 font-mono text-[11px] max-h-64 overflow-auto whitespace-pre-wrap">
                    {testResponse}
                  </pre>
                )}
              </div>
            </div>
          </section>
        )}

        {/* TAB 4: RATE LIMITS, BILLING & REQUEST LOGS */}
        {activeTab === 'billing' && (
          <div className="space-y-6">
            <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold">API Subscription Plans &amp; Rate Tiers</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Upgrade RPM ceilings, daily request quotas, and monthly VEKTOR-AI compute credits.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setCheckoutProvider('razorpay')}
                      className={`px-2.5 py-1 rounded cursor-pointer ${
                        checkoutProvider === 'razorpay' ? 'bg-white dark:bg-zinc-800 font-medium shadow-sm' : 'text-zinc-500'
                      }`}
                    >
                      Razorpay {gateways.razorpayConfigured ? '' : '(Key Req)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCheckoutProvider('stripe')}
                      className={`px-2.5 py-1 rounded cursor-pointer ${
                        checkoutProvider === 'stripe' ? 'bg-white dark:bg-zinc-800 font-medium shadow-sm' : 'text-zinc-500'
                      }`}
                    >
                      Stripe {gateways.stripeConfigured ? '' : '(Key Req)'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAllPlans((v) => !v)}
                    className="text-xs text-blue-600 hover:underline cursor-pointer"
                  >
                    {showAllPlans ? 'Show Core 4 Plans' : 'Show All 7 Tiers'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {visiblePlans.map((pl) => {
                  const isCurrent = usage?.activePlan?.id === pl.id;
                  return (
                    <div
                      key={pl.id}
                      className={`p-5 rounded-xl border flex flex-col justify-between gap-4 ${
                        isCurrent
                          ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20'
                          : 'border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <h3 className="font-display font-bold text-base">{pl.name}</h3>
                          <span className="font-mono text-lg font-bold tabular-nums">
                            ${pl.monthlyPriceUsd}
                            <span className="text-[11px] font-sans font-normal text-zinc-500">/mo</span>
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500">{pl.audience}</div>
                        <div className="space-y-1 text-xs font-mono tabular-nums pt-2 border-t border-zinc-200 dark:border-zinc-800">
                          <div>{pl.monthlyCredits.toLocaleString()} credits / mo</div>
                          <div>{pl.rateLimitRpm.toLocaleString()} req / min</div>
                          <div>{(pl.dailyRequestLimit ?? 200).toLocaleString()} req / day</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isCurrent || planLoadingId === pl.id}
                        onClick={() => void handleSelectPlan(pl.id)}
                        className={`w-full py-2 px-3 rounded-lg text-xs font-medium cursor-pointer ${
                          isCurrent
                            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-default'
                            : 'bg-zinc-950 dark:bg-blue-600 text-white hover:opacity-90'
                        }`}
                      >
                        {isCurrent
                          ? 'Current Plan'
                          : planLoadingId === pl.id
                            ? 'Processing...'
                            : pl.monthlyPriceUsd === 0
                              ? 'Switch to Free'
                              : `Upgrade to ${pl.name}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {user && (
              <>
                <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold">Recent Invoices</h2>
                    <button
                      type="button"
                      onClick={() => navigate('/billing')}
                      className="text-xs text-blue-600 hover:underline cursor-pointer"
                    >
                      Buy Credit Top-Up Packs →
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                          <th className="pb-2">Invoice #</th>
                          <th className="pb-2">Issued</th>
                          <th className="pb-2">Status</th>
                          <th className="pb-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 font-mono tabular-nums">
                        {invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td className="py-2 pr-3">{inv.invoiceNumber}</td>
                            <td className="py-2 pr-3 text-zinc-500">{inv.issuedAt.slice(0, 10)}</td>
                            <td className="py-2 pr-3 font-sans">{inv.status}</td>
                            <td className="py-2 text-right">{inv.currency} {inv.amount}</td>
                          </tr>
                        ))}
                        {invoices.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-5 text-center text-zinc-500 font-sans">
                              No paid invoices issued yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-display text-lg font-bold">API Request History</h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={logSearch}
                          onChange={(e) => setLogSearch(e.target.value)}
                          placeholder="Filter model or endpoint..."
                          className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                        />
                      </div>
                      <select
                        value={logStatusFilter}
                        onChange={(e) => setLogStatusFilter(e.target.value as 'all' | 'ok' | 'error')}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      >
                        <option value="all">All Statuses</option>
                        <option value="ok">200 OK</option>
                        <option value="error">Errors (&gt;=400)</option>
                      </select>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                          <th className="pb-2">Timestamp</th>
                          <th className="pb-2">Endpoint</th>
                          <th className="pb-2">Requested → Routed</th>
                          <th className="pb-2 text-right">Tokens</th>
                          <th className="pb-2 text-right">Credits</th>
                          <th className="pb-2 text-right">Latency</th>
                          <th className="pb-2 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 font-mono tabular-nums">
                        {filteredLogs.map((l) => (
                          <tr key={l.id}>
                            <td className="py-2 pr-3 text-zinc-500">{l.createdAt.replace('T', ' ').slice(0, 19)}</td>
                            <td className="py-2 pr-3">{l.endpoint}</td>
                            <td className="py-2 pr-3">
                              {l.requestedModel} → {l.routedModel}
                            </td>
                            <td className="py-2 pr-3 text-right">{l.promptTokens + l.completionTokens}</td>
                            <td className="py-2 pr-3 text-right">{l.creditsCharged}</td>
                            <td className="py-2 pr-3 text-right">{l.latencyMs}ms</td>
                            <td
                              className={`py-2 text-right ${
                                l.statusCode >= 400 ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {l.statusCode}
                            </td>
                          </tr>
                        ))}
                        {filteredLogs.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-zinc-500 font-sans">
                              No gateway requests recorded yet. Execute a test call in Docs &amp; Playground.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        )}

        {/* TAB 5: CUSTOMER ACCOUNT */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            {!user ? (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center space-y-3">
                <h2 className="font-display text-lg font-bold">Customer Account Settings</h2>
                <p className="text-sm text-zinc-500">Sign in to manage your developer profile, password, alert thresholds, and active sessions.</p>
                <button
                  type="button"
                  onClick={() => navigate('/auth')}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                >
                  Sign In
                </button>
              </div>
            ) : (
              <>
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <form
                    onSubmit={handleSaveAccount}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4"
                  >
                    <h2 className="font-display text-base font-bold">Developer Profile &amp; Preferences</h2>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Account Email</label>
                      <input
                        type="email"
                        disabled
                        value={user.email}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 text-zinc-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Display Name</label>
                      <input
                        type="text"
                        required
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Interface Theme</label>
                        <select
                          value={theme}
                          onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
                          className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                        >
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Low-Credit Warning Threshold</label>
                        <input
                          type="number"
                          min={0}
                          value={lowCreditThreshold}
                          onChange={(e) => setLowCreditThreshold(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                    >
                      Save Account Preferences
                    </button>
                  </form>

                  <form
                    onSubmit={handleChangePassword}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4"
                  >
                    <h2 className="font-display text-base font-bold">Security &amp; Password Update</h2>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Current Password (if set)</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">New Password (min 8 chars)</label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-zinc-950 dark:bg-blue-600 text-white text-xs font-medium cursor-pointer"
                    >
                      Update Password
                    </button>
                  </form>
                </section>

                <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                  <h2 className="font-display text-base font-bold">Active Customer Sessions</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                          <th className="pb-2">Client User-Agent</th>
                          <th className="pb-2">IP Address</th>
                          <th className="pb-2">Created</th>
                          <th className="pb-2">Expires</th>
                          <th className="pb-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 font-mono">
                        {sessions.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2 pr-3 font-sans truncate max-w-xs">
                              {s.userAgent} {s.isCurrent ? '(Current)' : ''}
                            </td>
                            <td className="py-2 pr-3">{s.ipAddress}</td>
                            <td className="py-2 pr-3 text-zinc-500">{s.createdAt.slice(0, 10)}</td>
                            <td className="py-2 pr-3 text-zinc-500">{s.expiresAt.slice(0, 10)}</td>
                            <td className="py-2 text-right font-sans">
                              {!s.isCurrent && (
                                <button
                                  type="button"
                                  onClick={() => void handleRevokeSession(s.id)}
                                  className="text-red-600 hover:underline cursor-pointer"
                                >
                                  Revoke
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {sessions.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-5 text-center text-zinc-500 font-sans">
                              No active sessions listed.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
