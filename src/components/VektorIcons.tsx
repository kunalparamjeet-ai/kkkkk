import React from 'react';

export function VektorBrandMark({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="2"
        width="32"
        height="32"
        rx="8"
        className="fill-zinc-950 dark:fill-zinc-100"
      />
      <path
        d="M10.5 11.5L18 25.5L25.5 11.5"
        className="stroke-white dark:stroke-zinc-950"
        strokeWidth="2.8"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M14.5 11.5L18 18L21.5 11.5"
        stroke="#3B82F6"
        strokeWidth="2.2"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function VektorNodeIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <polygon
        points="12,2 21,7 21,17 12,22 3,17 3,7"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M8.5 9.5L12 16L15.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
    </svg>
  );
}

export function VektorLayersIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3L21 8L12 13L3 8L12 3Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 12.5L12 17.5L21 12.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 16.5L12 21.5L21 16.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function VektorGatewayIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="14" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10 7.5H17.5V13" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.5 11V16.5H14" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function GitHubOfficialIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

export function GoogleOfficialIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
      <path fill="#34A853" d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.09.73-2.49 1.16-4.22 1.16-3.24 0-5.98-2.19-6.96-5.13H1.04v3.14C3.05 21.15 7.21 24 12 24z" />
      <path fill="#FBBC05" d="M5.04 14.02c-.25-.73-.39-1.52-.39-2.32s.14-1.59.39-2.32V6.24H1.04C.38 7.56 0 9.05 0 11.7s.38 4.14 1.04 5.46l4-3.14z" />
      <path fill="#EA4335" d="M12 4.75c1.79 0 3.4.62 4.67 1.83l3.5-3.5C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.85 1.04 6.86l4 3.14c.98-2.94 3.72-5.25 6.96-5.25z" />
    </svg>
  );
}

export function SubtleVectorFieldBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden -z-10"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <svg
        className="animate-vektor-orbit absolute -top-24 -right-24 w-[480px] h-[480px] text-blue-600/10 dark:text-blue-500/10"
        viewBox="0 0 400 400"
        fill="none"
      >
        <circle cx="200" cy="200" r="150" stroke="currentColor" strokeWidth="1" strokeDasharray="6 10" />
        <polygon points="200,36 342,118 342,282 200,364 58,282 58,118" stroke="currentColor" strokeWidth="1" />
      </svg>
      <svg
        className="animate-vektor-drift absolute -bottom-32 -left-24 w-[420px] h-[420px] text-zinc-500/10 dark:text-zinc-400/10"
        viewBox="0 0 400 400"
        fill="none"
      >
        <rect x="70" y="70" width="260" height="260" rx="24" stroke="currentColor" strokeWidth="1" />
        <circle cx="200" cy="200" r="95" stroke="currentColor" strokeWidth="1" />
      </svg>
    </div>
  );
}
