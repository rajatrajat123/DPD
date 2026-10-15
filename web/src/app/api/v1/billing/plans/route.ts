import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/api/backendProxy';

export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/api/v1/billing/plans', () => {
    return new Response(
      JSON.stringify({
        plans: [
          {
            plan_code: 'AURA_MEMBER',
            name: 'Aura Member',
            price_cents: 0,
            currency: 'USD',
            interval: 'month',
            features: [
              'Authentic verified profile',
              'Intentional matching feed',
              'Direct mutual messaging',
              'Discreet digital mode',
            ],
          },
          {
            plan_code: 'AURA_PLUS',
            name: 'Aura Plus',
            price_cents: 2499,
            currency: 'USD',
            interval: 'month',
            features: [
              'Everything in Member',
              'Unlimited Sparks & Swipes',
              'Advanced Lifestyle Dealbreakers',
              'Passport Mode (Global exploration)',
              '5 Super Sparks weekly',
            ],
          },
          {
            plan_code: 'AURA_ELITE',
            name: 'Aura Elite',
            price_cents: 4999,
            currency: 'USD',
            interval: 'month',
            features: [
              'Everything in Plus',
              'Incognito Browsing (visible only to people you like)',
              '1 Monthly Spotlight Profile Boost',
              'Priority Concierge Support',
              'VIP Private Community Badging',
            ],
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}
