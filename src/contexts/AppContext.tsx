import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest, getStoredSessionToken, setStoredSessionToken } from '../lib/api.ts';
import { vektorSound } from '../lib/sound.ts';

export interface ClientUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'super_admin';
  status: 'active' | 'suspended';
  emailVerified: boolean;
  preferredTheme: 'light' | 'dark';
  onboardingCompleted: boolean;
  avatarUrl: string | null;
}

export interface ClientWallet {
  userId: string;
  balanceCredits: number;
  lifetimeCreditsPurchased: number;
  lifetimeCreditsUsed: number;
  lowCreditThreshold: number;
}

export interface ClientPlan {
  id: string;
  slug: string;
  name: string;
  audience: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  monthlyPriceInr: number;
  monthlyCredits: number;
  maxProjects: number;
  rateLimitRpm: number;
  dailyRequestLimit?: number;
  customDomainsEnabled: boolean;
  features: string[];
}

export interface ClientOnboarding {
  preferredTheme: 'light' | 'dark';
  discoverySource: string;
  projectPurpose: string;
  projectScale: string;
}

interface AuthMeResponse {
  user: ClientUser;
  wallet: ClientWallet;
  onboarding: ClientOnboarding | null;
  plan: ClientPlan | null;
  github: { connected: boolean; username?: string; avatarUrl?: string | null };
}

interface AppContextValue {
  route: string;
  navigate: (to: string) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  soundMuted: boolean;
  toggleSound: () => void;
  user: ClientUser | null;
  wallet: ClientWallet | null;
  onboarding: ClientOnboarding | null;
  plan: ClientPlan | null;
  githubStatus: { connected: boolean; username?: string; avatarUrl?: string | null };
  authLoading: boolean;
  refreshAuth: () => Promise<AuthMeResponse | null>;
  logout: () => Promise<void>;
  pendingPrompt: string;
  setPendingPrompt: (prompt: string) => void;
  clearPendingPrompt: () => void;
}

const PENDING_PROMPT_KEY = 'vektor_pending_prompt';
const THEME_KEY = 'vektor_theme';

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.pathname || '/' : '/'
  );
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [soundMuted, setSoundMuted] = useState<boolean>(() => vektorSound.isMuted());

  const [user, setUser] = useState<ClientUser | null>(null);
  const [wallet, setWallet] = useState<ClientWallet | null>(null);
  const [onboarding, setOnboarding] = useState<ClientOnboarding | null>(null);
  const [plan, setPlan] = useState<ClientPlan | null>(null);
  const [githubStatus, setGithubStatus] = useState<{ connected: boolean; username?: string; avatarUrl?: string | null }>({
    connected: false,
  });
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [pendingPrompt, setPendingPromptState] = useState<string>(() => {
    try {
      return sessionStorage.getItem(PENDING_PROMPT_KEY) || '';
    } catch {
      return '';
    }
  });

  const applyThemeDom = useCallback((t: 'light' | 'dark') => {
    setThemeState(t);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', t === 'dark');
    }
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    applyThemeDom(theme);
  }, [applyThemeDom, theme]);

  const setTheme = useCallback(
    (next: 'light' | 'dark') => {
      applyThemeDom(next);
      if (user) {
        void apiRequest('/api/auth/profile', {
          method: 'PUT',
          body: JSON.stringify({ preferredTheme: next }),
        }).catch(() => {});
      }
    },
    [applyThemeDom, user]
  );

  const toggleSound = useCallback(() => {
    const next = !vektorSound.isMuted();
    vektorSound.setMuted(next);
    setSoundMuted(next);
  }, []);

  const setPendingPrompt = useCallback((prompt: string) => {
    setPendingPromptState(prompt);
    try {
      if (prompt) sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
      else sessionStorage.removeItem(PENDING_PROMPT_KEY);
    } catch {
      // ignore
    }
  }, []);

  const clearPendingPrompt = useCallback(() => {
    setPendingPrompt('');
  }, [setPendingPrompt]);

  const navigate = useCallback((to: string) => {
    if (typeof window !== 'undefined') {
      if (window.location.pathname !== to) {
        window.history.pushState({}, '', to);
      }
      setRoute(to);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const refreshAuth = useCallback(async (): Promise<AuthMeResponse | null> => {
    try {
      const data = await apiRequest<AuthMeResponse>('/api/auth/me');
      setUser(data.user);
      setWallet(data.wallet);
      setOnboarding(data.onboarding);
      setPlan(data.plan);
      setGithubStatus(data.github);
      if (data.user.preferredTheme === 'dark' || data.user.preferredTheme === 'light') {
        applyThemeDom(data.user.preferredTheme);
      }
      return data;
    } catch {
      setUser(null);
      setWallet(null);
      setOnboarding(null);
      setPlan(null);
      setGithubStatus({ connected: false });
      return null;
    } finally {
      setAuthLoading(false);
    }
  }, [applyThemeDom]);

  useEffect(() => {
    if (getStoredSessionToken()) {
      void refreshAuth();
    } else {
      void refreshAuth();
    }
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setStoredSessionToken(null);
    setUser(null);
    setWallet(null);
    setOnboarding(null);
    setPlan(null);
    setGithubStatus({ connected: false });
    navigate('/');
  }, [navigate]);

  return (
    <AppContext.Provider
      value={{
        route,
        navigate,
        theme,
        setTheme,
        soundMuted,
        toggleSound,
        user,
        wallet,
        onboarding,
        plan,
        githubStatus,
        authLoading,
        refreshAuth,
        logout,
        pendingPrompt,
        setPendingPrompt,
        clearPendingPrompt,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
