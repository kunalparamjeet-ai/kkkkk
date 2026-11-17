import React, { useState } from 'react';
import { Moon, Sun, Check } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { VektorBrandMark } from '../components/VektorIcons.tsx';

const SOURCES = ['Google', 'Instagram', 'YouTube', 'Facebook', 'X', 'Other'] as const;
const PURPOSES = ['Personal', 'Business', 'Organization', 'Institution', 'Government'] as const;
const SCALES = ['Small', 'Medium', 'Large', 'Enterprise'] as const;

export function OnboardingPage() {
  const { user, theme, setTheme, navigate, refreshAuth, pendingPrompt } = useApp();
  const [preferredTheme, setPreferredTheme] = useState<'light' | 'dark'>(theme);
  const [discoverySource, setDiscoverySource] = useState<(typeof SOURCES)[number]>('Google');
  const [projectPurpose, setProjectPurpose] = useState<(typeof PURPOSES)[number]>('Business');
  const [projectScale, setProjectScale] = useState<(typeof SCALES)[number]>('Medium');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    navigate('/auth');
    return null;
  }

  const handleThemePick = (next: 'light' | 'dark') => {
    setPreferredTheme(next);
    setTheme(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/api/auth/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          preferredTheme,
          discoverySource,
          projectPurpose,
          projectScale,
        }),
      });
      await refreshAuth();
      navigate('/workspace');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save onboarding preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-6 py-12 bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 md:p-10">
        <div className="flex items-center gap-2.5 mb-2">
          <VektorBrandMark className="w-7 h-7" />
          <span className="font-display text-xl font-bold text-zinc-950 dark:text-white">
            VEKTOR AI Setup
          </span>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-8">
          Configure your workspace environment. These answers guide the VEKTOR AI Senior Orchestrator when scaffolding your projects.
        </p>

        {pendingPrompt && (
          <div className="mb-6 p-3.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200">
            Your preserved prompt will launch automatically right after setup.
          </div>
        )}

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* 1. Preferred Theme */}
          <div>
            <label className="block text-sm font-semibold text-zinc-950 dark:text-white mb-3">
              01. Preferred Workspace Theme
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => handleThemePick('light')}
                className={`p-4 rounded-xl border text-left flex items-center justify-between transition-colors cursor-pointer ${
                  preferredTheme === 'light'
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-zinc-950 dark:text-white'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <span className="flex items-center gap-2.5 font-medium text-sm">
                  <Sun className="w-4 h-4" />
                  Light Mode
                </span>
                {preferredTheme === 'light' && <Check className="w-4 h-4 text-blue-600" />}
              </button>
              <button
                type="button"
                onClick={() => handleThemePick('dark')}
                className={`p-4 rounded-xl border text-left flex items-center justify-between transition-colors cursor-pointer ${
                  preferredTheme === 'dark'
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-zinc-950 dark:text-white'
                    : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <span className="flex items-center gap-2.5 font-medium text-sm">
                  <Moon className="w-4 h-4" />
                  Dark Mode
                </span>
                {preferredTheme === 'dark' && <Check className="w-4 h-4 text-blue-500" />}
              </button>
            </div>
          </div>

          {/* 2. Discovery Source */}
          <div>
            <label className="block text-sm font-semibold text-zinc-950 dark:text-white mb-3">
              02. Where did you hear about VEKTOR AI?
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
              {SOURCES.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setDiscoverySource(src)}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    discoverySource === src
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Project Purpose */}
          <div>
            <label className="block text-sm font-semibold text-zinc-950 dark:text-white mb-3">
              03. Primary Project Purpose
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {PURPOSES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProjectPurpose(p)}
                  className={`py-2.5 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    projectPurpose === p
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Project Scale */}
          <div>
            <label className="block text-sm font-semibold text-zinc-950 dark:text-white mb-3">
              04. Target Project Scale
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {SCALES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setProjectScale(s)}
                  className={`py-2.5 px-3 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                    projectScale === s
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving Preferences...' : 'Continue to VEKTOR Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
