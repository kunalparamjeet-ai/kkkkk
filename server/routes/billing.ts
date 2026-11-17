import { Router } from 'express';
import { getDb, mutateDb, applyWalletCredit, getOrCreateWallet } from '../db/store.ts';
import { generateId, verifyHmacSha256Hex } from '../lib/crypto.ts';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.ts';

const router = Router();

const TOPUP_PACKS = [
  { id: 'pack_1000', name: '1,000 Credits', credits: 1000, priceUsd: 10, priceInr: 849 },
  { id: 'pack_5000', name: '5,000 Credits', credits: 5000, priceUsd: 45, priceInr: 3799 },
  { id: 'pack_20000', name: '20,000 Credits', credits: 20000, priceUsd: 160, priceInr: 13499 },
];

router.get('/plans', (_req, res) => {
  const db = getDb();
  const plans = db.plans
    .filter((p) => p.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  res.json({
    plans,
    topupPacks: TOPUP_PACKS,
    gateways: {
      razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  });
});

router.get('/wallet', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const wallet = getOrCreateWallet(user.id);
  const db = getDb();
  const transactions = db.creditTransactions.filter((t) => t.userId === user.id).slice(0, 100);
  const subscriptions = db.subscriptions.filter((s) => s.userId === user.id);
  const payments = db.payments.filter((p) => p.userId === user.id);
  const invoices = db.invoices.filter((i) => i.userId === user.id);

  res.json({
    wallet,
    transactions,
    subscriptions,
    payments,
    invoices,
  });
});

router.patch('/wallet/preferences', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { lowCreditThreshold } = req.body || {};
  if (typeof lowCreditThreshold !== 'number' || !Number.isFinite(lowCreditThreshold) || lowCreditThreshold < 0) {
    res.status(400).json({ error: 'Valid lowCreditThreshold (>= 0) is required.' });
    return;
  }
  getOrCreateWallet(user.id);
  const wallet = mutateDb((db) => {
    const w = db.wallets.find((x) => x.userId === user.id);
    if (w) {
      w.lowCreditThreshold = Math.min(1000000, Math.trunc(lowCreditThreshold));
      w.updatedAt = new Date().toISOString();
    }
    return w;
  });
  res.json({ wallet });
});

// Create payment order (Razorpay or Stripe) — never marks unverified payment as successful
router.post('/checkout', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { kind, planId, packId, provider, billingCycle } = req.body || {};

  if (provider !== 'razorpay' && provider !== 'stripe') {
    res.status(400).json({ error: 'Provider must be "razorpay" or "stripe".' });
    return;
  }

  const db = getDb();
  let amountUsd = 0;
  let amountInr = 0;
  let creditsGranted = 0;
  let resolvedPlanId: string | null = null;
  let description = '';

  if (kind === 'subscription') {
    const plan = db.plans.find((p) => p.id === planId && p.active);
    if (!plan) {
      res.status(404).json({ error: 'Plan not found.' });
      return;
    }
    resolvedPlanId = plan.id;
    const isAnnual = billingCycle === 'annual';
    amountUsd = isAnnual ? plan.annualPriceUsd * 12 : plan.monthlyPriceUsd;
    amountInr = isAnnual ? Math.round(plan.monthlyPriceInr * 10) : plan.monthlyPriceInr;
    creditsGranted = plan.monthlyCredits;
    description = `VEKTOR AI ${plan.name} Plan (${isAnnual ? 'Annual' : 'Monthly'})`;

    if (amountUsd === 0) {
      // Free plan switch requires no payment gateway
      const now = new Date().toISOString();
      mutateDb((state) => {
        for (const s of state.subscriptions) {
          if (s.userId === user.id && s.status === 'active') s.status = 'canceled';
        }
        state.subscriptions.push({
          id: generateId('sub'),
          userId: user.id,
          planId: plan.id,
          status: 'active',
          billingCycle: 'monthly',
          provider: 'internal',
          externalSubscriptionId: null,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
          createdAt: now,
        });
      });
      res.json({ activatedFreePlan: true });
      return;
    }
  } else if (kind === 'credit_topup') {
    const pack = TOPUP_PACKS.find((p) => p.id === packId);
    if (!pack) {
      res.status(404).json({ error: 'Credit pack not found.' });
      return;
    }
    amountUsd = pack.priceUsd;
    amountInr = pack.priceInr;
    creditsGranted = pack.credits;
    description = `VEKTOR AI ${pack.name}`;
  } else {
    res.status(400).json({ error: 'Invalid checkout kind.' });
    return;
  }

  const paymentId = generateId('pay');
  const now = new Date().toISOString();

  if (provider === 'razorpay') {
    const rzpKey = process.env.RAZORPAY_KEY_ID;
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzpKey || !rzpSecret) {
      res.status(503).json({
        error: 'Razorpay is not configured on the server (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).',
      });
      return;
    }

    const authHeader = `Basic ${Buffer.from(`${rzpKey}:${rzpSecret}`).toString('base64')}`;
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountInr * 100, // paise
        currency: 'INR',
        receipt: paymentId,
        notes: { userId: user.id, kind, planId: resolvedPlanId || '', credits: String(creditsGranted) },
      }),
    });

    const orderData = (await orderRes.json()) as { id?: string; error?: { description?: string } };
    if (!orderRes.ok || !orderData.id) {
      res.status(502).json({ error: orderData.error?.description || 'Failed to create Razorpay order.' });
      return;
    }

    mutateDb((state) => {
      state.payments.unshift({
        id: paymentId,
        userId: user.id,
        provider: 'razorpay',
        providerOrderId: orderData.id!,
        providerPaymentId: null,
        kind,
        planId: resolvedPlanId,
        creditsGranted,
        amount: amountInr,
        currency: 'INR',
        status: 'created',
        verifiedAt: null,
        createdAt: now,
      });
    });

    res.json({
      provider: 'razorpay',
      paymentId,
      orderId: orderData.id,
      amount: amountInr * 100,
      currency: 'INR',
      keyId: rzpKey,
      description,
    });
    return;
  }

  // Stripe Checkout Session
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.status(503).json({
      error: 'Stripe is not configured on the server (missing STRIPE_SECRET_KEY).',
    });
    return;
  }
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${appUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/billing?canceled=true`,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(Math.round(amountUsd * 100)),
    'line_items[0][price_data][product_data][name]': description,
    'line_items[0][quantity]': '1',
    'metadata[paymentId]': paymentId,
    'metadata[userId]': user.id,
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const stripeData = (await stripeRes.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!stripeRes.ok || !stripeData.id) {
    res.status(502).json({ error: stripeData.error?.message || 'Failed to create Stripe Checkout session.' });
    return;
  }

  mutateDb((state) => {
    state.payments.unshift({
      id: paymentId,
      userId: user.id,
      provider: 'stripe',
      providerOrderId: stripeData.id!,
      providerPaymentId: null,
      kind,
      planId: resolvedPlanId,
      creditsGranted,
      amount: amountUsd,
      currency: 'USD',
      status: 'created',
      verifiedAt: null,
      createdAt: now,
    });
  });

  res.json({
    provider: 'stripe',
    paymentId,
    checkoutUrl: stripeData.url,
    sessionId: stripeData.id,
  });
});

function finalizeVerifiedPayment(params: {
  paymentId: string;
  providerPaymentId: string;
}): { ok: boolean; duplicate?: boolean; error?: string } {
  const db = getDb();
  const payment = db.payments.find((p) => p.id === params.paymentId);
  if (!payment) return { ok: false, error: 'Payment record not found.' };
  if (payment.status === 'verified') return { ok: true, duplicate: true };

  // Prevent duplicate payment credit via providerPaymentId uniqueness
  const duplicateProviderPay = db.payments.find(
    (p) => p.providerPaymentId === params.providerPaymentId && p.status === 'verified'
  );
  if (duplicateProviderPay) return { ok: true, duplicate: true };

  const now = new Date().toISOString();

  mutateDb((state) => {
    const p = state.payments.find((x) => x.id === payment.id);
    if (!p) return;
    p.status = 'verified';
    p.providerPaymentId = params.providerPaymentId;
    p.verifiedAt = now;

    if (p.kind === 'subscription' && p.planId) {
      for (const s of state.subscriptions) {
        if (s.userId === p.userId && s.status === 'active') s.status = 'canceled';
      }
      state.subscriptions.push({
        id: generateId('sub'),
        userId: p.userId,
        planId: p.planId,
        status: 'active',
        billingCycle: 'monthly',
        provider: p.provider,
        externalSubscriptionId: params.providerPaymentId,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: now,
      });
    }

    state.invoices.unshift({
      id: generateId('inv'),
      paymentId: p.id,
      userId: p.userId,
      invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
      amount: p.amount,
      currency: p.currency,
      status: 'paid',
      issuedAt: now,
    });
  });

  if (payment.creditsGranted > 0) {
    applyWalletCredit({
      userId: payment.userId,
      amount: payment.creditsGranted,
      type: 'topup',
      idempotencyKey: `payment:${payment.id}:credit`,
      referenceId: payment.id,
      description: `Verified ${payment.provider} payment (${payment.creditsGranted} credits)`,
      metadata: { providerPaymentId: params.providerPaymentId },
    });
  }

  return { ok: true };
}

router.post('/razorpay/verify', requireAuth, (req: AuthenticatedRequest, res) => {
  const { paymentId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Razorpay verification secret not configured.' });
    return;
  }
  if (
    typeof paymentId !== 'string' ||
    typeof razorpay_order_id !== 'string' ||
    typeof razorpay_payment_id !== 'string' ||
    typeof razorpay_signature !== 'string'
  ) {
    res.status(400).json({ error: 'Missing Razorpay verification parameters.' });
    return;
  }

  const valid = verifyHmacSha256Hex(
    `${razorpay_order_id}|${razorpay_payment_id}`,
    razorpay_signature,
    secret
  );
  if (!valid) {
    mutateDb((db) => {
      const p = db.payments.find((x) => x.id === paymentId);
      if (p) p.status = 'failed';
    });
    res.status(400).json({ error: 'Invalid Razorpay payment signature.' });
    return;
  }

  const result = finalizeVerifiedPayment({ paymentId, providerPaymentId: razorpay_payment_id });
  if (!result.ok) {
    res.status(404).json({ error: result.error });
    return;
  }
  res.json({ ok: true, duplicate: Boolean(result.duplicate), wallet: getOrCreateWallet(req.user!.id) });
});

router.post('/webhooks/razorpay', (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const sig = String(req.headers['x-razorpay-signature'] || '');
  if (!secret || !sig) {
    res.status(400).json({ error: 'Missing webhook signature or secret.' });
    return;
  }
  const rawBody = JSON.stringify(req.body);
  if (!verifyHmacSha256Hex(rawBody, sig, secret)) {
    res.status(401).json({ error: 'Invalid webhook signature.' });
    return;
  }

  const event = req.body?.event;
  if (event === 'payment.captured') {
    const entity = req.body?.payload?.payment?.entity;
    const orderId = entity?.order_id;
    const providerPayId = entity?.id;
    const payment = getDb().payments.find((p) => p.providerOrderId === orderId);
    if (payment && providerPayId) {
      finalizeVerifiedPayment({ paymentId: payment.id, providerPaymentId: providerPayId });
    }
  }
  res.json({ received: true });
});

router.post('/webhooks/stripe', (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sigHeader = String(req.headers['stripe-signature'] || '');
  if (!secret || !sigHeader) {
    res.status(400).json({ error: 'Missing Stripe webhook signature or secret.' });
    return;
  }
  // Parse Stripe t=...,v1=... signature
  const parts = Object.fromEntries(sigHeader.split(',').map((kv) => kv.split('=')));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) {
    res.status(400).json({ error: 'Malformed Stripe signature.' });
    return;
  }
  const signedPayload = `${timestamp}.${JSON.stringify(req.body)}`;
  if (!verifyHmacSha256Hex(signedPayload, v1, secret)) {
    res.status(401).json({ error: 'Invalid Stripe webhook signature.' });
    return;
  }

  if (req.body?.type === 'checkout.session.completed') {
    const sessionObj = req.body?.data?.object;
    const paymentId = sessionObj?.metadata?.paymentId;
    const paymentIntent = sessionObj?.payment_intent || sessionObj?.id;
    if (paymentId && paymentIntent) {
      finalizeVerifiedPayment({ paymentId, providerPaymentId: String(paymentIntent) });
    }
  }
  res.json({ received: true });
});

export default router;
