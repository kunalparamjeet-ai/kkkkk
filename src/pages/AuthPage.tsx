import React, { useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Mail, Lock, User } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiRequest, setStoredSessionToken } from '../lib/api.ts';
import { GoogleOfficialIcon, VektorBrandMark } from '../components/VektorIcons.tsx';

type AuthMode = 'login' | 'register' | 'reset_request' | 'reset_confirm';

export function AuthPage() {
  const { navigate, refreshAuth, pendingPrompt } = useApp();
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'VEKTOR_GOOGLE_AUTH_SUCCESS' && event.data?.token) {
        setStoredSessionToken(event.data.token);
        const me = await refreshAuth();
        if (me?.user && !me.user.onboardingCompleted) {
          navigate('/onboarding');
        } else {
          navigate('/workspace');
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate, refreshAuth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const res = await apiRequest<{ token: string; user: { onboardingCompleted: boolean } }>(
          '/api/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          }
        );
        setStoredSessionToken(res.token);
        const me = await refreshAuth();
        if (me?.user && !me.user.onboardingCompleted) {
          navigate('/onboarding');
        } else {
          navigate('/workspace');
        }
      } else if (mode === 'register') {
        const res = await apiRequest<{ token: string }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, password }),
        });
        setStoredSessionToken(res.token);
        await refreshAuth();
        navigate('/onboarding');
      } else if (mode === 'reset_request') {
        const res = await apiRequest<{ message: string; resetTokenPreview?: string }>(
          '/api/auth/password-reset/request',
          {
            method: 'POST',
            body: JSON.stringify({ email }),
          }
        );
        setNotice(
          res.resetTokenPreview
            ? `${res.message} Dev reset token: ${res.resetTokenPreview}`
            : res.message
        );
        if (res.resetTokenPreview) setResetToken(res.resetTokenPreview);
        setMode('reset_confirm');
      } else if (mode === 'reset_confirm') {
        const res = await apiRequest<{ message: string }>('/api/auth/password-reset/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: resetToken, newPassword: password }),
        });
        setNotice(res.message);
        setMode('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    try {
      const res = await apiRequest<{ url: string }>('/api/auth/google/url');
      const popup = window.open(res.url, 'vektor_google_oauth', 'width=540,height=660');
      if (!popup) {
        setError('Popup blocked. Please allow popups for Google sign-in.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google OAuth is not configured on the server.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-6 py-12 bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to VEKTOR AI</span>
        </button>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8">
          <div className="flex items-center gap-2.5 mb-6">
            <VektorBrandMark className="w-7 h-7" />
            <span className="font-display text-xl font-bold text-zinc-950 dark:text-white">
              VEKTOR AI
            </span>
          </div>

          {pendingPrompt && (
            <div className="mb-6 p-3.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200">
              <div className="font-semibold mb-1">Preserved Idea Ready</div>
              <div className="line-clamp-2 opacity-90">&ldquo;{pendingPrompt}&rdquo;</div>
            </div>
          )}

          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {notice && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 break-all">
              {notice}
            </div>
          )}

          {(mode === 'login' || mode === 'register') && (
            <>
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-medium text-zinc-800 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <GoogleOfficialIcon className="w-4 h-4" />
                <span>Continue with Google</span>
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                <span className="text-xs text-zinc-400">or email</span>
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Mercer"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            {mode !== 'reset_confirm' && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="builder@vektor.ai"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            {mode === 'reset_confirm' && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Reset Token
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="vkr_..."
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            {mode !== 'reset_request' && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {mode === 'reset_confirm' ? 'New Password (min 8 chars)' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-400 absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-white focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign In to VEKTOR AI'
                  : mode === 'register'
                    ? 'Create Account'
                    : mode === 'reset_request'
                      ? 'Request Reset Token'
                      : 'Confirm New Password'}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            {mode === 'login' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('reset_request');
                  setError(null);
                }}
                className="hover:text-zinc-950 dark:hover:text-white cursor-pointer"
              >
                Forgot password?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className="hover:text-zinc-950 dark:hover:text-white cursor-pointer"
              >
                Back to Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
