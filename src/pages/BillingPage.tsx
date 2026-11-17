import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, CreditCard, Receipt, Wallet } from 'lucide-react';
import { useApp, type ClientPlan } from '../contexts/AppContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { TopNav } from '../components/TopNav.tsx';

interface TopupPack {
  id: string;
  name: string;
  credits: number;
  priceUsd: number;
  priceInr: number;
}

interface TransactionItem {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: string;
  issuedAt: string;
}

export function BillingPage() {
  const { user, plan: activePlan, navigate, refreshAuth } = useApp();
  const [plans, setPlans] = useState<ClientPlan[]>([]);
  const [packs, setPacks] = useState<TopupPack[]>([]);
  const [gateways, setGateways] = useState({ razorpayConfigured: false, stripeConfigured: false });
  const [walletBalance, setWalletBalance] = useState(0);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [provider, setProvider] = useState<'razorpay' | 'stripe'>('razorpay');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const loadBilling = async () => {
    try {
      const pRes = await apiRequest<{
        plans: ClientPlan[];
        topupPacks: TopupPack[];
        gateways: { razorpayConfigured: boolean; stripeConfigured: boolean };
      }>('/api/billing/plans');
      setPlans(pRes.plans);
      setPacks(pRes.topupPacks);
      setGateways(pRes.gateways);

      if (user) {
        const wRes = await apiRequest<{
          wallet: { balanceCredits: number };
          transactions: TransactionItem[];
          invoices: InvoiceItem[];
        }>('/api/billing/wallet');
        setWalletBalance(wRes.wallet.balanceCredits);
        setTransactions(wRes.transactions);
        setInvoices(wRes.invoices);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing details');
    }
  };

  useEffect(() => {
    void loadBilling();
  }, [user]);

  const startCheckout = async (payload: { kind: 'subscription' | 'credit_topup'; planId?: string; packId?: string }) => {
    if (!user) {
      navigate('/auth');
      return;
    }
    setError(null);
    setMessage(null);
    setLoadingId(payload.planId || payload.packId || 'checkout');
    try {
      const res = await apiRequest<{
        activatedFreePlan?: boolean;
        provider?: string;
        checkoutUrl?: string;
        orderId?: string;
        paymentId?: string;
        amount?: number;
        currency?: string;
        keyId?: string;
        description?: string;
      }>('/api/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ ...payload, provider, billingCycle }),
      });

      if (res.activatedFreePlan) {
        setMessage('Switched to Free plan.');
        await refreshAuth();
        await loadBilling();
      } else if (res.provider === 'stripe' && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else if (res.provider === 'razorpay' && res.orderId) {
        setMessage(
          `Razorpay Order ${res.orderId} created (${res.currency} ${((res.amount || 0) / 100).toFixed(2)}). Complete payment verification via Razorpay Checkout or webhook to credit wallet.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout could not be started');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100">
      <TopNav />
      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate(user ? '/workspace' : '/')}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-2 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Billing, Plans &amp; Credit Wallet
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <button
                type="button"
                onClick={() => setProvider('razorpay')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  provider === 'razorpay'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                Razorpay {gateways.razorpayConfigured ? '' : '(Key Required)'}
              </button>
              <button
                type="button"
                onClick={() => setProvider('stripe')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  provider === 'stripe'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm'
                    : 'text-zinc-500'
                }`}
              >
                Stripe {gateways.stripeConfigured ? '' : '(Key Required)'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {message && (
          <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-sm text-emerald-800 dark:text-emerald-200">
            {message}
          </div>
        )}

        {user && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
                <Wallet className="w-4 h-4 text-blue-600" />
                <span>Available Balance</span>
              </div>
              <div className="font-mono text-3xl font-bold tabular-nums">{walletBalance}</div>
              <div className="text-xs text-zinc-500 mt-1">Current Plan: {activePlan?.name || 'Free'}</div>
            </div>

            <div className="md:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 text-sm font-semibold mb-4">
                <CreditCard className="w-4 h-4 text-blue-600" />
                <span>Credit Top-Up Packs</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {packs.map((pack) => (
                  <div
                    key={pack.id}
                    className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-sm">{pack.name}</div>
                      <div className="font-mono text-lg font-bold tabular-nums mt-1">
                        {provider === 'razorpay' ? `₹${pack.priceInr}` : `$${pack.priceUsd}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={loadingId === pack.id}
                      onClick={() => void startCheckout({ kind: 'credit_topup', packId: pack.id })}
                      className="w-full py-2 px-3 rounded-lg bg-zinc-950 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      {loadingId === pack.id ? 'Processing...' : 'Purchase Pack'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* PLANS */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Subscription Plans</h2>
            <div className="inline-flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                  billingCycle === 'monthly' ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('annual')}
                className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                  billingCycle === 'annual' ? 'bg-white dark:bg-zinc-800 shadow-sm' : 'text-zinc-500'
                }`}
              >
                Annual
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {plans.map((p) => {
              const isCurrent = activePlan?.id === p.id;
              const price = billingCycle === 'annual' ? p.annualPriceUsd : p.monthlyPriceUsd;
              return (
                <div
                  key={p.id}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-display text-lg font-bold">{p.name}</h3>
                      <span className="text-xs text-zinc-500">{p.audience}</span>
                    </div>
                    <div className="mt-3 mb-5 font-mono text-2xl font-bold tabular-nums">
                      ${price} <span className="text-xs font-sans font-normal text-zinc-500">/ mo</span>
                    </div>
                    <ul className="space-y-2 mb-6 text-xs text-zinc-600 dark:text-zinc-300">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    disabled={isCurrent || loadingId === p.id}
                    onClick={() => void startCheckout({ kind: 'subscription', planId: p.id })}
                    className={`w-full py-2 px-4 rounded-lg text-xs font-medium cursor-pointer ${
                      isCurrent
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 cursor-default'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {isCurrent ? 'Active Plan' : `Select ${p.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {user && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
              <h3 className="font-display font-semibold text-base mb-4">Credit Ledger</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="pb-2">Description</th>
                      <th className="pb-2 text-right">Amount</th>
                      <th className="pb-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {transactions.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2.5 pr-3">{t.description}</td>
                        <td className={`py-2.5 text-right font-mono tabular-nums ${t.amount >= 0 ? 'text-emerald-600' : 'text-zinc-600 dark:text-zinc-300'}`}>
                          {t.amount >= 0 ? `+${t.amount}` : t.amount}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums">{t.balanceAfter}</td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr><td colSpan={3} className="py-6 text-center text-zinc-500">No credit transactions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Receipt className="w-4 h-4 text-blue-600" />
                <h3 className="font-display font-semibold text-base">Invoices</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2.5 font-mono">{inv.invoiceNumber}</td>
                        <td className="py-2.5">{inv.status}</td>
                        <td className="py-2.5 text-right font-mono tabular-nums">{inv.currency} {inv.amount}</td>
                      </tr>
                    ))}
                    {invoices.length === 0 && (
                      <tr><td colSpan={3} className="py-6 text-center text-zinc-500">No invoices issued yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
