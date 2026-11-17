import React, { useState } from 'react';
import {
  Check,
  CreditCard,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Plus,
  Search,
  Shield,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ClientUser, ClientWallet } from '../contexts/AppContext.tsx';

export interface SidebarProjectSummary {
  id: string;
  name: string;
  description: string;
  status: string;
  selectedModelId: string;
  previewSlug: string | null;
  totalTokensUsed: number;
  githubRepoFullName: string | null;
  githubBranch: string | null;
  updatedAt: string;
  fileCount?: number;
  liveUrl?: string | null;
}

interface WorkspaceSidebarProps {
  user: ClientUser;
  wallet: ClientWallet | null;
  projects: SidebarProjectSummary[];
  activeProjectId: string | null;
  apiKeysCount: number;
  dailyRequestsUsed: number;
  dailyRequestLimit: number;
  activePlanName: string;
  isOverlayMode: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelectProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
  onNavigate: (path: string) => void;
}

export function WorkspaceSidebar({
  user,
  wallet,
  projects,
  activeProjectId,
  apiKeysCount,
  dailyRequestsUsed,
  dailyRequestLimit,
  activePlanName,
  isOverlayMode,
  onClose,
  onNewChat,
  onSelectProject,
  onDeleteProject,
  onNavigate,
}: WorkspaceSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredProjects = searchQuery.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : projects;

  const handleConfirmDelete = async (projectId: string) => {
    setDeletingId(projectId);
    try {
      await onDeleteProject(projectId);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <aside
      className={`w-72 shrink-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 h-full ${
        isOverlayMode ? 'shadow-2xl' : ''
      }`}
    >
      {/* Top Action */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            if (isOverlayMode) onClose();
          }}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-medium transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New AI Chat</span>
        </button>
        {isOverlayMode && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Primary Sidebar Navigation */}
      <nav className="p-2 border-b border-zinc-200 dark:border-zinc-800 space-y-0.5">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            if (isOverlayMode) onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>AI Workspace</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('/api-gateway')}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
        >
          <span className="inline-flex items-center gap-2.5">
            <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>API</span>
          </span>
          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
            {apiKeysCount} keys
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('/billing')}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
        >
          <span className="inline-flex items-center gap-2.5">
            <CreditCard className="w-3.5 h-3.5 text-zinc-500" />
            <span>Billing &amp; Plans</span>
          </span>
          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 tabular-nums">
            {wallet?.balanceCredits ?? 0} cr
          </span>
        </button>

        {(user.role === 'admin' || user.role === 'super_admin') && (
          <button
            type="button"
            onClick={() => onNavigate('/admin')}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer transition-colors"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Admin Console</span>
          </button>
        )}
      </nav>

      {/* Project History List */}
      <div className="px-3 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Project History ({projects.length})
          </span>
        </div>
        {projects.length > 3 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter projects..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:border-blue-600"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {filteredProjects.map((p) => {
          const isActive = p.id === activeProjectId;
          const isConfirming = confirmDeleteId === p.id;
          return (
            <div
              key={p.id}
              className={`group rounded-lg p-2.5 border transition-colors ${
                isActive
                  ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30'
                  : 'border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/70'
              }`}
            >
              {isConfirming ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-red-700 dark:text-red-300">
                    Delete &ldquo;{p.name}&rdquo;?
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Removes files, chats, and deployments.
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={deletingId === p.id}
                      onClick={() => void handleConfirmDelete(p.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium disabled:opacity-50 cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>{deletingId === p.id ? 'Deleting...' : 'Confirm Delete'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProject(p.id);
                      if (isOverlayMode) onClose();
                    }}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <FolderOpen className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                      <span className="text-xs font-medium truncate text-zinc-950 dark:text-zinc-100">
                        {p.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1.5 pl-5">
                      <span className="capitalize">{p.status}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {p.liveUrl && (
                      <a
                        href={p.liveUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open Live Hosted App"
                        className="p-1 rounded text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(p.id);
                      }}
                      title={`Delete ${p.name}`}
                      aria-label={`Delete project ${p.name}`}
                      className="p-1 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredProjects.length === 0 && (
          <div className="p-4 text-xs text-zinc-500 text-center">
            {searchQuery.trim() ? 'No matching projects.' : 'No projects yet. Start a prompt to create one.'}
          </div>
        )}
      </div>

      {/* Clearly Visible API Section in Sidebar */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>VEKTOR Developer API</span>
          </span>
          <span className="font-mono text-zinc-500 dark:text-zinc-400">{activePlanName}</span>
        </div>
        <div className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
          <span>{apiKeysCount} active keys</span>
          <span>
            {dailyRequestsUsed}/{dailyRequestLimit} req today
          </span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/api-gateway?tab=keys')}
          className="w-full py-1.5 px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-900 dark:text-zinc-100 cursor-pointer transition-colors"
        >
          Manage VEKTOR API Keys
        </button>
      </div>
    </aside>
  );
}
