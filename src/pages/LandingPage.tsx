import React, { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, Send, Check, Moon, Sun } from 'lucide-react';
import { useApp, type ClientPlan } from '../contexts/AppContext.tsx';
import { TopNav } from '../components/TopNav.tsx';
import {
  SubtleVectorFieldBackground,
  VektorGatewayIcon,
  VektorLayersIcon,
  VektorNodeIcon,
} from '../components/VektorIcons.tsx';
import { apiRequest } from '../lib/api.ts';

const PLACEHOLDER_PROMPTS = [
  'Build an inventory management dashboard with low-stock alerts and supplier analytics...',
  'Create a SaaS client portal with project milestones, invoice tracking, and dark mode...',
  'Design an appointment scheduling console for an outpatient medical clinic...',
  'Build a real-time multi-currency treasury monitor with cashflow forecasting...',
];

interface ShowcaseItem {
  id: string;
  name: string;
  description: string;
  liveUrl: string | null;
}

const SHOWCASE_IMAGES: Record<string, string> = {
  prj_showcase_treasury: '/src/assets/images/showcase_fintech_app_1794920885592.jpg',
  prj_showcase_aeterna: '/src/assets/images/showcase_commerce_app_1794920886465.jpg',
  prj_showcase_caregrid: '/src/assets/images/showcase_health_app_1794920886219.jpg',
};

export function LandingPage() {
  const { user, theme, setTheme, navigate, setPendingPrompt } = useApp();
  const [promptInput, setPromptInput] = useState('');
  const [placeholderText, setPlaceholderText] = useState('');
  const [plans, setPlans] = useState<ClientPlan[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiRequest<{ plans: ClientPlan[]; showcase: ShowcaseItem[] }>('/api/public/bootstrap')
      .then((res) => {
        setPlans(res.plans || []);
        setShowcase(res.showcase || []);
      })
      .catch(() => {});
  }, []);

  // Smooth animated placeholder typing effect
  useEffect(() => {
    let phraseIdx = 0;
    let charIdx = 0;
    let deleting = false;
    let timer: number;

    const tick = () => {
      const current = PLACEHOLDER_PROMPTS[phraseIdx];
      if (!deleting) {
        charIdx++;
        setPlaceholderText(current.slice(0, charIdx));
        if (charIdx >= current.length) {
          deleting = true;
          timer = window.setTimeout(tick, 2100);
          return;
        }
        timer = window.setTimeout(tick, 34);
      } else {
        charIdx--;
        setPlaceholderText(current.slice(0, charIdx));
        if (charIdx <= 0) {
          deleting = false;
          phraseIdx = (phraseIdx + 1) % PLACEHOLDER_PROMPTS.length;
          timer = window.setTimeout(tick, 350);
          return;
        }
        timer = window.setTimeout(tick, 18);
      }
    };

    timer = window.setTimeout(tick, 300);
    return () => window.clearTimeout(timer);
  }, []);

  const handleSubmitPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = promptInput.trim();
    if (!cleaned) return;
    setPendingPrompt(cleaned);
    if (!user) {
      navigate('/auth');
    } else if (!user.onboardingCompleted) {
      navigate('/onboarding');
    } else {
      navigate('/workspace');
    }
  };

  return (
    <div className="min-h-screen flex flex-col relative">
      <SubtleVectorFieldBackground />
      <TopNav />

      <main className="flex-1">
        {/* HERO SECTION */}
        <section className="max-w-5xl mx-auto px-6 pt-20 pb-20 md:pt-28 md:pb-24">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 tracking-wide mb-4">
              Central AI Software Orchestrator · Multi-Model Execution
            </p>
            <h1
              className="font-display font-bold tracking-tight text-zinc-950 dark:text-white mb-6"
              style={{ fontSize: 'clamp(2.35rem, 4.4vw, 3.85rem)', lineHeight: 1.08, textWrap: 'balance' }}
            >
              What&apos;s Your Idea? Tell Me, I&apos;ll Build It.
            </h1>
            <p className="text-base md:text-lg text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-2xl mx-auto mb-10">
              VEKTOR AI decomposes your product brief, delegates coding, design, and testing across specialized models, and ships a live hosted application in one workspace.
            </p>
          </div>

          <form
            onSubmit={handleSubmitPrompt}
            className="max-w-3xl mx-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm focus-within:border-blue-600 dark:focus-within:border-blue-500 transition-colors"
          >
            <label htmlFor="landing-prompt" className="sr-only">
              Describe the software you want VEKTOR AI to build
            </label>
            <textarea
              id="landing-prompt"
              rows={4}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitPrompt(e);
                }
              }}
              placeholder={placeholderText || PLACEHOLDER_PROMPTS[0]}
              className="w-full resize-none bg-transparent text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-base leading-relaxed focus:outline-none p-2"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                <span>VEKTOR Orchestrator</span>
                <span aria-hidden="true">·</span>
                <span>Live Preview</span>
                <span aria-hidden="true">·</span>
                <span>One-Click Hosting</span>
              </div>
              <button
                type="submit"
                disabled={!promptInput.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Build Now</span>
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>

          <div className="max-w-3xl mx-auto mt-5 flex flex-wrap items-center justify-center gap-2">
            {[
              'SaaS Analytics Dashboard',
              'Clinical Booking Portal',
              'Minimalist Storefront',
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setPromptInput(`Build a production-grade ${sample.toLowerCase()} with interactive workflows, clean light and dark support, and structured data views.`)}
                className="px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {sample}
              </button>
            ))}
          </div>
        </section>

        {/* ABOUT SECTION */}
        <section id="about" className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 py-20">
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-3">
                About VEKTOR AI
              </p>
              <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-zinc-950 dark:text-white mb-5">
                One senior orchestrator controlling every layer of software delivery.
              </h2>
              <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed mb-6">
                Instead of forcing you to stitch together fragmented chat windows, code editors, hosting dashboards, and billing gateways, VEKTOR AI acts as the central engineering lead. It breaks down requirements, assigns each subtask to the highest-precision model, tracks real latency and token usage, and ships straight to managed hosting or GitHub.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
                <div>
                  <div className="font-mono text-2xl font-bold text-zinc-950 dark:text-white tabular-nums">5+</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Configurable model adapters</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-bold text-zinc-950 dark:text-white tabular-nums">100%</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Checkpoint job recovery</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-bold text-zinc-950 dark:text-white tabular-nums">6</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Transparent credit plans</div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[300px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900">
                {!imageErrors.hero ? (
                  <img
                    src="/src/assets/images/hero_vektor_studio_1794920884438.jpg"
                    alt="VEKTOR AI engineering studio workstation"
                    referrerPolicy="no-referrer"
                    onError={() => setImageErrors((prev) => ({ ...prev, hero: true }))}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-zinc-500">
                    <VektorNodeIcon className="w-10 h-10 mb-3" />
                    <span className="text-sm font-medium">VEKTOR Engineering Workspace</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* FEATURES SECTION */}
        <section id="features" className="py-20 max-w-7xl mx-auto px-6">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-3">
              Platform Capabilities
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-zinc-950 dark:text-white">
              Built for production shipping, not disposable prototypes.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8">
              <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 mb-4">
                <VektorNodeIcon className="w-6 h-6" />
                <span className="text-sm font-semibold text-zinc-950 dark:text-white">
                  01. Central Senior Orchestration & Multi-Model Delegation
                </span>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed mb-6">
                VEKTOR AI evaluates each prompt, decomposes architecture, UI design, implementation, and verification subtasks, and routes them across VEKTOR Coding Model (including self-hosted open-weight inference servers), Google Gemini, OpenAI, and DeepSeek using configurable admin routing rules.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                <div>
                  <div className="font-semibold text-zinc-950 dark:text-white">VEKTOR Coder</div>
                  <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">Code & edits</div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-950 dark:text-white">Gemini 4</div>
                  <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">App creation & UX</div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-950 dark:text-white">OpenAI GPT-4.1</div>
                  <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">Deep reasoning</div>
                </div>
                <div>
                  <div className="font-semibold text-zinc-950 dark:text-white">DeepSeek</div>
                  <div className="text-zinc-500 dark:text-zinc-400 mt-0.5">Technical QA</div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8">
              <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 mb-4">
                <VektorGatewayIcon className="w-6 h-6" />
                <span className="text-sm font-semibold text-zinc-950 dark:text-white">
                  02. VEKTOR API Gateway
                </span>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                OpenAI-compatible endpoints (<code className="text-xs">/v1/chat/completions</code>, <code className="text-xs">/v1/models</code>) with hashed API keys, key rotation, per-plan rate limits, real-time usage metering, and auto-generated SDK docs.
              </p>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8">
              <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 mb-4">
                <VektorLayersIcon className="w-6 h-6" />
                <span className="text-sm font-semibold text-zinc-950 dark:text-white">
                  03. Split-Screen Workspace
                </span>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                Live SSE job progress, real-time file creation logs, responsive live iframe preview, inline code editor, ZIP download, file uploads, Stop/Resume checkpoints, and immutable Version History undo.
              </p>
            </div>

            <div className="md:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8">
              <div className="flex items-center gap-3 text-blue-600 dark:text-blue-400 mb-4">
                <VektorNodeIcon className="w-6 h-6" />
                <span className="text-sm font-semibold text-zinc-950 dark:text-white">
                  04. GitHub Sync, Managed Hosting & Credit-Safe Checkpoints
                </span>
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                Connect GitHub via server-side OAuth to create repositories and push branches without exposing tokens. Publish directly to VEKTOR Managed Hosting or attach verified custom domains with SSL. Every job tracks actual token cost in PostgreSQL wallets and safely preserves checkpoints if credits run low.
              </p>
            </div>
          </div>
        </section>

        {/* SHOWCASE SECTION */}
        <section id="showcase" className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 py-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
              <div>
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-3">
                  Live Hosted Showcase
                </p>
                <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-zinc-950 dark:text-white">
                  Applications running on VEKTOR Hosting.
                </h2>
              </div>
              <button
                type="button"
                onClick={() => navigate(user ? '/workspace' : '/auth')}
                className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Build your own</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {showcase.map((item) => {
                const imgSrc = SHOWCASE_IMAGES[item.id];
                return (
                  <article
                    key={item.id}
                    className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden flex flex-col"
                  >
                    <div className="aspect-[4/3] bg-zinc-200 dark:bg-zinc-900 overflow-hidden">
                      {imgSrc && !imageErrors[item.id] ? (
                        <img
                          src={imgSrc}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          onError={() => setImageErrors((prev) => ({ ...prev, [item.id]: true }))}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs">
                          {item.name}
                        </div>
                      )}
                    </div>
                    <div className="p-6 flex-1 flex flex-col justify-between">
                      <div>
                        <h3 className="font-display text-lg font-semibold text-zinc-950 dark:text-white mb-2">
                          {item.name}
                        </h3>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4">
                          {item.description}
                        </p>
                      </div>
                      {item.liveUrl && (
                        <a
                          href={item.liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <span>Open Live App</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* PRICING SECTION */}
        <section id="pricing" className="py-20 max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div>
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-3">
                Transparent Plans & Credit Metering
              </p>
              <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-zinc-950 dark:text-white">
                Scale from solo prototypes to enterprise workloads.
              </h2>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg self-start">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  billingCycle === 'monthly'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('annual')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  billingCycle === 'annual'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                Annual (Save 20%)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((p) => {
              const price = billingCycle === 'annual' ? p.annualPriceUsd : p.monthlyPriceUsd;
              return (
                <div
                  key={p.id}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-7 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <h3 className="font-display text-xl font-bold text-zinc-950 dark:text-white">
                        {p.name}
                      </h3>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{p.audience}</span>
                    </div>
                    <div className="mt-4 mb-6 flex items-baseline gap-1.5">
                      <span className="font-mono text-3xl font-bold text-zinc-950 dark:text-white tabular-nums">
                        ${price}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">/ month</span>
                    </div>
                    <ul className="space-y-2.5 mb-8">
                      {p.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2.5 text-sm text-zinc-600 dark:text-zinc-300">
                          <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    type="button"
                    onClick={() => navigate(user ? '/billing' : '/auth')}
                    className="w-full py-2.5 px-4 rounded-lg text-sm font-medium border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    {price === 0 ? 'Start Free' : `Choose ${p.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* QUIET FOOTER */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            © {new Date().getFullYear()} VEKTOR AI. Full-Stack AI Orchestration Platform.
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
            <button type="button" onClick={() => navigate('/workspace')} className="hover:text-zinc-950 dark:hover:text-white cursor-pointer">
              Workspace
            </button>
            <button type="button" onClick={() => navigate('/api-gateway')} className="hover:text-zinc-950 dark:hover:text-white cursor-pointer">
              API Gateway
            </button>
            <button type="button" onClick={() => navigate('/billing')} className="hover:text-zinc-950 dark:hover:text-white cursor-pointer">
              Billing
            </button>
            {user && (user.role === 'admin' || user.role === 'super_admin') && (
              <button type="button" onClick={() => navigate('/admin')} className="hover:text-zinc-950 dark:hover:text-white cursor-pointer">
                Admin Console
              </button>
            )}
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="inline-flex items-center gap-1.5 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
