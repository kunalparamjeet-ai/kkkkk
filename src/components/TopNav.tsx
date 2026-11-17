import React from 'react';
import { useApp } from '../contexts/AppContext.tsx';
import { VektorBrandMark } from './VektorIcons.tsx';

export function TopNav() {
  const { user, route, navigate } = useApp();

  const handleAnchor = (e: React.MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    e.preventDefault();
    if (route !== '/') {
      navigate('/');
      setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } else {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-zinc-950 dark:text-zinc-50 whitespace-nowrap shrink-0"
        >
          <VektorBrandMark className="w-7 h-7 shrink-0" />
          <span className="font-display">VEKTOR AI</span>
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          <a
            href="#about"
            onClick={(e) => handleAnchor(e, 'about')}
            className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            About
          </a>
          <a
            href="#features"
            onClick={(e) => handleAnchor(e, 'features')}
            className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Features
          </a>
          <a
            href="#showcase"
            onClick={(e) => handleAnchor(e, 'showcase')}
            className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Showcase
          </a>
          <a
            href="#pricing"
            onClick={(e) => handleAnchor(e, 'pricing')}
            className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Pricing
          </a>
          <a
            href="/api-gateway"
            onClick={(e) => {
              e.preventDefault();
              navigate('/api-gateway');
            }}
            className="hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            API Docs
          </a>
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={() => navigate(user ? '/workspace' : '/auth')}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {user ? 'Open Workspace' : 'Sign In'}
          </button>
        </div>
      </div>
    </header>
  );
}
