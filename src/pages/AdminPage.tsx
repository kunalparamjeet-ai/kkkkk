import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Plus, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { TopNav } from '../components/TopNav.tsx';

interface AdminOverview {
  metrics: {
    totalUsers: number;
    totalProjects: number;
    liveDeployments: number;
    verifiedDomains: number;
    totalCreditsConsumed: number;
    totalRevenueUsd: number;
    gatewayRequests: number;
    errorCount: number;
  };
  selfHostedConfig: {
    modelName: string;
    inferenceServerUrl: string;
    weightsPath: string;
    status: string;
    lastCheckedAt: string | null;
    lastMessage: string;
    discoveredModels?: string[];
    runtimeDetected?: string | null;
    latencyMs?: number | null;
  };
  providers: Array<{
    id: string;
    name: string;
    kind: string;
    baseUrl: string | null;
    maskedKey: string;
    enabled: boolean;
    available: boolean;
    status: string;
  }>;
  models: Array<{
    id: string;
    providerId: string;
    modelIdentifier: string;
    displayName: string;
    roleTag: string;
    inputCreditsPer1k: number;
    outputCreditsPer1k: number;
    enabled: boolean;
    isPreferredCoding: boolean;
  }>;
  routingRules: Array<{
    taskType: string;
    primaryModelId: string;
    fallbackModelId: string | null;
    description: string;
  }>;
  plans: Array<{
    id: string;
    name: string;
    monthlyPriceUsd: number;
    monthlyCredits: number;
    maxProjects: number;
    rateLimitRpm: number;
    dailyRequestLimit: number;
    customDomainsEnabled: boolean;
  }>;
  users: Array<{
    id: string;
    email: string;
    name: string;
    role: 'user' | 'admin' | 'super_admin';
    status: 'active' | 'suspended';
    balanceCredits: number;
    lifetimeCreditsUsed: number;
    planId: string;
    planName: string;
  }>;
  subscriptions: Array<{
    id: string;
    userId: string;
    userEmail: string;
    planId: string;
    planName: string;
    status: string;
    provider: string;
    currentPeriodEnd: string;
  }>;
  payments: Array<{
    id: string;
    userId: string;
    provider: string;
    amount: number;
    currency: string;
    creditsGranted: number;
    status: string;
    createdAt: string;
  }>;
  apiKeys: Array<{
    id: string;
    userId: string;
    userEmail: string;
    name: string;
    keyPrefix: string;
    permissions: string[];
    rateLimitRpm: number;
    isInternal: boolean;
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }>;
  deployments: Array<{
    id: string;
    slug: string;
    liveUrl: string;
    status: string;
    publishedAt: string;
  }>;
  domains: Array<{
    id: string;
    domain: string;
    dnsVerified: boolean;
    sslStatus: string;
    status: string;
  }>;
  errorLogs: Array<{
    id: string;
    source: string;
    severity: string;
    message: string;
    createdAt: string;
  }>;
}

type AdminTab = 'overview' | 'users' | 'apikeys' | 'models' | 'billing' | 'deployments' | 'errors';

export function AdminPage() {
  const { user, navigate } = useApp();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealedAdminKey, setRevealedAdminKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [shUrl, setShUrl] = useState('');
  const [shWeights, setShWeights] = useState('');
  const [shModelName, setShModelName] = useState('');

  const [newModelProv, setNewModelProv] = useState('prov_openai');
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelRole, setNewModelRole] = useState('Reasoning');

  // Admin API Key issuance & edits
  const [issueUserId, setIssueUserId] = useState('');
  const [issueKeyName, setIssueKeyName] = useState('');
  const [issueKeyRpm, setIssueKeyRpm] = useState('60');
  const [rpmEdits, setRpmEdits] = useState<Record<string, string>>({});
  const [creditInputs, setCreditInputs] = useState<Record<string, string>>({});
  const [planEdits, setPlanEdits] = useState<Record<string, { monthlyPriceUsd: string; monthlyCredits: string; rateLimitRpm: string; dailyRequestLimit: string }>>({});

  const loadAdmin = async () => {
    try {
      const res = await apiRequest<AdminOverview>('/api/admin/overview');
      setData(res);
      setShUrl(res.selfHostedConfig.inferenceServerUrl || '');
      setShWeights(res.selfHostedConfig.weightsPath || '');
      setShModelName(res.selfHostedConfig.modelName || 'vektor-coder-1');
      if (!issueUserId && res.users.length > 0) {
        setIssueUserId(res.users[0].id);
      }
      const nextRpm: Record<string, string> = {};
      for (const k of res.apiKeys) {
        nextRpm[k.id] = String(k.rateLimitRpm);
      }
      setRpmEdits(nextRpm);
      const nextPlans: Record<string, { monthlyPriceUsd: string; monthlyCredits: string; rateLimitRpm: string; dailyRequestLimit: string }> = {};
      for (const pl of res.plans) {
        nextPlans[pl.id] = {
          monthlyPriceUsd: String(pl.monthlyPriceUsd),
          monthlyCredits: String(pl.monthlyCredits),
          rateLimitRpm: String(pl.rateLimitRpm),
          dailyRequestLimit: String(pl.dailyRequestLimit ?? 200),
        };
      }
      setPlanEdits(nextPlans);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admin access denied');
    }
  };

  useEffect(() => {
    void loadAdmin();
  }, []);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <Shield className="w-8 h-8 text-red-600 mx-auto" />
          <h1 className="font-display text-xl font-bold">Admin Authorization Required</h1>
          <p className="text-sm text-zinc-500">Sign in with an admin or super_admin account to access the VEKTOR control plane.</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-lg bg-zinc-950 dark:bg-blue-600 text-white text-xs font-medium cursor-pointer"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  const handleUserUpdate = async (userId: string, body: Record<string, unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setNotice('User updated.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleAssignSubscription = async (userId: string, planId: string) => {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/users/${userId}/subscription`, {
        method: 'PUT',
        body: JSON.stringify({ planId, status: 'active', grantPlanCredits: false }),
      });
      setNotice('User subscription plan updated.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscription update failed');
    }
  };

  const handleIssueAdminKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueUserId || !issueKeyName.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ plaintextKey: string }>('/api/admin/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          userId: issueUserId,
          name: issueKeyName.trim(),
          rateLimitRpm: Number(issueKeyRpm) || 60,
        }),
      });
      setRevealedAdminKey(res.plaintextKey);
      setIssueKeyName('');
      setNotice('API key issued for user.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue API key');
    }
  };

  const handleUpdateKeyRpm = async (keyId: string) => {
    const val = Number(rpmEdits[keyId]);
    if (!Number.isFinite(val) || val < 1) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/api-keys/${keyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ rateLimitRpm: Math.trunc(val) }),
      });
      setNotice('API key rate limit updated.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update API key');
    }
  };

  const handleRegenerateAdminKey = async (keyId: string) => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ plaintextKey: string }>(`/api/admin/api-keys/${keyId}/regenerate`, {
        method: 'POST',
      });
      setRevealedAdminKey(res.plaintextKey);
      setNotice('API key regenerated.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate key');
    }
  };

  const handleSavePlan = async (planId: string) => {
    const edit = planEdits[planId];
    if (!edit) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/plans/${planId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          monthlyPriceUsd: Number(edit.monthlyPriceUsd),
          monthlyCredits: Number(edit.monthlyCredits),
          rateLimitRpm: Number(edit.rateLimitRpm),
          dailyRequestLimit: Number(edit.dailyRequestLimit),
        }),
      });
      setNotice('Plan limits and pricing updated.');
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan');
    }
  };

  const handleSaveSelfHosted = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const res = await apiRequest<{ selfHostedConfig: AdminOverview['selfHostedConfig'] }>('/api/admin/self-hosted', {
      method: 'PUT',
      body: JSON.stringify({ modelName: shModelName, inferenceServerUrl: shUrl, weightsPath: shWeights }),
    });
    setNotice(`Self-hosted check: ${res.selfHostedConfig.status} — ${res.selfHostedConfig.lastMessage}`);
    await loadAdmin();
  };

  const handleRoutingChange = async (taskType: string, primaryModelId: string, fallbackModelId: string | null) => {
    await apiRequest(`/api/admin/routing/${taskType}`, {
      method: 'PUT',
      body: JSON.stringify({ primaryModelId, fallbackModelId }),
    });
    setNotice(`Updated routing rule for ${taskType}.`);
    await loadAdmin();
  };

  const handleRegisterModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModelId.trim() || !newModelName.trim()) return;
    await apiRequest('/api/admin/models', {
      method: 'POST',
      body: JSON.stringify({
        providerId: newModelProv,
        modelIdentifier: newModelId.trim(),
        displayName: newModelName.trim(),
        roleTag: newModelRole.trim(),
      }),
    });
    setNewModelId('');
    setNewModelName('');
    setNotice('Model registered.');
    await loadAdmin();
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100">
      <TopNav />
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate('/workspace')}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-2 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Workspace</span>
            </button>
            <h1 className="font-display text-2xl font-bold">
              VEKTOR Admin Control Plane · Role: {user.role}
            </h1>
          </div>

          <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
            {(
              [
                ['overview', 'Overview'],
                ['users', 'Users & Roles'],
                ['apikeys', 'API Keys & Limits'],
                ['models', 'Models & Routing'],
                ['billing', 'Plans & Payments'],
                ['deployments', 'Managed Hosting'],
                ['errors', 'Errors & Health'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer ${
                  tab === id ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm' : 'text-zinc-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200">
            {notice}
          </div>
        )}
        {revealedAdminKey && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-900 dark:text-emerald-200">
              <span>Issued VEKTOR API key (shown once):</span>
              <button
                type="button"
                onClick={() => setRevealedAdminKey(null)}
                className="hover:underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 bg-white dark:bg-zinc-950 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800">
              <code className="font-mono text-xs break-all select-all">{revealedAdminKey}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(revealedAdminKey);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 1800);
                }}
                className="inline-flex items-center gap-1 text-xs text-blue-600 cursor-pointer shrink-0"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        )}

        {!data ? (
          <div className="py-12 text-center text-sm text-zinc-500">Loading admin console...</div>
        ) : (
          <>
            {tab === 'overview' && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  ['Total Users', data.metrics.totalUsers],
                  ['Projects', data.metrics.totalProjects],
                  ['Live Deployments', data.metrics.liveDeployments],
                  ['Verified Domains', data.metrics.verifiedDomains],
                  ['Credits Consumed', data.metrics.totalCreditsConsumed],
                  ['Verified Revenue', `$${data.metrics.totalRevenueUsd}`],
                  ['Gateway Requests', data.metrics.gatewayRequests],
                  ['Active API Keys', data.apiKeys.filter((k) => !k.revokedAt).length],
                ].map(([label, val]) => (
                  <div
                    key={String(label)}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5"
                  >
                    <div className="text-xs text-zinc-500">{label}</div>
                    <div className="font-mono text-2xl font-bold tabular-nums mt-1">{val}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'users' && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="pb-2">User</th>
                      <th className="pb-2">Role</th>
                      <th className="pb-2">Plan</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Credits</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.users.map((u) => (
                      <tr key={u.id}>
                        <td className="py-3 pr-3">
                          <div className="font-medium">{u.name}</div>
                          <div className="text-zinc-500">{u.email}</div>
                        </td>
                        <td className="py-3 pr-3">
                          <select
                            disabled={user.role !== 'super_admin'}
                            value={u.role}
                            onChange={(e) => void handleUserUpdate(u.id, { role: e.target.value })}
                            className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                            <option value="super_admin">super_admin</option>
                          </select>
                        </td>
                        <td className="py-3 pr-3">
                          <select
                            value={u.planId}
                            onChange={(e) => void handleAssignSubscription(u.id, e.target.value)}
                            className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                          >
                            {data.plans.map((pl) => (
                              <option key={pl.id} value={pl.id}>{pl.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 pr-3">{u.status}</td>
                        <td className="py-3 pr-3 text-right font-mono tabular-nums">{u.balanceCredits}</td>
                        <td className="py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <input
                              type="number"
                              value={creditInputs[u.id] ?? '500'}
                              onChange={(e) => setCreditInputs((prev) => ({ ...prev, [u.id]: e.target.value }))}
                              className="w-20 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono text-right"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const amt = Number(creditInputs[u.id] ?? '500');
                                if (!Number.isFinite(amt) || amt === 0) return;
                                void handleUserUpdate(u.id, {
                                  creditAdjustment: amt,
                                  adjustmentReason: 'Admin credit adjustment',
                                });
                              }}
                              className="px-2.5 py-1 rounded bg-blue-600 text-white cursor-pointer"
                            >
                              Apply Credits
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleUserUpdate(u.id, {
                                  status: u.status === 'active' ? 'suspended' : 'active',
                                })
                              }
                              className="px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 cursor-pointer"
                            >
                              {u.status === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'apikeys' && (
              <div className="space-y-6">
                <form
                  onSubmit={handleIssueAdminKey}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4"
                >
                  <h2 className="font-display font-bold text-base">Issue API Key for User</h2>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <select
                      value={issueUserId}
                      onChange={(e) => setIssueUserId(e.target.value)}
                      className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    >
                      {data.users.map((u) => (
                        <option key={u.id} value={u.id}>{u.email} ({u.role})</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={issueKeyName}
                      onChange={(e) => setIssueKeyName(e.target.value)}
                      placeholder="Partner Integration Key"
                      className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <input
                      type="number"
                      min={1}
                      value={issueKeyRpm}
                      onChange={(e) => setIssueKeyRpm(e.target.value)}
                      placeholder="RPM Limit (e.g. 120)"
                      className="px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Issue API Key</span>
                    </button>
                  </div>
                </form>

                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 overflow-x-auto">
                  <h2 className="font-display font-bold text-base mb-4">All Platform API Keys &amp; Rate Limits</h2>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="pb-2">Key &amp; Owner</th>
                        <th className="pb-2">Prefix</th>
                        <th className="pb-2">Scopes</th>
                        <th className="pb-2">RPM Limit</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {data.apiKeys.map((k) => (
                        <tr key={k.id}>
                          <td className="py-3 pr-3">
                            <div className="font-medium">{k.name} {k.isInternal ? '(Internal)' : ''}</div>
                            <div className="text-zinc-500">{k.userEmail}</div>
                          </td>
                          <td className="py-3 pr-3 font-mono">{k.keyPrefix}•••</td>
                          <td className="py-3 pr-3 font-mono text-[11px] text-zinc-500">{k.permissions.join(' · ')}</td>
                          <td className="py-3 pr-3">
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                min={1}
                                value={rpmEdits[k.id] ?? String(k.rateLimitRpm)}
                                onChange={(e) => setRpmEdits((prev) => ({ ...prev, [k.id]: e.target.value }))}
                                className="w-20 px-2 py-1 font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                              />
                              <button
                                type="button"
                                onClick={() => void handleUpdateKeyRpm(k.id)}
                                className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                              >
                                Save
                              </button>
                            </div>
                          </td>
                          <td className={`py-3 pr-3 ${k.revokedAt ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {k.revokedAt ? 'Revoked' : 'Active'}
                          </td>
                          <td className="py-3 text-right space-x-3 whitespace-nowrap">
                            {!k.revokedAt && !k.isInternal && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleRegenerateAdminKey(k.id)}
                                  className="inline-flex items-center gap-1 text-blue-600 hover:underline cursor-pointer"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  <span>Regenerate</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiRequest(`/api/admin/api-keys/${k.id}`, { method: 'DELETE' });
                                    await loadAdmin();
                                  }}
                                  className="inline-flex items-center gap-1 text-red-600 hover:underline cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Revoke</span>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'models' && (
              <div className="space-y-6">
                {/* Self-Hosted VEKTOR Model Config */}
                <form
                  onSubmit={handleSaveSelfHosted}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display font-bold text-base">Self-Hosted Open-Source AI Engine</h2>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Status: <strong className={data.selfHostedConfig.status === 'healthy' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{data.selfHostedConfig.status}</strong>
                        {data.selfHostedConfig.runtimeDetected ? ` · ${data.selfHostedConfig.runtimeDetected}` : ''}
                        {typeof data.selfHostedConfig.latencyMs === 'number' ? ` · ${data.selfHostedConfig.latencyMs}ms` : ''}
                      </p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                        {data.selfHostedConfig.lastMessage}
                      </p>
                    </div>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Save &amp; Probe Health</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-500 mb-1">Primary Model Identifier</label>
                      <input
                        type="text"
                        value={shModelName}
                        onChange={(e) => setShModelName(e.target.value)}
                        placeholder="qwen2.5-coder:32b or vektor-coder-1"
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-500 mb-1">Inference Server URL (vLLM / Ollama / llama.cpp)</label>
                      <input
                        type="text"
                        value={shUrl}
                        onChange={(e) => setShUrl(e.target.value)}
                        placeholder="http://127.0.0.1:8000/v1"
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-500 mb-1">Optional Local / Remote Weights Path</label>
                      <input
                        type="text"
                        value={shWeights}
                        onChange={(e) => setShWeights(e.target.value)}
                        placeholder="/models/vektor-coder-weights"
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                    </div>
                  </div>

                  {data.selfHostedConfig.discoveredModels && data.selfHostedConfig.discoveredModels.length > 0 && (
                    <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                      <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Discovered Open-Source Models on Inference Server
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {data.selfHostedConfig.discoveredModels.map((modId) => (
                          <button
                            key={modId}
                            type="button"
                            onClick={async () => {
                              await apiRequest('/api/admin/self-hosted/register-discovered', {
                                method: 'POST',
                                body: JSON.stringify({ modelIdentifier: modId }),
                              });
                              setNotice(`Registered self-hosted model "${modId}" into VEKTOR catalog.`);
                              await loadAdmin();
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs font-mono hover:border-blue-500 cursor-pointer"
                          >
                            <Plus className="w-3 h-3 text-blue-600" />
                            <span>{modId}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </form>

                {/* Providers */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                  <h2 className="font-display font-bold text-base">AI Providers</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data.providers.map((p) => (
                      <div key={p.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-sm">{p.name}</div>
                          <div className="text-zinc-500 mt-0.5">
                            Status: {p.available ? 'Available' : p.status} · Key: {p.maskedKey}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiRequest(`/api/admin/providers/${p.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ enabled: !p.enabled }),
                            });
                            await loadAdmin();
                          }}
                          className="px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 cursor-pointer"
                        >
                          {p.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Task Routing Matrix */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                  <h2 className="font-display font-bold text-base">Configurable Task Delegation Matrix</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                          <th className="pb-2">Task Type</th>
                          <th className="pb-2">Primary Model</th>
                          <th className="pb-2">Fallback Model</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {data.routingRules.map((r) => (
                          <tr key={r.taskType}>
                            <td className="py-2.5 font-mono">{r.taskType}</td>
                            <td className="py-2.5">
                              <select
                                value={r.primaryModelId}
                                onChange={(e) => void handleRoutingChange(r.taskType, e.target.value, r.fallbackModelId)}
                                className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                              >
                                {data.models.map((m) => (
                                  <option key={m.id} value={m.id}>{m.displayName}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2.5">
                              <select
                                value={r.fallbackModelId || ''}
                                onChange={(e) => void handleRoutingChange(r.taskType, r.primaryModelId, e.target.value || null)}
                                className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                              >
                                <option value="">None</option>
                                {data.models.map((m) => (
                                  <option key={m.id} value={m.id}>{m.displayName}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Register New Model & Credit Pricing */}
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-4">
                  <h2 className="font-display font-bold text-base">Register Model &amp; Credit Rates</h2>
                  <form onSubmit={handleRegisterModel} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <select
                      value={newModelProv}
                      onChange={(e) => setNewModelProv(e.target.value)}
                      className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    >
                      {data.providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className="px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <input
                      type="text"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="Display Name"
                      className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <input
                      type="text"
                      value={newModelRole}
                      onChange={(e) => setNewModelRole(e.target.value)}
                      placeholder="Role Tag"
                      className="px-3 py-2 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Register</span>
                    </button>
                  </form>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                          <th className="pb-2">Model</th>
                          <th className="pb-2">Role</th>
                          <th className="pb-2 text-right">In Cr / 1k</th>
                          <th className="pb-2 text-right">Out Cr / 1k</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {data.models.map((m) => (
                          <tr key={m.id}>
                            <td className="py-2 font-medium">{m.displayName}</td>
                            <td className="py-2 text-zinc-500">{m.roleTag}</td>
                            <td className="py-2 text-right font-mono tabular-nums">{m.inputCreditsPer1k}</td>
                            <td className="py-2 text-right font-mono tabular-nums">{m.outputCreditsPer1k}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === 'billing' && (
              <div className="space-y-6">
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 overflow-x-auto">
                  <h2 className="font-display font-bold text-base mb-4">Configurable API &amp; Studio Plans</h2>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="pb-2">Plan</th>
                        <th className="pb-2 text-right">USD/mo</th>
                        <th className="pb-2 text-right">Monthly Credits</th>
                        <th className="pb-2 text-right">RPM Limit</th>
                        <th className="pb-2 text-right">Daily Req Limit</th>
                        <th className="pb-2 text-right">Save</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 font-mono tabular-nums">
                      {data.plans.map((pl) => {
                        const ed = planEdits[pl.id] || {
                          monthlyPriceUsd: String(pl.monthlyPriceUsd),
                          monthlyCredits: String(pl.monthlyCredits),
                          rateLimitRpm: String(pl.rateLimitRpm),
                          dailyRequestLimit: String(pl.dailyRequestLimit ?? 200),
                        };
                        return (
                          <tr key={pl.id}>
                            <td className="py-2.5 font-sans font-semibold">{pl.name}</td>
                            <td className="py-2.5 text-right">
                              <input
                                type="number"
                                value={ed.monthlyPriceUsd}
                                onChange={(e) =>
                                  setPlanEdits((prev) => ({ ...prev, [pl.id]: { ...ed, monthlyPriceUsd: e.target.value } }))
                                }
                                className="w-20 px-2 py-1 text-right rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                              />
                            </td>
                            <td className="py-2.5 text-right">
                              <input
                                type="number"
                                value={ed.monthlyCredits}
                                onChange={(e) =>
                                  setPlanEdits((prev) => ({ ...prev, [pl.id]: { ...ed, monthlyCredits: e.target.value } }))
                                }
                                className="w-24 px-2 py-1 text-right rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                              />
                            </td>
                            <td className="py-2.5 text-right">
                              <input
                                type="number"
                                value={ed.rateLimitRpm}
                                onChange={(e) =>
                                  setPlanEdits((prev) => ({ ...prev, [pl.id]: { ...ed, rateLimitRpm: e.target.value } }))
                                }
                                className="w-20 px-2 py-1 text-right rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                              />
                            </td>
                            <td className="py-2.5 text-right">
                              <input
                                type="number"
                                value={ed.dailyRequestLimit}
                                onChange={(e) =>
                                  setPlanEdits((prev) => ({ ...prev, [pl.id]: { ...ed, dailyRequestLimit: e.target.value } }))
                                }
                                className="w-24 px-2 py-1 text-right rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                              />
                            </td>
                            <td className="py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => void handleSavePlan(pl.id)}
                                className="px-2.5 py-1 rounded bg-blue-600 text-white font-sans cursor-pointer"
                              >
                                Save
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 overflow-x-auto">
                  <h2 className="font-display font-bold text-base mb-4">User Subscriptions</h2>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="pb-2">User</th>
                        <th className="pb-2">Plan</th>
                        <th className="pb-2">Provider</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2 text-right">Period End</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {data.subscriptions.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2">{s.userEmail}</td>
                          <td className="py-2 font-medium">{s.planName}</td>
                          <td className="py-2 font-mono">{s.provider}</td>
                          <td className="py-2">{s.status}</td>
                          <td className="py-2 text-right font-mono">{s.currentPeriodEnd.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 overflow-x-auto">
                  <h2 className="font-display font-bold text-base mb-4">Payments &amp; Refunds</h2>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="pb-2">ID</th>
                        <th className="pb-2">Provider</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2 text-right">Amount</th>
                        <th className="pb-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {data.payments.map((pay) => (
                        <tr key={pay.id}>
                          <td className="py-2 font-mono">{pay.id}</td>
                          <td className="py-2">{pay.provider}</td>
                          <td className="py-2">{pay.status}</td>
                          <td className="py-2 text-right font-mono tabular-nums">{pay.currency} {pay.amount}</td>
                          <td className="py-2 text-right">
                            {pay.status === 'verified' && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiRequest(`/api/admin/payments/${pay.id}/refund`, { method: 'POST' });
                                  await loadAdmin();
                                }}
                                className="text-red-600 hover:underline cursor-pointer"
                              >
                                Refund
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {data.payments.length === 0 && (
                        <tr><td colSpan={5} className="py-6 text-center text-zinc-500">No payment records yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'deployments' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
                  <h2 className="font-display font-bold text-base mb-4">Managed Deployments</h2>
                  <div className="space-y-2 text-xs">
                    {data.deployments.map((d) => (
                      <div key={d.id} className="flex items-center justify-between p-2.5 rounded border border-zinc-200 dark:border-zinc-800">
                        <a href={d.liveUrl} target="_blank" rel="noreferrer" className="font-mono text-blue-600 hover:underline">
                          {d.liveUrl}
                        </a>
                        <span>{d.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
                  <h2 className="font-display font-bold text-base mb-4">Custom Domains</h2>
                  <div className="space-y-2 text-xs">
                    {data.domains.map((dom) => (
                      <div key={dom.id} className="flex items-center justify-between p-2.5 rounded border border-zinc-200 dark:border-zinc-800">
                        <span className="font-mono">{dom.domain}</span>
                        <span>{dom.dnsVerified ? 'Verified' : 'Pending DNS'} · SSL {dom.sslStatus}</span>
                      </div>
                    ))}
                    {data.domains.length === 0 && (
                      <div className="py-6 text-center text-zinc-500">No custom domains bound yet.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'errors' && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
                <h2 className="font-display font-bold text-base mb-4">System Error Logs</h2>
                <div className="space-y-2 text-xs font-mono">
                  {data.errorLogs.map((err) => (
                    <div key={err.id} className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
                      <div className="text-zinc-500">{err.createdAt} · [{err.severity}] {err.source}</div>
                      <div className="mt-1 text-red-700 dark:text-red-300">{err.message}</div>
                    </div>
                  ))}
                  {data.errorLogs.length === 0 && (
                    <div className="py-6 text-center text-zinc-500 font-sans">No system errors recorded.</div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
