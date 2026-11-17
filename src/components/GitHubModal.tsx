import React, { useEffect, useState } from 'react';
import { X, Plus, UploadCloud, ExternalLink, Unlink } from 'lucide-react';
import { apiRequest } from '../lib/api.ts';
import { GitHubOfficialIcon } from './VektorIcons.tsx';

interface RepoItem {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

interface GitHubModalProps {
  projectId: string;
  projectName: string;
  currentRepo: string | null;
  currentBranch: string | null;
  onClose: () => void;
  onSynced: () => void;
}

export function GitHubModal({
  projectId,
  projectName,
  currentRepo,
  currentBranch,
  onClose,
  onSynced,
}: GitHubModalProps) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');

  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [selectedRepo, setSelectedRepo] = useState(currentRepo || '');
  const [branch, setBranch] = useState(currentBranch || 'main');
  const [commitMessage, setCommitMessage] = useState(`Update ${projectName} from VEKTOR AI`);

  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);

  const loadStatus = async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const s = await apiRequest<{
        oauthConfigured: boolean;
        callbackUrl: string;
        connected: boolean;
        username: string | null;
      }>('/api/github/status');
      setOauthConfigured(s.oauthConfigured);
      setCallbackUrl(s.callbackUrl);
      setConnected(s.connected);
      setUsername(s.username);
      if (s.connected) {
        const r = await apiRequest<{ repos: RepoItem[] }>('/api/github/repos');
        setRepos(r.repos || []);
        if (!selectedRepo && r.repos?.length > 0) {
          setSelectedRepo(r.repos[0].fullName);
          setBranch(r.repos[0].defaultBranch || 'main');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GitHub status');
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'github') {
        void loadStatus();
        onSynced();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const handleConnect = async () => {
    setError(null);
    try {
      const { url } = await apiRequest<{ url: string }>('/api/github/auth-url');
      const popup = window.open(url, 'vektor_github_oauth', 'width=600,height=700');
      if (!popup) setError('Popup blocked. Please allow popups to connect GitHub.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start GitHub OAuth');
    }
  };

  const handleDisconnect = async () => {
    await apiRequest('/api/github/disconnect', { method: 'POST' });
    setConnected(false);
    setRepos([]);
    onSynced();
  };

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) return;
    setCreatingRepo(true);
    setError(null);
    try {
      const res = await apiRequest<{ repo: RepoItem }>('/api/github/repos', {
        method: 'POST',
        body: JSON.stringify({
          name: newRepoName.trim(),
          isPrivate: newRepoPrivate,
          description: `${projectName} — generated with VEKTOR AI`,
        }),
      });
      setRepos((prev) => [res.repo, ...prev]);
      setSelectedRepo(res.repo.fullName);
      setBranch(res.repo.defaultBranch || 'main');
      setNewRepoName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create repository');
    } finally {
      setCreatingRepo(false);
    }
  };

  const handlePush = async () => {
    if (!selectedRepo) return;
    setPushing(true);
    setError(null);
    setSuccessUrl(null);
    try {
      const res = await apiRequest<{ repoUrl: string }>('/api/github/push', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          repoFullName: selectedRepo,
          branch,
          commitMessage,
        }),
      });
      setSuccessUrl(res.repoUrl);
      onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <GitHubOfficialIcon className="w-5 h-5 text-zinc-950 dark:text-white" />
            <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-white">
              GitHub Repository Sync
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {successUrl && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
              <span>Code pushed successfully to GitHub.</span>
              <a
                href={successUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline"
              >
                <span>Open Repo</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {statusLoading ? (
            <div className="py-8 text-center text-sm text-zinc-500">Checking GitHub connection...</div>
          ) : !connected ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                Connect your GitHub account via server-side OAuth to create repositories, select branches, and push your generated project files. Tokens never leave the server.
              </p>
              {!oauthConfigured && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                  <div className="font-semibold">Server Setup Required</div>
                  <div>Set <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> with callback URL:</div>
                  <code className="block break-all font-mono text-[11px] pt-1">{callbackUrl}</code>
                </div>
              )}
              <button
                type="button"
                onClick={handleConnect}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 text-sm font-medium hover:opacity-90 cursor-pointer"
              >
                <GitHubOfficialIcon className="w-4 h-4" />
                <span>Connect GitHub Account</span>
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between text-xs bg-zinc-100 dark:bg-zinc-800 px-3.5 py-2.5 rounded-lg">
                <span className="text-zinc-700 dark:text-zinc-200">
                  Connected as <strong>@{username}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-1 text-zinc-500 hover:text-red-600 cursor-pointer"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              </div>

              <form onSubmit={handleCreateRepo} className="space-y-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Create New Repository
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="my-vektor-app"
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  />
                  <button
                    type="submit"
                    disabled={creatingRepo || !newRepoName.trim()}
                    className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-medium disabled:opacity-50 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{creatingRepo ? 'Creating...' : 'Create'}</span>
                  </button>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={newRepoPrivate}
                    onChange={(e) => setNewRepoPrivate(e.target.checked)}
                  />
                  <span>Private repository</span>
                </label>
              </form>

              <div className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    Target Repository
                  </label>
                  <select
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                  >
                    {repos.map((r) => (
                      <option key={r.id} value={r.fullName}>
                        {r.fullName} {r.private ? '(Private)' : '(Public)'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Branch
                    </label>
                    <input
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Commit Message
                    </label>
                    <input
                      type="text"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePush}
                  disabled={pushing || !selectedRepo}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>{pushing ? 'Pushing Code to GitHub...' : 'Push Project to GitHub'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
