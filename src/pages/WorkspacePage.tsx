import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Code2,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FolderTree,
  Globe,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  PanelLeft,
  PauseCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Square,
  Sun,
  Tablet,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiRequest, getStoredSessionToken } from '../lib/api.ts';
import { vektorSound } from '../lib/sound.ts';
import { GitHubOfficialIcon, VektorBrandMark } from '../components/VektorIcons.tsx';
import { GitHubModal } from '../components/GitHubModal.tsx';
import { WorkspaceSidebar, type SidebarProjectSummary } from '../components/WorkspaceSidebar.tsx';
import {
  WorkspaceComposer,
  type AttachedFileSnippet,
  type SelectedTargetInfo,
} from '../components/WorkspaceComposer.tsx';

interface ProjectFile {
  id: string;
  path: string;
  content: string;
  language: string;
  updatedAt: string;
}

interface ProjectVersion {
  id: string;
  versionNumber: number;
  summary: string;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelUsed?: string;
  tokensUsed?: number;
  latencyMs?: number;
  createdAt: string;
}

interface OrchestrationTask {
  stepKey: string;
  title: string;
  taskType: string;
  assignedModelId: string;
  actualModelUsed: string | null;
  status: string;
  latencyMs: number;
  tokensUsed: number;
  outputSummary: string | null;
}

interface JobEvent {
  id: string;
  timestamp: string;
  type: string;
  message: string;
}

interface OrchestrationJob {
  id: string;
  projectId: string;
  prompt: string;
  requestedModelId: string;
  status: string;
  tasks: OrchestrationTask[];
  events: JobEvent[];
  tokensUsed: number;
  creditsUsed: number;
  latencyMs: number;
  errorMessage: string | null;
}

interface DeploymentItem {
  id: string;
  slug: string;
  liveUrl: string;
  status: string;
  logs: string[];
  publishedAt: string;
}

interface DomainItem {
  id: string;
  domain: string;
  verificationToken: string;
  dnsVerified: boolean;
  sslStatus: string;
  status: string;
}

interface AvailableModel {
  id: string;
  displayName: string;
  roleTag: string;
  providerName: string;
  available: boolean;
}

interface ApiOverviewSummary {
  activeKeysCount: number;
  requestsToday: number;
  dailyRequestLimit: number;
  planName: string;
}

const ELEMENT_PICKER_SCRIPT = `
<script>
(function(){
  if (window.__vektorPickerAttached) return;
  window.__vektorPickerAttached = true;
  var prev = null;
  document.addEventListener('mouseover', function(e){
    if (prev && prev !== e.target) prev.style.outline = prev.__vektorPrevOutline || '';
    var el = e.target;
    if (!el || el === document.body || el === document.documentElement) return;
    el.__vektorPrevOutline = el.style.outline;
    el.style.outline = '2px solid #2563eb';
    prev = el;
  }, true);
  document.addEventListener('mouseout', function(e){
    var el = e.target;
    if (el && el.__vektorPrevOutline !== undefined) el.style.outline = el.__vektorPrevOutline;
  }, true);
  document.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var tag = (el.tagName || 'div').toLowerCase();
    var idPart = el.id ? '#' + el.id : '';
    var clsPart = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    var txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 36);
    var selector = tag + idPart + clsPart;
    window.parent.postMessage({
      type: 'vektor-element-selected',
      selector: selector,
      label: txt ? selector + ' ("' + txt + '")' : selector
    }, '*');
  }, true);
})();
</script>
`;

export function WorkspacePage() {
  const {
    user,
    wallet,
    plan,
    theme,
    setTheme,
    soundMuted,
    toggleSound,
    navigate,
    refreshAuth,
    logout,
    pendingPrompt,
    clearPendingPrompt,
  } = useApp();

  const [projects, setProjects] = useState<SidebarProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<SidebarProjectSummary | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('index.html');
  const [editedCode, setEditedCode] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [activeJob, setActiveJob] = useState<OrchestrationJob | null>(null);
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [apiOverview, setApiOverview] = useState<ApiOverviewSummary>({
    activeKeysCount: 0,
    requestsToday: 0,
    dailyRequestLimit: plan?.dailyRequestLimit ?? 200,
    planName: plan?.name ?? 'Free',
  });

  // Layout states:
  // - On login: clean chat workspace (buildWorkspaceOpen = false), Project History in left sidebar.
  // - On Send (or opening an existing built project): chat minimizes beside live building workspace (buildWorkspaceOpen = true),
  //   and desktop sidebar auto-collapses into a toggleable drawer so the screen is NEVER 3 columns!
  const [buildWorkspaceOpen, setBuildWorkspaceOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const [mobilePane, setMobilePane] = useState<'chat' | 'output'>('chat');

  const [selectedModelId, setSelectedModelId] = useState<string>('vektor-auto');
  const [promptText, setPromptText] = useState('');
  const [attachments, setAttachments] = useState<AttachedFileSnippet[]>([]);
  const [elementSelectMode, setElementSelectMode] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<SelectedTargetInfo | null>(null);

  const [rightTab, setRightTab] = useState<'preview' | 'code' | 'files' | 'publish'>('preview');
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [githubModalOpen, setGithubModalOpen] = useState(false);

  const [confirmClearChat, setConfirmClearChat] = useState(false);
  const [confirmDeleteMsgId, setConfirmDeleteMsgId] = useState<string | null>(null);

  const [newFilePath, setNewFilePath] = useState('');
  const [newDomainInput, setNewDomainInput] = useState('');
  const [domainNotice, setDomainNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingConsumedRef = useRef(false);
  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  // Listen for Visual Element Selection inside live preview iframe
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'vektor-element-selected') {
        const selector = String(event.data.selector || 'div');
        const label = String(event.data.label || selector);
        setSelectedTarget({ selector, label });
        setElementSelectMode(false);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const loadModelsAndApiSummary = useCallback(async () => {
    try {
      const [boot, keysRes] = await Promise.all([
        apiRequest<{ models: AvailableModel[] }>('/api/public/bootstrap'),
        apiRequest<{
          keys: Array<{ revokedAt: string | null }>;
          usageSummary: {
            requestsToday: number;
            dailyRequestLimit: number;
            activePlan: { name: string } | null;
          };
        }>('/api/keys').catch(() => null),
      ]);
      setModels(boot.models || []);
      if (keysRes) {
        setApiOverview({
          activeKeysCount: (keysRes.keys || []).filter((k) => !k.revokedAt).length,
          requestsToday: keysRes.usageSummary?.requestsToday ?? 0,
          dailyRequestLimit: keysRes.usageSummary?.dailyRequestLimit ?? 200,
          planName: keysRes.usageSummary?.activePlan?.name || plan?.name || 'Free',
        });
      }
    } catch {
      // ignore
    }
  }, [plan?.name]);

  const loadProjectDetail = useCallback(
    async (projectId: string, options?: { autoOpenWorkspace?: boolean }) => {
      try {
        const data = await apiRequest<{
          project: SidebarProjectSummary;
          files: ProjectFile[];
          messages: ChatMessage[];
          versions: ProjectVersion[];
          jobs: OrchestrationJob[];
          deployments: DeploymentItem[];
          domains: DomainItem[];
        }>(`/api/projects/${projectId}`);

        setActiveProject(data.project);
        setSelectedModelId(data.project.selectedModelId || 'vektor-auto');
        setFiles(data.files);
        setMessages(data.messages);
        setVersions(data.versions);
        setDeployments(data.deployments);
        setDomains(data.domains);
        setActiveJob(data.jobs[0] || null);
        setConfirmClearChat(false);
        setConfirmDeleteMsgId(null);

        const currentFile =
          data.files.find((f) => f.path === selectedFilePath) ||
          data.files.find((f) => f.path === 'index.html') ||
          data.files[0];
        if (currentFile) {
          setSelectedFilePath(currentFile.path);
          setEditedCode(currentFile.content);
        }

        if (options?.autoOpenWorkspace) {
          const hasBuildContent =
            data.messages.length > 0 || data.jobs.length > 0 || data.files.length > 1;
          setBuildWorkspaceOpen(hasBuildContent);
          if (hasBuildContent) {
            setSidebarOpen(false);
          }
        }
        setPreviewNonce((n) => n + 1);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : 'Failed to load project');
      }
    },
    [selectedFilePath]
  );

  const loadProjects = useCallback(async () => {
    try {
      const res = await apiRequest<{ projects: SidebarProjectSummary[] }>('/api/projects');
      setProjects(res.projects);
      return res.projects;
    } catch {
      return [];
    }
  }, []);

  const clearJobListeners = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const subscribeToJob = useCallback(
    (jobId: string, projectId: string) => {
      clearJobListeners();
      const url = `/api/projects/jobs/${jobId}/stream`;
      const es = new EventSource(url, { withCredentials: true });
      sseRef.current = es;

      const handlePayload = (payload: { job?: OrchestrationJob; event?: JobEvent }) => {
        if (payload.job) {
          setActiveJob(payload.job);
          if (payload.event?.type === 'low_credit_warning') {
            vektorSound.playLowCredit();
          }
          if (payload.job.status === 'completed') {
            vektorSound.playTaskComplete();
            void loadProjectDetail(projectId);
            void loadProjects();
            void refreshAuth();
            clearJobListeners();
          } else if (payload.job.status === 'failed' || payload.job.status === 'paused_insufficient_credits') {
            if (payload.job.status === 'paused_insufficient_credits') vektorSound.playLowCredit();
            else vektorSound.playError();
            void loadProjectDetail(projectId);
            void refreshAuth();
            clearJobListeners();
          } else if (payload.job.status === 'stopped') {
            void loadProjectDetail(projectId);
            clearJobListeners();
          } else if (payload.event?.type === 'file_written') {
            void loadProjectDetail(projectId);
          }
        }
      };

      es.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          handlePayload(parsed);
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        es.close();
        sseRef.current = null;
        if (pollRef.current !== null) window.clearInterval(pollRef.current);
        pollRef.current = window.setInterval(async () => {
          try {
            const detail = await apiRequest<{ jobs: OrchestrationJob[] }>(`/api/projects/${projectId}`);
            const j = detail.jobs.find((x) => x.id === jobId);
            if (j) {
              setActiveJob(j);
              if (['completed', 'failed', 'stopped', 'paused_insufficient_credits'].includes(j.status)) {
                clearJobListeners();
                if (j.status === 'completed') vektorSound.playTaskComplete();
                else if (j.status === 'paused_insufficient_credits') vektorSound.playLowCredit();
                else if (j.status === 'failed') vektorSound.playError();
                void loadProjectDetail(projectId);
                void loadProjects();
                void refreshAuth();
              }
            }
          } catch {
            clearJobListeners();
          }
        }, 1800);
      };
    },
    [clearJobListeners, loadProjectDetail, loadProjects, refreshAuth]
  );

  useEffect(() => {
    return () => clearJobListeners();
  }, [clearJobListeners]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeJob?.events.length]);

  const triggerGeneration = useCallback(
    async (
      projectId: string,
      prompt: string,
      modelId: string,
      extraAttachments?: AttachedFileSnippet[],
      target?: SelectedTargetInfo | null
    ) => {
      setStatusError(null);
      setBuildWorkspaceOpen(true);
      setSidebarOpen(false);
      setMobilePane('output');
      vektorSound.playTaskStart();

      try {
        // Upload attached files to project if present
        if (extraAttachments && extraAttachments.length > 0) {
          for (const att of extraAttachments) {
            await apiRequest(`/api/projects/${projectId}/files`, {
              method: 'POST',
              body: JSON.stringify({ path: att.name, content: att.content }),
            });
          }
        }

        const contextParts: string[] = [prompt.trim()];
        if (target) {
          contextParts.push(`[Target UI Component: ${target.label} (${target.selector})]`);
        }
        if (extraAttachments && extraAttachments.length > 0) {
          contextParts.push(
            `[Attached Files: ${extraAttachments.map((a) => `${a.name} (${a.size} bytes)`).join(', ')}]`
          );
        }
        const finalPrompt = contextParts.join('\n\n');

        const res = await apiRequest<{ job: OrchestrationJob }>(`/api/projects/${projectId}/generate`, {
          method: 'POST',
          body: JSON.stringify({ prompt: finalPrompt, modelId }),
        });

        setActiveJob(res.job);
        setPromptText('');
        setAttachments([]);
        setSelectedTarget(null);
        await loadProjectDetail(projectId);
        await loadProjects();
        subscribeToJob(res.job.id, projectId);
      } catch (err) {
        vektorSound.playError();
        setStatusError(err instanceof Error ? err.message : 'Failed to start generation');
      }
    },
    [loadProjectDetail, loadProjects, subscribeToJob]
  );

  // Initial load: stay in clean AI Chat workspace unless pendingPrompt came from Landing Page!
  useEffect(() => {
    if (!user) return;
    if (!user.onboardingCompleted) {
      navigate('/onboarding');
      return;
    }

    void loadModelsAndApiSummary();

    const bootstrap = async () => {
      await loadProjects();
      if (pendingPrompt && !pendingConsumedRef.current) {
        pendingConsumedRef.current = true;
        const promptCopy = pendingPrompt;
        clearPendingPrompt();
        try {
          const created = await apiRequest<{ project: SidebarProjectSummary }>('/api/projects', {
            method: 'POST',
            body: JSON.stringify({ prompt: promptCopy, selectedModelId: 'vektor-auto' }),
          });
          await loadProjects();
          await loadProjectDetail(created.project.id);
          await triggerGeneration(created.project.id, promptCopy, 'vektor-auto');
        } catch (err) {
          setStatusError(err instanceof Error ? err.message : 'Failed to launch preserved prompt');
        }
      }
    };

    void bootstrap();
  }, [user]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-6">
        <div className="text-center max-w-sm">
          <h2 className="font-display text-xl font-bold mb-2">Sign in to open VEKTOR Workspace</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Your AI chat workspace, project history, live previews, and API keys live here.
          </p>
          <button
            type="button"
            onClick={() => navigate('/auth')}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium cursor-pointer"
          >
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  const handleNewChat = () => {
    clearJobListeners();
    setActiveProject(null);
    setFiles([]);
    setMessages([]);
    setVersions([]);
    setActiveJob(null);
    setDeployments([]);
    setDomains([]);
    setBuildWorkspaceOpen(false);
    setStatusError(null);
    setConfirmClearChat(false);
    setConfirmDeleteMsgId(null);
    setElementSelectMode(false);
    setSelectedTarget(null);
    setAttachments([]);
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setSidebarOpen(true);
    }
  };

  const handleSendPrompt = async () => {
    if (!promptText.trim() || isJobRunning) return;
    setStatusError(null);

    if (!activeProject) {
      try {
        const created = await apiRequest<{ project: SidebarProjectSummary }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ prompt: promptText.trim(), selectedModelId }),
        });
        await loadProjects();
        await loadProjectDetail(created.project.id);
        await triggerGeneration(created.project.id, promptText.trim(), selectedModelId, attachments, selectedTarget);
      } catch (err) {
        vektorSound.playError();
        setStatusError(err instanceof Error ? err.message : 'Could not create project');
      }
      return;
    }

    await triggerGeneration(activeProject.id, promptText.trim(), selectedModelId, attachments, selectedTarget);
  };

  const handleDeleteProject = async (projectId: string) => {
    setStatusError(null);
    try {
      await apiRequest(`/api/projects/${projectId}`, { method: 'DELETE' });
      const updatedList = await loadProjects();
      if (activeProject?.id === projectId) {
        clearJobListeners();
        setActiveProject(null);
        setFiles([]);
        setMessages([]);
        setVersions([]);
        setActiveJob(null);
        setDeployments([]);
        setDomains([]);
        setBuildWorkspaceOpen(false);
        if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
          setSidebarOpen(true);
        }
      }
      void updatedList;
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeProject) return;
    try {
      await apiRequest(`/api/projects/${activeProject.id}/messages/${messageId}`, {
        method: 'DELETE',
      });
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setConfirmDeleteMsgId(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to delete message');
    }
  };

  const handleClearConversation = async () => {
    if (!activeProject) return;
    try {
      await apiRequest(`/api/projects/${activeProject.id}/messages`, {
        method: 'DELETE',
      });
      setMessages([]);
      setActiveJob(null);
      setConfirmClearChat(false);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to delete conversation');
    }
  };

  const handleRenameProject = async (newName: string) => {
    if (!activeProject || !newName.trim()) return;
    await apiRequest(`/api/projects/${activeProject.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: newName.trim() }),
    });
    await loadProjects();
    setActiveProject((p) => (p ? { ...p, name: newName.trim() } : p));
  };

  const handleSaveFile = async () => {
    if (!activeProject || !selectedFilePath) return;
    await apiRequest(`/api/projects/${activeProject.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ path: selectedFilePath, content: editedCode }),
    });
    await loadProjectDetail(activeProject.id);
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !newFilePath.trim()) return;
    const clean = newFilePath.trim().replace(/^\/+/, '');
    await apiRequest(`/api/projects/${activeProject.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ path: clean, content: `// ${clean}\n` }),
    });
    setNewFilePath('');
    setSelectedFilePath(clean);
    await loadProjectDetail(activeProject.id);
  };

  const handleDeleteFile = async (path: string) => {
    if (!activeProject) return;
    await apiRequest(`/api/projects/${activeProject.id}/files?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
    await loadProjectDetail(activeProject.id);
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeProject || !e.target.files) return;
    for (const file of Array.from(e.target.files)) {
      const content = await file.text();
      await apiRequest(`/api/projects/${activeProject.id}/files`, {
        method: 'POST',
        body: JSON.stringify({ path: file.name, content }),
      });
    }
    e.target.value = '';
    await loadProjectDetail(activeProject.id);
  };

  const handleDownloadZip = async () => {
    if (!activeProject) return;
    const token = getStoredSessionToken();
    const res = await fetch(`/api/projects/${activeProject.id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'vektor-project'}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePublish = async () => {
    if (!activeProject) return;
    setPublishing(true);
    setStatusError(null);
    try {
      await apiRequest(`/api/projects/${activeProject.id}/publish`, { method: 'POST' });
      await loadProjectDetail(activeProject.id);
      await loadProjects();
      setBuildWorkspaceOpen(true);
      setRightTab('publish');
      vektorSound.playTaskComplete();
    } catch (err) {
      vektorSound.playError();
      setStatusError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject || !newDomainInput.trim()) return;
    setDomainNotice(null);
    setStatusError(null);
    try {
      await apiRequest('/api/domains', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProject.id, domain: newDomainInput.trim() }),
      });
      setNewDomainInput('');
      await loadProjectDetail(activeProject.id);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to register custom domain');
    }
  };

  const handleVerifyDomain = async (domainId: string) => {
    setDomainNotice(null);
    try {
      const res = await apiRequest<{ verified: boolean; diagnostics: string[] }>(
        `/api/domains/${domainId}/verify`,
        { method: 'POST' }
      );
      setDomainNotice(
        res.verified
          ? 'DNS verified and SSL certificate active.'
          : `DNS pending: ${res.diagnostics.join(' | ')}`
      );
      if (activeProject) await loadProjectDetail(activeProject.id);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Domain verification error');
    }
  };

  const handleStopJob = async () => {
    if (!activeJob) return;
    await apiRequest(`/api/projects/jobs/${activeJob.id}/stop`, { method: 'POST' });
    clearJobListeners();
    if (activeProject) await loadProjectDetail(activeProject.id);
  };

  const handleResumeJob = async () => {
    if (!activeJob || !activeProject) return;
    try {
      await apiRequest(`/api/projects/jobs/${activeJob.id}/resume`, { method: 'POST' });
      vektorSound.playTaskStart();
      subscribeToJob(activeJob.id, activeProject.id);
    } catch (err) {
      vektorSound.playLowCredit();
      setStatusError(err instanceof Error ? err.message : 'Could not resume job');
    }
  };

  const handleRegenerate = async () => {
    if (!activeProject) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const promptToRun = lastUserMsg?.content || activeJob?.prompt;
    if (!promptToRun) return;
    await triggerGeneration(activeProject.id, promptToRun, selectedModelId);
  };

  const handleUndo = async () => {
    if (!activeProject || versions.length < 2) return;
    const previousVersion = versions[1];
    await apiRequest(`/api/projects/${activeProject.id}/versions/${previousVersion.id}/restore`, {
      method: 'POST',
    });
    await loadProjectDetail(activeProject.id);
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!activeProject) return;
    await apiRequest(`/api/projects/${activeProject.id}/versions/${versionId}/restore`, {
      method: 'POST',
    });
    setHistoryDrawerOpen(false);
    await loadProjectDetail(activeProject.id);
  };

  const indexHtmlContent =
    files.find((f) => f.path === 'index.html')?.content ||
    '<html><body style="font-family:sans-serif;padding:24px;color:#18181b;">Building your application preview...</body></html>';

  const previewSrcDoc = useMemo(() => {
    if (!elementSelectMode) return indexHtmlContent;
    if (indexHtmlContent.includes('</body>')) {
      return indexHtmlContent.replace('</body>', `${ELEMENT_PICKER_SCRIPT}</body>`);
    }
    return `${indexHtmlContent}${ELEMENT_PICKER_SCRIPT}`;
  }, [indexHtmlContent, elementSelectMode]);

  const isJobRunning = activeJob?.status === 'running' || activeJob?.status === 'queued';

  const completedTasksCount = activeJob
    ? activeJob.tasks.filter((t) => t.status === 'completed').length
    : 0;
  const totalTasksCount = activeJob ? activeJob.tasks.length : 0;

  const userInitials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() || '')
    .join('') || 'V';

  // Sidebar behaves as an inline left column ONLY in focused chat mode on lg+ screens,
  // and ALWAYS as an overlay drawer whenever buildWorkspaceOpen is true (preventing 3 columns!).
  const sidebarIsOverlay = buildWorkspaceOpen || (typeof window !== 'undefined' && window.innerWidth < 1024);

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 overflow-hidden">
      {/* WORKSPACE TOP BAR */}
      <header className="h-14 shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 sm:px-4 flex items-center justify-between gap-3 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
              sidebarOpen
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                : 'border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200'
            }`}
            title="Toggle Project History Sidebar"
            aria-label="Toggle Project History Sidebar"
          >
            <PanelLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Projects</span>
            <span className="font-mono text-[11px] opacity-75">({projects.length})</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2 shrink-0 cursor-pointer"
            title="VEKTOR AI Home"
          >
            <VektorBrandMark className="w-6 h-6" />
            <span className="font-display font-bold text-sm hidden md:inline">VEKTOR AI</span>
          </button>

          {activeProject && (
            <div className="flex items-center gap-2 min-w-0 pl-1 border-l border-zinc-200 dark:border-zinc-800">
              <input
                type="text"
                aria-label="Project Name"
                value={activeProject.name}
                onChange={(e) => setActiveProject({ ...activeProject, name: e.target.value })}
                onBlur={(e) => void handleRenameProject(e.target.value)}
                className="bg-transparent font-medium text-xs sm:text-sm border border-transparent hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-blue-600 rounded px-2 py-1 min-w-0 max-w-[140px] sm:max-w-[200px] truncate focus:outline-none"
              />
              <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 hidden xl:inline whitespace-nowrap">
                {isJobRunning ? 'building...' : activeProject.status}
              </span>
            </div>
          )}
        </div>

        {/* TOP-RIGHT ACTIONS, CREDITS, PROFILE & SETTINGS */}
        <div className="flex items-center gap-2 shrink-0">
          {activeProject && buildWorkspaceOpen && (
            <>
              <button
                type="button"
                onClick={() => setBuildWorkspaceOpen(false)}
                className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
                title="Expand AI Chat view"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Focus Chat</span>
              </button>

              <button
                type="button"
                onClick={() => setGithubModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
                title="Sync with GitHub"
              >
                <GitHubOfficialIcon className="w-3.5 h-3.5" />
                <span className="hidden md:inline">GitHub</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadZip}
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
                title="Download Project ZIP"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>

              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{publishing ? 'Publishing...' : 'Publish'}</span>
              </button>
            </>
          )}

          {activeProject && !buildWorkspaceOpen && (files.length > 1 || messages.length > 0) && (
            <button
              type="button"
              onClick={() => {
                setBuildWorkspaceOpen(true);
                setSidebarOpen(false);
              }}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-blue-600" />
              <span>Open Live Workspace</span>
            </button>
          )}

          {/* Wallet Balance */}
          <button
            type="button"
            onClick={() => navigate('/billing')}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-mono tabular-nums hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
            title="Wallet Balance & Top-Up"
          >
            <Wallet className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>{wallet?.balanceCredits ?? 0} cr</span>
          </button>

          {/* Direct API Shortcut */}
          <button
            type="button"
            onClick={() => navigate('/api-gateway')}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
            title="Developer API & API Keys"
          >
            <KeyRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>API</span>
          </button>

          {/* Settings Gear */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            aria-label="Workspace Settings"
            title="Workspace Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Top-Right User Profile & Account Controls */}
          <div className="relative" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setProfileMenuOpen((v) => !v)}
              className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              aria-label="Account menu"
            >
              <span className="w-6 h-6 rounded-md bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                {userInitials}
              </span>
              <span className="hidden md:inline text-xs font-medium max-w-[110px] truncate">
                {user.name}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            </button>

            {profileMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-2 z-50 space-y-1 text-xs">
                <div className="px-2.5 py-2 border-b border-zinc-100 dark:border-zinc-800">
                  <div className="font-semibold text-zinc-950 dark:text-white truncate">{user.name}</div>
                  <div className="text-[11px] text-zinc-500 truncate">{user.email}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-zinc-500">
                    <span className="capitalize">Role: {user.role.replace('_', ' ')}</span>
                    <span>{wallet?.balanceCredits ?? 0} credits</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    {theme === 'dark' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                    <span>Theme</span>
                  </span>
                  <span className="text-zinc-500 capitalize">{theme}</span>
                </button>

                <button
                  type="button"
                  onClick={toggleSound}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    {soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    <span>Sound Effects</span>
                  </span>
                  <span className="text-zinc-500">{soundMuted ? 'Muted' : 'On'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    navigate('/api-gateway');
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                    <span>Developer API &amp; Keys</span>
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">{apiOverview.activeKeysCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    navigate('/billing');
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Billing &amp; Plans</span>
                  </span>
                  <span className="text-zinc-500">{apiOverview.planName}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Workspace Settings</span>
                </button>

                {(user.role === 'admin' || user.role === 'super_admin') && (
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      navigate('/admin');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>Admin Dashboard</span>
                  </button>
                )}

                <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MOBILE PANE SWITCHER (ONLY WHEN BUILD WORKSPACE IS OPEN) */}
      {buildWorkspaceOpen && (
        <div className="lg:hidden flex border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setMobilePane('chat')}
            className={`flex-1 py-2 text-xs font-medium cursor-pointer ${
              mobilePane === 'chat' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-zinc-500'
            }`}
          >
            AI Chat &amp; Build
          </button>
          <button
            type="button"
            onClick={() => setMobilePane('output')}
            className={`flex-1 py-2 text-xs font-medium cursor-pointer ${
              mobilePane === 'output' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-zinc-500'
            }`}
          >
            Live Workspace &amp; Preview
          </button>
        </div>
      )}

      {/* MAIN BODY: NEVER 3 EQUAL COLUMNS */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* PROJECT HISTORY SIDEBAR:
            - Inline left rail ONLY when buildWorkspaceOpen === false on desktop
            - Overlay slide-over drawer when buildWorkspaceOpen === true OR on small screens */}
        {sidebarOpen && !buildWorkspaceOpen && (
          <div className="hidden lg:flex h-full shrink-0">
            <WorkspaceSidebar
              user={user}
              wallet={wallet}
              projects={projects}
              activeProjectId={activeProject?.id || null}
              apiKeysCount={apiOverview.activeKeysCount}
              dailyRequestsUsed={apiOverview.requestsToday}
              dailyRequestLimit={apiOverview.dailyRequestLimit}
              activePlanName={apiOverview.planName}
              isOverlayMode={false}
              onClose={() => setSidebarOpen(false)}
              onNewChat={handleNewChat}
              onSelectProject={(pid) => void loadProjectDetail(pid, { autoOpenWorkspace: true })}
              onDeleteProject={handleDeleteProject}
              onNavigate={navigate}
            />
          </div>
        )}

        {sidebarOpen && sidebarIsOverlay && (
          <div className="fixed inset-0 top-14 z-40 flex">
            <div
              className="fixed inset-0 top-14 bg-black/35 backdrop-blur-[1px]"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="relative z-10 h-full">
              <WorkspaceSidebar
                user={user}
                wallet={wallet}
                projects={projects}
                activeProjectId={activeProject?.id || null}
                apiKeysCount={apiOverview.activeKeysCount}
                dailyRequestsUsed={apiOverview.requestsToday}
                dailyRequestLimit={apiOverview.dailyRequestLimit}
                activePlanName={apiOverview.planName}
                isOverlayMode={true}
                onClose={() => setSidebarOpen(false)}
                onNewChat={handleNewChat}
                onSelectProject={(pid) => void loadProjectDetail(pid, { autoOpenWorkspace: true })}
                onDeleteProject={handleDeleteProject}
                onNavigate={navigate}
              />
            </div>
          </div>
        )}

        {/* STATE A: FOCUSED CLEAN AI CHAT WORKSPACE (No large preview panel before user sends a message) */}
        {!buildWorkspaceOpen ? (
          <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-50 dark:bg-zinc-950">
            <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-8 flex flex-col justify-center items-center">
              <div className="w-full max-w-3xl space-y-6">
                {statusError && (
                  <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                    {statusError}
                  </div>
                )}

                {messages.length === 0 ? (
                  <div className="text-center space-y-3 pb-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>VEKTOR AI Engineering Studio</span>
                    </div>
                    <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-950 dark:text-white">
                      What would you like to build today?
                    </h1>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
                      Describe your application, upload files, or use voice and AI suggestions. Once you send your prompt, the live build workspace opens beside this chat.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        className={`group relative rounded-xl p-4 text-sm leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-zinc-950 text-white dark:bg-blue-600 ml-10'
                            : m.role === 'system'
                              ? 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
                              : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 mr-10'
                        }`}
                      >
                        <div className="whitespace-pre-wrap pr-6">{m.content}</div>
                        {activeProject && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteMessage(m.id)}
                            title="Delete message"
                            className="opacity-0 group-hover:opacity-100 absolute top-3 right-3 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer transition-opacity"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <WorkspaceComposer
                  projectId={activeProject?.id || null}
                  promptText={promptText}
                  onPromptChange={setPromptText}
                  selectedModelId={selectedModelId}
                  onModelChange={setSelectedModelId}
                  models={models}
                  isJobRunning={isJobRunning}
                  hasPreviewOpen={false}
                  elementSelectMode={elementSelectMode}
                  onToggleElementSelectMode={() => setElementSelectMode((v) => !v)}
                  selectedTarget={selectedTarget}
                  onSelectTarget={setSelectedTarget}
                  attachments={attachments}
                  onAddAttachments={(newFiles) =>
                    setAttachments((prev) => {
                      const map = new Map(prev.map((p) => [p.name, p]));
                      newFiles.forEach((f) => map.set(f.name, f));
                      return Array.from(map.values());
                    })
                  }
                  onRemoveAttachment={(name) =>
                    setAttachments((prev) => prev.filter((a) => a.name !== name))
                  }
                  onSubmitPrompt={() => void handleSendPrompt()}
                  onStopJob={() => void handleStopJob()}
                />

                {/* Clean API & Project Quick Cards (2 compact tiles, zero clutter) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => navigate('/api-gateway')}
                    className="text-left p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-blue-600 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-950 dark:text-white">
                        <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span>VEKTOR Developer API &amp; Keys</span>
                      </span>
                      <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400">Open &rarr;</span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 font-mono tabular-nums">
                      {apiOverview.activeKeysCount} customer keys &middot; {apiOverview.requestsToday}/
                      {apiOverview.dailyRequestLimit} req today &middot; {apiOverview.planName} Plan
                    </p>
                  </button>

                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-zinc-950 dark:text-white">
                        Saved Projects &amp; History
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                        {projects.length > 0
                          ? `Select any of your ${projects.length} projects from the sidebar.`
                          : 'Your generated projects will appear in the sidebar.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSidebarOpen(true)}
                      className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0 cursor-pointer"
                    >
                      Browse
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </main>
        ) : (
          /* STATE B: TWO-PANE LIVE PROJECT-BUILDING WORKSPACE (Minimized Chat Left + Live Preview/Code/Files/Publish Right) */
          <>
            {/* LEFT PANE: COMPACT CHAT & LIVE BUILD ACTIVITY */}
            <section
              className={`w-full lg:w-[390px] xl:w-[420px] shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0 bg-zinc-50 dark:bg-zinc-950 ${
                mobilePane === 'chat' ? 'flex' : 'hidden lg:flex'
              }`}
            >
              {/* Chat Toolbar */}
              <div className="px-3.5 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  <span>{activeProject?.totalTokensUsed ?? 0} tok</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={versions.length < 2}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                    title="Undo to previous version"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Undo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryDrawerOpen((v) => !v)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    title="Version history"
                  >
                    <History className="w-3 h-3" />
                    <span>v{versions.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerate}
                    disabled={isJobRunning || !activeProject}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                    title="Regenerate last prompt"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>

                  {messages.length > 0 && !confirmClearChat && (
                    <button
                      type="button"
                      onClick={() => setConfirmClearChat(true)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-600 hover:border-red-300 cursor-pointer"
                      title="Delete chat conversation"
                      aria-label="Delete chat conversation"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Inline Confirm Clear Conversation */}
              {confirmClearChat && (
                <div className="px-3.5 py-2.5 border-b border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 flex items-center justify-between gap-2 text-xs">
                  <span className="text-red-800 dark:text-red-200 font-medium">
                    Delete this conversation?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleClearConversation()}
                      className="px-2.5 py-1 rounded bg-red-600 text-white font-medium cursor-pointer"
                    >
                      Delete Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearChat(false)}
                      className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Version History Drawer */}
              {historyDrawerOpen && (
                <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 max-h-48 overflow-y-auto space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Version Checkpoints</span>
                    <button type="button" onClick={() => setHistoryDrawerOpen(false)} className="cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between gap-2 text-xs p-2 rounded border border-zinc-200 dark:border-zinc-800"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-semibold">v{v.versionNumber}</div>
                        <div className="text-zinc-500 truncate">{v.summary}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRestoreVersion(v.id)}
                        className="px-2 py-1 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-[11px] font-medium shrink-0 cursor-pointer"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Chat Thread & Live Build Progress */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                {statusError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                    {statusError}
                  </div>
                )}

                {messages.length === 0 && !activeJob && (
                  <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-600 dark:text-zinc-300">
                    Conversation cleared. Describe your next change below to continue building.
                  </div>
                )}

                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`group relative rounded-xl p-3 text-xs sm:text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-zinc-950 text-white dark:bg-blue-600 ml-5'
                        : m.role === 'system'
                          ? 'bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
                          : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 mr-3'
                    }`}
                  >
                    <div className="whitespace-pre-wrap pr-6">{m.content}</div>

                    {/* Per-Message Delete with Confirmation */}
                    {confirmDeleteMsgId === m.id ? (
                      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px]">
                        <button
                          type="button"
                          onClick={() => void handleDeleteMessage(m.id)}
                          className="px-2 py-0.5 rounded bg-red-600 text-white font-medium cursor-pointer"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteMsgId(null)}
                          className="px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white/90 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteMsgId(m.id)}
                        title="Delete message"
                        aria-label="Delete message"
                        className="opacity-0 group-hover:opacity-100 absolute top-2.5 right-2.5 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}

                    {m.modelUsed && (
                      <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                        <span>{m.modelUsed}</span>
                        {m.latencyMs ? <span>&middot; {m.latencyMs}ms</span> : null}
                        {m.tokensUsed ? <span>&middot; {m.tokensUsed} tok</span> : null}
                      </div>
                    )}
                  </div>
                ))}

                {/* LIVE CODING / BUILD PROGRESS CARD */}
                {activeJob && (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-950 dark:text-white">
                        {isJobRunning ? (
                          <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                        <span>
                          Build Pipeline &middot; {activeJob.status}
                          {totalTasksCount > 0 ? ` (${completedTasksCount}/${totalTasksCount})` : ''}
                        </span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isJobRunning && (
                          <button
                            type="button"
                            onClick={handleStopJob}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium cursor-pointer"
                          >
                            <Square className="w-3 h-3 fill-current" />
                            <span>Stop</span>
                          </button>
                        )}
                        {(activeJob.status === 'paused_insufficient_credits' ||
                          activeJob.status === 'stopped' ||
                          activeJob.status === 'failed') && (
                          <button
                            type="button"
                            onClick={handleResumeJob}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            <span>Resume</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {activeJob.status === 'paused_insufficient_credits' && (
                      <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5">
                          <PauseCircle className="w-4 h-4 shrink-0" />
                          <span>Credits exhausted. Checkpoint saved.</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => navigate('/billing')}
                          className="underline font-semibold shrink-0 cursor-pointer"
                        >
                          Top Up
                        </button>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      {activeJob.tasks.map((task) => (
                        <div
                          key={task.stepKey}
                          className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2 font-medium">
                            <span className="truncate">{task.title}</span>
                            <span className="font-mono text-[11px] text-zinc-500 shrink-0">{task.status}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500 font-mono tabular-nums flex flex-wrap gap-2">
                            <span>{task.actualModelUsed || task.assignedModelId}</span>
                            {task.latencyMs > 0 && <span>&middot; {task.latencyMs}ms</span>}
                            {task.tokensUsed > 0 && <span>&middot; {task.tokensUsed} tok</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {activeJob.events.length > 0 && (
                      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1 max-h-28 overflow-y-auto">
                        {activeJob.events.slice(-6).map((ev) => (
                          <div key={ev.id} className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                            {ev.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* COMPACT PROMPT COMPOSER AT BOTTOM OF LEFT PANE */}
              <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <WorkspaceComposer
                  compact
                  projectId={activeProject?.id || null}
                  promptText={promptText}
                  onPromptChange={setPromptText}
                  selectedModelId={selectedModelId}
                  onModelChange={setSelectedModelId}
                  models={models}
                  isJobRunning={isJobRunning}
                  hasPreviewOpen={rightTab === 'preview'}
                  elementSelectMode={elementSelectMode}
                  onToggleElementSelectMode={() => setElementSelectMode((v) => !v)}
                  selectedTarget={selectedTarget}
                  onSelectTarget={setSelectedTarget}
                  attachments={attachments}
                  onAddAttachments={(newFiles) =>
                    setAttachments((prev) => {
                      const map = new Map(prev.map((p) => [p.name, p]));
                      newFiles.forEach((f) => map.set(f.name, f));
                      return Array.from(map.values());
                    })
                  }
                  onRemoveAttachment={(name) =>
                    setAttachments((prev) => prev.filter((a) => a.name !== name))
                  }
                  onSubmitPrompt={() => void handleSendPrompt()}
                  onStopJob={() => void handleStopJob()}
                />
              </div>
            </section>

            {/* RIGHT PANE: LIVE PROJECT-BUILDING WORKSPACE (Preview / Code / Files / Publish) */}
            <section
              className={`flex-1 flex flex-col min-w-0 min-h-0 bg-zinc-100 dark:bg-zinc-950 ${
                mobilePane === 'output' ? 'flex' : 'hidden lg:flex'
              }`}
            >
              {/* Right Toolbar */}
              <div className="h-11 shrink-0 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center justify-between gap-4">
                <div className="flex items-center gap-1 p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-x-auto">
                  {(
                    [
                      { id: 'preview', label: 'Preview', Icon: Eye },
                      { id: 'code', label: 'Code', Icon: Code2 },
                      { id: 'files', label: 'Files', Icon: FolderTree },
                      { id: 'publish', label: 'Publish & Domains', Icon: Globe },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRightTab(id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        rightTab === id
                          ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-sm'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                {rightTab === 'preview' && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(
                      [
                        { id: 'desktop', Icon: Monitor },
                        { id: 'tablet', Icon: Tablet },
                        { id: 'mobile', Icon: Smartphone },
                      ] as const
                    ).map(({ id, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPreviewViewport(id)}
                        className={`p-1.5 rounded cursor-pointer ${
                          previewViewport === id
                            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-950 dark:text-white'
                            : 'text-zinc-500'
                        }`}
                        aria-label={`${id} preview`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPreviewNonce((n) => n + 1)}
                      className="p-1.5 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      aria-label="Reload preview"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuildWorkspaceOpen(false)}
                      className="p-1.5 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer hidden lg:inline-flex"
                      aria-label="Minimize preview to focus chat"
                      title="Minimize preview"
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                    </button>
                    {activeProject?.previewSlug && (
                      <a
                        href={`/hosted/${activeProject.previewSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline ml-1"
                      >
                        <span>Live URL</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Tab Body */}
              <div className="flex-1 min-h-0 overflow-auto p-4 relative">
                {rightTab === 'preview' && (
                  <div className="h-full flex flex-col items-center">
                    {isJobRunning && (
                      <div className="w-full mb-3 px-3.5 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-center justify-between gap-2 text-xs text-blue-800 dark:text-blue-200">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                          <span>
                            VEKTOR AI is coding and updating files live...
                            {totalTasksCount > 0 ? ` (${completedTasksCount}/${totalTasksCount} steps complete)` : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={handleStopJob}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white text-[11px] font-medium cursor-pointer"
                        >
                          <Square className="w-2.5 h-2.5 fill-current" />
                          <span>Stop</span>
                        </button>
                      </div>
                    )}
                    <iframe
                      key={`${activeProject?.id}-${previewNonce}-${elementSelectMode ? 'pick' : 'view'}`}
                      title="VEKTOR Live Application Preview"
                      srcDoc={previewSrcDoc}
                      sandbox="allow-scripts allow-forms allow-modals"
                      className={`flex-1 h-full bg-white rounded-xl border transition-all ${
                        elementSelectMode
                          ? 'border-blue-600 ring-2 ring-blue-500/30'
                          : 'border-zinc-200 dark:border-zinc-800'
                      } ${
                        previewViewport === 'desktop'
                          ? 'w-full'
                          : previewViewport === 'tablet'
                            ? 'w-[768px] max-w-full'
                            : 'w-[390px] max-w-full'
                      }`}
                    />
                  </div>
                )}

                {rightTab === 'code' && (
                  <div className="h-full flex flex-col bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
                      <select
                        value={selectedFilePath}
                        onChange={(e) => {
                          const nextPath = e.target.value;
                          setSelectedFilePath(nextPath);
                          const found = files.find((f) => f.path === nextPath);
                          setEditedCode(found?.content || '');
                        }}
                        className="text-xs font-mono px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      >
                        {files.map((f) => (
                          <option key={f.id} value={f.path}>
                            {f.path}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleSaveFile}
                        className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
                      >
                        Save File
                      </button>
                    </div>
                    <textarea
                      value={editedCode}
                      onChange={(e) => setEditedCode(e.target.value)}
                      spellCheck={false}
                      className="flex-1 w-full p-4 font-mono text-xs leading-relaxed bg-zinc-950 text-zinc-100 focus:outline-none resize-none"
                    />
                  </div>
                )}

                {rightTab === 'files' && (
                  <div className="max-w-3xl mx-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-display font-semibold text-base">Workspace Files</h3>
                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleUploadFiles}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Upload</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadZip}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 dark:bg-blue-600 text-white text-xs font-medium cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download ZIP</span>
                        </button>
                      </div>
                    </div>

                    <form onSubmit={handleCreateFile} className="flex gap-2">
                      <input
                        type="text"
                        value={newFilePath}
                        onChange={(e) => setNewFilePath(e.target.value)}
                        placeholder="components/Header.js"
                        className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium cursor-pointer"
                      >
                        Create File
                      </button>
                    </form>

                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                      {files.map((f) => (
                        <div key={f.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedFilePath(f.path);
                              setEditedCode(f.content);
                              setRightTab('code');
                            }}
                            className="font-mono text-left hover:text-blue-600 truncate cursor-pointer"
                          >
                            {f.path}
                          </button>
                          <div className="flex items-center gap-3 shrink-0 text-zinc-500 font-mono tabular-nums">
                            <span>{f.content.length} B</span>
                            {f.path !== 'index.html' && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteFile(f.path)}
                                className="text-zinc-400 hover:text-red-600 cursor-pointer"
                                aria-label={`Delete ${f.path}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rightTab === 'publish' && (
                  <div className="max-w-3xl mx-auto space-y-6">
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-display font-semibold text-base">VEKTOR Managed Hosting</h3>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Publish or republish your live application bundle under VEKTOR hosting.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handlePublish}
                          disabled={publishing}
                          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
                        >
                          {publishing ? 'Publishing...' : deployments.length > 0 ? 'Republish Update' : 'Publish Live'}
                        </button>
                      </div>

                      {deployments.length > 0 && (
                        <div className="space-y-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium">Latest Live URL</span>
                            <a
                              href={deployments[0].liveUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              <span>{deployments[0].liveUrl}</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                          <div className="bg-zinc-950 text-zinc-300 rounded-lg p-3 font-mono text-[11px] space-y-1 max-h-40 overflow-y-auto">
                            {deployments[0].logs.map((line, i) => (
                              <div key={i}>{line}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 space-y-4">
                      <div>
                        <h3 className="font-display font-semibold text-base">Custom Domains &amp; SSL</h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Available on Pro, Business, Agency, and Enterprise plans. Point your DNS records and verify ownership.
                        </p>
                      </div>

                      {domainNotice && (
                        <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs">{domainNotice}</div>
                      )}

                      <form onSubmit={handleAddDomain} className="flex gap-2">
                        <input
                          type="text"
                          value={newDomainInput}
                          onChange={(e) => setNewDomainInput(e.target.value)}
                          placeholder="app.yourdomain.com"
                          className="flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                        />
                        <button
                          type="submit"
                          className="px-4 py-2 rounded-lg bg-zinc-950 dark:bg-blue-600 text-white text-xs font-medium cursor-pointer"
                        >
                          Connect Domain
                        </button>
                      </form>

                      <div className="space-y-3">
                        {domains.map((dom) => (
                          <div
                            key={dom.id}
                            className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-semibold text-sm">{dom.domain}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-500">
                                  DNS: {dom.dnsVerified ? 'Verified' : 'Pending'} &middot; SSL: {dom.sslStatus}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleVerifyDomain(dom.id)}
                                  className="px-2.5 py-1 rounded bg-blue-600 text-white text-[11px] font-medium cursor-pointer"
                                >
                                  Verify DNS
                                </button>
                              </div>
                            </div>
                            <div className="bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded font-mono text-[11px] space-y-1 text-zinc-600 dark:text-zinc-400">
                              <div>CNAME {dom.domain} &rarr; edge.vektor.app</div>
                              <div>TXT _vektor-verify.{dom.domain} &rarr; {dom.verificationToken}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {/* SETTINGS DRAWER */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 p-6 flex flex-col justify-between">
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <h2 className="font-display font-bold text-lg">Workspace Settings</h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-1 text-sm">
                <div className="font-semibold">{user.name}</div>
                <div className="text-xs text-zinc-500">
                  {user.email} &middot; Role: {user.role}
                </div>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm cursor-pointer"
                >
                  <span>Appearance</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                    {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                    {theme === 'dark' ? 'Dark' : 'Light'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={toggleSound}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm cursor-pointer"
                >
                  <span>Sound Effects</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                    {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    {soundMuted ? 'Muted' : 'Enabled'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    navigate('/billing');
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm cursor-pointer"
                >
                  <span>Billing &amp; Credits</span>
                  <span className="font-mono text-xs tabular-nums">{wallet?.balanceCredits ?? 0} cr</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    navigate('/api-gateway');
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-sm cursor-pointer"
                >
                  <span>VEKTOR Developer API &amp; Keys</span>
                  <span className="text-xs text-zinc-500">{apiOverview.activeKeysCount} keys</span>
                </button>

                {(user.role === 'admin' || user.role === 'super_admin') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      navigate('/admin');
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 text-sm text-blue-700 dark:text-blue-300 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Admin Dashboard
                    </span>
                    <span className="text-xs">Manage</span>
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {githubModalOpen && activeProject && (
        <GitHubModal
          projectId={activeProject.id}
          projectName={activeProject.name}
          currentRepo={activeProject.githubRepoFullName}
          currentBranch={activeProject.githubBranch}
          onClose={() => setGithubModalOpen(false)}
          onSynced={() => void loadProjectDetail(activeProject.id)}
        />
      )}
    </div>
  );
}
