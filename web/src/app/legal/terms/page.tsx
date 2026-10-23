import type { Metadata } from 'next';
import Link from 'next/link';
import { constructMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = constructMetadata({
  title: 'Terms of Service | Community Standards',
  description:
    'Aura Terms of Service: Zero tolerance for harassment, deadnaming, biphobia, transphobia, and catfishing. Our guidelines for safe and authentic connections.',
  path: '/legal/terms',
});

export default function TermsPage() {
  return (
    <article className="section-container" style={{ maxWidth: '800px', margin: '4rem auto' }}>
      <h1>Terms of Service &amp; Community Guidelines</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Last updated: October 2026</p>

      <section style={{ marginBottom: '2rem' }}>
        <h2>1. Affirming Community Standards</h2>
        <p>
          Aura is an inclusive community. Harassment, deadnaming, racism, misogyny, biphobia, transphobia,
          or any form of hate speech results in immediate account termination.
        </p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>2. Authentic Identity &amp; Anti-Catfishing Policy</h2>
        <p>
          Members must represent themselves honestly. The creation of fake profiles, impersonation, or
          bot accounts is strictly forbidden.
        </p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>3. Subscriptions, Automatic Renewal &amp; Cancellation</h2>
        <p>
          <strong>Recurring Billing &amp; Consent:</strong> By purchasing an Aura Plus or Aura Extra Premium subscription, you explicitly authorize Aura to charge your designated payment method on a recurring periodic basis (monthly or annually as selected) at the prevailing stated rate until you cancel. Your explicit consent is captured and stored at checkout.
        </p>
        <p style={{ marginTop: '0.75rem' }}>
          <strong>Self-Service Cancellation (&ldquo;Click to Cancel&rdquo;):</strong> You may cancel your subscription renewal at any time with zero penalty. On the web, cancel directly via the <Link href="/membership" style={{ color: 'var(--aura-gold)' }}>Membership Management Portal</Link>. For purchases made via the Apple App Store or Google Play Store, manage or cancel your subscription through your Apple ID or Google Play account subscription settings. Upon cancellation, your premium entitlements will remain active until the end of your current paid billing period.
        </p>
        <p style={{ marginTop: '0.75rem' }}>
          <strong>Pre-Debit Notifications &amp; E-Mandate Regulations:</strong> For recurring payment mandates subject to Reserve Bank of India (RBI) e-mandate directives or equivalent regional regulations, Aura dispatches an itemized pre-debit notification via email/SMS at least 24 hours prior to every recurring renewal, specifying the debit amount, scheduled date, mandate reference, and a direct opt-out link.
        </p>
        <p style={{ marginTop: '0.75rem' }}>
          <strong>Billing Descriptors &amp; Statements:</strong> Charges on your bank or credit card statements will appear clearly as <code>AURA*DATING</code> or <code>AURA*MEMBERSHIP</code>.
        </p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>4. Statutory Rights, Refunds &amp; Dispute Resolution</h2>
        <p>
          <strong>EU/EEA &amp; UK 14-Day Statutory Right of Withdrawal:</strong> If you reside in the European Union, European Economic Area, or United Kingdom, you have the right to withdraw from this subscription contract within 14 calendar days of your initial purchase without giving any reason, unless you have expressly consented to immediate digital performance and acknowledged the loss of your withdrawal right upon full access to premium features.
        </p>
        <p style={{ marginTop: '0.75rem' }}>
          <strong>Pre-Dispute Support:</strong> If you experience any billing discrepancies, duplicate transactions, or service interruptions, please reach out to our dedicated billing desk at <a href="mailto:billing@auradating.com" style={{ color: 'var(--aura-gold)' }}>billing@auradating.com</a> before filing a chargeback with your financial institution. We are committed to resolving billing disputes within 48 business hours.
        </p>
      </section>
    </article>
  );
}
