'use client';

import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

export interface BillingPlan {
  id: string;
  plan_code: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  billing_period: string;
  tier: string;
  is_active: boolean;
  entitlements: string[];
}

export interface StorefrontPolicy {
  platform: string;
  storefront: string;
  supported_billing_methods: string[];
  preferred_method: string;
  external_checkout_permitted: boolean;
  external_checkout_url?: string;
  disclosure_notice: string;
  requires_choice_screen: boolean;
  program_enrollment_status: string;
}

export interface UserSubscription {
  id: string;
  status: string;
  plan_code: string;
  tier: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  provider: string;
}

interface MembershipClientProps {
  userId: string;
  userEmail: string;
}

export function MembershipClient({ userId, userEmail }: MembershipClientProps) {
  const searchParams = useSearchParams();
  const initialPlan = searchParams.get('plan') || '';
  const storefront = searchParams.get('storefront') || 'US';
  const source = searchParams.get('source') || 'web';
  const statusParam = searchParams.get('status');

  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [policy, setPolicy] = useState<StorefrontPolicy | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [selectedPlanCode, setSelectedPlanCode] = useState<string>(initialPlan);
  const [consentChecked, setConsentChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (statusParam === 'success') {
      setStatusMessage({
        type: 'info',
        text: 'Stripe checkout completed. Membership entitlements update automatically once confirmed by the authoritative backend webhook.',
      });
    } else if (statusParam === 'cancelled') {
      setStatusMessage({
        type: 'info',
        text: 'Checkout session was cancelled. No charges were incurred.',
      });
    }
  }, [statusParam]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [plansRes, policyRes, subRes] = await Promise.allSettled([
          fetch('/api/v1/billing/plans'),
          fetch(`/api/v1/billing/policy?platform=web&storefront=${encodeURIComponent(storefront)}`),
          fetch('/api/v1/billing/subscription'),
        ]);

        if (plansRes.status === 'fulfilled' && plansRes.value.ok) {
          const data = await plansRes.value.json();
          const fetchedPlans: BillingPlan[] = Array.isArray(data.plans) ? data.plans : (Array.isArray(data) ? data : []);
          setPlans(fetchedPlans);
          if (!selectedPlanCode && fetchedPlans.length > 0) {
            // Default select plus monthly if available
            const plus = fetchedPlans.find((p) => p.plan_code.includes('PLUS_MONTHLY')) || fetchedPlans[0];
            setSelectedPlanCode(plus.plan_code);
          }
        }

        if (policyRes.status === 'fulfilled' && policyRes.value.ok) {
          const data = await policyRes.value.json();
          setPolicy(data);
        }

        if (subRes.status === 'fulfilled' && subRes.value.ok) {
          const data = await subRes.value.json();
          if (data.subscription) {
            setSubscription(data.subscription);
          }
        }
      } catch (err) {
        setStatusMessage({ type: 'error', text: 'Failed to load billing information.' });
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [storefront, selectedPlanCode]);

  const handleCancelRenewal = async () => {
    if (!confirm('Are you sure you want to cancel automatic renewal? Your benefits will stay active until the end of your billing cycle.')) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/v1/billing/subscription/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (res.ok) {
          setStatusMessage({
            type: 'success',
            text: 'Automatic renewal has been cancelled. Your membership remains active until the end of your current period.',
          });
          setSubscription((prev) => (prev ? { ...prev, cancel_at_period_end: true } : null));
        } else {
          const errData = await res.json().catch(() => ({}));
          setStatusMessage({
            type: 'error',
            text: errData.message || 'Failed to cancel subscription renewal.',
          });
        }
      } catch {
        setStatusMessage({ type: 'error', text: 'Network error while attempting cancellation.' });
      }
    });
  };

  const handleCheckout = async () => {
    if (!consentChecked) {
      setStatusMessage({ type: 'error', text: 'You must review and agree to the auto-renewal terms to proceed.' });
      return;
    }

    const plan = plans.find((p) => p.plan_code === selectedPlanCode);
    if (!plan) {
      setStatusMessage({ type: 'error', text: 'Please select a valid membership plan.' });
      return;
    }

    startTransition(async () => {
      try {
        const origin = window.location.origin;
        const res = await fetch('/api/v1/billing/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_code: plan.plan_code,
            provider: 'STRIPE',
            success_url: `${origin}/membership?status=success`,
            cancel_url: `${origin}/membership?status=cancelled`,
            terms_accepted: true,
            terms_version: '2026-10-v1',
            storefront,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.checkout_url) {
          window.location.href = data.checkout_url;
        } else if (
          res.status === 503 ||
          res.status === 501 ||
          data.error?.code === 'PROVIDER_NOT_CONFIGURED' ||
          (data.error?.message && data.error.message.includes('BLOCKED')) ||
          (data.message && data.message.includes('BLOCKED'))
        ) {
          setStatusMessage({
            type: 'info',
            text: 'Configuration Notice: Stripe test/live API credentials are not yet configured on this environment (STRIPE_SECRET_KEY). Checkout fails closed to protect against unverified transactions.',
          });
        } else {
          setStatusMessage({
            type: 'error',
            text: data.error?.message || data.message || 'Checkout session could not be created at this time.',
          });
        }
      } catch {
        setStatusMessage({ type: 'error', text: 'Network communication failure during checkout initiation.' });
      }
    });
  };

  const selectedPlan = plans.find((p) => p.plan_code === selectedPlanCode);

  return (
    <div style={{ maxWidth: '900px', margin: '3rem auto', padding: '0 1.5rem' }}>
      <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
        <span className="badge-gold" style={{ display: 'inline-block', marginBottom: '0.75rem' }}>
          ✦ Aura Membership Management
        </span>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '2.5rem', marginBottom: '0.75rem' }}>
          Your Membership &amp; Subscriptions
        </h1>
        <p style={{ color: 'var(--aura-taupe)', maxWidth: '600px', margin: '0 auto' }}>
          Transparent recurring membership for intentional dating. Review active entitlements, modify billing, or cancel anytime.
        </p>
      </div>

      {source === 'android_ucb' && (
        <div style={{ padding: '1rem', background: 'rgba(195,161,91,0.1)', border: '1px solid var(--aura-gold)', borderRadius: '8px', marginBottom: '2rem' }}>
          <strong>Mobile App Linkout:</strong> You were directed here via Google Play User Choice Billing. Completing checkout here activates your membership directly across all devices.
        </div>
      )}

      {source === 'ios_link' && (
        <div style={{ padding: '1rem', background: 'rgba(195,161,91,0.1)', border: '1px solid var(--aura-gold)', borderRadius: '8px', marginBottom: '2rem' }}>
          <strong>StoreKit External Linkout:</strong> You were directed here via Aura&apos;s StoreKit External Purchase Link. Subscriptions purchased here sync immediately to your iOS app.
        </div>
      )}

      {statusMessage && (
        <div
          style={{
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '2rem',
            background: statusMessage.type === 'error' ? 'rgba(112,47,54,0.3)' : statusMessage.type === 'success' ? 'rgba(46,125,50,0.2)' : 'rgba(195,161,91,0.2)',
            border: `1px solid ${statusMessage.type === 'error' ? 'var(--aura-oxblood)' : statusMessage.type === 'success' ? '#2e7d32' : 'var(--aura-gold)'}`,
            color: 'var(--aura-ivory)',
          }}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Current Subscription Section */}
      {subscription && subscription.status === 'ACTIVE' && (
        <section
          style={{
            background: 'var(--aura-charcoal)',
            border: '1px solid var(--aura-gold)',
            borderRadius: '12px',
            padding: '1.75rem',
            marginBottom: '2.5rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.85rem', color: 'var(--aura-gold)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Active Plan
              </span>
              <h2 style={{ fontSize: '1.75rem', margin: '0.25rem 0' }}>{subscription.tier} Tier</h2>
              <p style={{ color: 'var(--aura-taupe)', fontSize: '0.95rem' }}>
                Billed via {subscription.provider} &bull; Next renewal date:{' '}
                {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            </div>
            <span
              style={{
                background: subscription.cancel_at_period_end ? 'var(--aura-oxblood)' : 'var(--aura-gold)',
                color: 'var(--aura-black)',
                padding: '0.35rem 0.85rem',
                borderRadius: '999px',
                fontWeight: 600,
                fontSize: '0.85rem',
              }}
            >
              {subscription.cancel_at_period_end ? 'Cancels at Period End' : 'Auto-Renew Active'}
            </span>
          </div>

          {!subscription.cancel_at_period_end && (
            <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
              <button
                type="button"
                onClick={handleCancelRenewal}
                disabled={isPending}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--aura-oxblood)',
                  color: 'var(--aura-parchment)',
                  padding: '0.65rem 1.25rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {isPending ? 'Processing...' : 'Cancel Subscription Renewal'}
              </button>
              <p style={{ color: 'var(--aura-taupe)', fontSize: '0.82rem', marginTop: '0.5rem' }}>
                Clicking cancel stops upcoming recurring charges. You will continue to enjoy full membership features until {new Date(subscription.current_period_end).toLocaleDateString()}.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Available Plans Catalog */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.75rem', marginBottom: '1.25rem' }}>
          Select a Membership Tier
        </h2>

        {loading ? (
          <p style={{ color: 'var(--aura-taupe)' }}>Loading published membership plans...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
            {plans
              .filter((p) => p.is_active && p.price_cents > 0)
              .map((plan) => {
                const isSelected = selectedPlanCode === plan.plan_code;
                const formattedPrice = (plan.price_cents / 100).toFixed(2);
                return (
                  <div
                    key={plan.id}
                    onClick={() => setSelectedPlanCode(plan.plan_code)}
                    style={{
                      background: 'var(--aura-charcoal)',
                      border: isSelected ? '2px solid var(--aura-gold)' : '1px solid var(--border-subtle)',
                      borderRadius: '12px',
                      padding: '1.5rem',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      position: 'relative',
                      boxShadow: isSelected ? '0 0 15px rgba(195,161,91,0.2)' : 'none',
                    }}
                  >
                    {isSelected && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '1rem',
                          right: '1rem',
                          background: 'var(--aura-gold)',
                          color: 'var(--aura-black)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                        }}
                      >
                        Selected
                      </span>
                    )}
                    <h3 style={{ fontSize: '1.35rem', marginBottom: '0.35rem' }}>{plan.name}</h3>
                    <p style={{ color: 'var(--aura-taupe)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                      {plan.description}
                    </p>
                    <div style={{ fontSize: '1.85rem', fontWeight: 700, color: 'var(--aura-gold)', marginBottom: '1.25rem' }}>
                      ${formattedPrice}
                      <span style={{ fontSize: '0.9rem', color: 'var(--aura-taupe)', fontWeight: 400 }}>
                        {' '}/ {plan.billing_period.toLowerCase()}
                      </span>
                    </div>

                    <ul style={{ listStyle: 'none', color: 'var(--aura-parchment)', fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: 'auto' }}>
                      {plan.entitlements.map((code) => (
                        <li key={code}>✓ {code.replace(/_/g, ' ')}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* Checkout Policy & Consent Box */}
      {selectedPlan && (
        <section
          style={{
            background: 'var(--aura-charcoal-deep)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '1.75rem',
            marginBottom: '2rem',
          }}
        >
          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem', color: 'var(--aura-gold)' }}>
            Checkout Confirmation: {selectedPlan.name}
          </h3>
          <p style={{ color: 'var(--aura-parchment)', fontSize: '0.92rem', marginBottom: '1.25rem' }}>
            Billed at ${(selectedPlan.price_cents / 100).toFixed(2)} {selectedPlan.currency} per {selectedPlan.billing_period.toLowerCase()}.
          </p>

          {policy && policy.disclosure_notice && (
            <p style={{ color: 'var(--aura-taupe)', fontSize: '0.85rem', marginBottom: '1.25rem', borderLeft: '3px solid var(--aura-gold)', paddingLeft: '0.75rem' }}>
              {policy.disclosure_notice}
            </p>
          )}

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
              cursor: 'pointer',
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
              color: 'var(--aura-parchment)',
            }}
          >
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              style={{ marginTop: '0.2rem', accentColor: 'var(--aura-gold)' }}
            />
            <span>
              By subscribing, you authorize Aura to charge your designated payment method ${(selectedPlan.price_cents / 100).toFixed(2)} on a recurring basis every {selectedPlan.billing_period.toLowerCase()} until you cancel. You may cancel at any time via your account settings. You also agree to our <Link href="/legal/terms" style={{ color: 'var(--aura-gold)' }}>Terms of Service</Link> and billing policies.
            </span>
          </label>

          <button
            type="button"
            onClick={handleCheckout}
            disabled={!consentChecked || isPending}
            className="btn-gold"
            style={{
              width: '100%',
              padding: '0.9rem',
              fontSize: '1.05rem',
              fontWeight: 600,
              cursor: (!consentChecked || isPending) ? 'not-allowed' : 'pointer',
              opacity: (!consentChecked || isPending) ? 0.6 : 1,
            }}
          >
            {isPending ? 'Redirecting to Stripe...' : `Subscribe for $${(selectedPlan.price_cents / 100).toFixed(2)} / ${selectedPlan.billing_period.toLowerCase()}`}
          </button>
        </section>
      )}

      {/* Support & Dispute Interception Footer */}
      <div style={{ textAlign: 'center', color: 'var(--aura-taupe)', fontSize: '0.85rem' }}>
        Questions or need billing assistance? Contact our team at{' '}
        <a href="mailto:billing@auradating.com" style={{ color: 'var(--aura-gold)' }}>
          billing@auradating.com
        </a>
      </div>
    </div>
  );
}
