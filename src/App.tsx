import React from 'react';
import { AppProvider, useApp } from './contexts/AppContext.tsx';
import { LandingPage } from './pages/LandingPage.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { OnboardingPage } from './pages/OnboardingPage.tsx';
import { WorkspacePage } from './pages/WorkspacePage.tsx';
import { BillingPage } from './pages/BillingPage.tsx';
import { ApiGatewayPage } from './pages/ApiGatewayPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';

function AppRouter() {
  const { route, authLoading } = useApp();

  if (authLoading && (route.startsWith('/workspace') || route.startsWith('/admin') || route.startsWith('/onboarding'))) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-500">
        Loading VEKTOR AI...
      </div>
    );
  }

  if (route === '/' || route === '') return <LandingPage />;
  if (route.startsWith('/auth')) return <AuthPage />;
  if (route.startsWith('/onboarding')) return <OnboardingPage />;
  if (route.startsWith('/workspace')) return <WorkspacePage />;
  if (route.startsWith('/billing')) return <BillingPage />;
  if (route.startsWith('/api-gateway') || route.startsWith('/api-docs')) return <ApiGatewayPage />;
  if (route.startsWith('/admin')) return <AdminPage />;

  return <LandingPage />;
}

export default function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
