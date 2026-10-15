# Aura Platform — Subscriptions, Billing, Boosts & Refunds Specification (`BILLING_SPEC.md`)

**Providers**: Stripe Billing (Web), Apple App Store Server API v2 (iOS), Google Play Billing v7 (Android)

---

## 1. Product Catalog & Entitlement Matrix

| Tier / SKU | Billing Cadence | Base Price (USD) | Included Entitlements |
| :--- | :--- | :--- | :--- |
| **`AURA_FREE`** | Free | `$0.00` | 20 Likes/day, basic gender/age/distance filters, standard matching & messaging. |
| **`AURA_PLUS_MONTHLY`** | Monthly Recurring | `$19.99 / mo` | Unlimited Likes, See Who Liked You, 5 Rewinds/day, Discrete App Icon, Advanced Relationship-Intent Filters. |
| **`AURA_PLUS_ANNUAL`** | Annual Recurring | `$119.88 / yr` | All `Aura Plus` benefits at 50% annual savings. |
| **`AURA_BLACK_MONTHLY`** | Monthly Recurring | `$34.99 / mo` | All `Aura Plus` benefits + Incognito Mode, Global Passport, Priority Likes, Read Receipts, 1 Free Boost/month, 5 Super Sparks/week. |
| **`AURA_BLACK_ANNUAL`** | Annual Recurring | `$209.88 / yr` | All `Aura Black` benefits at 50% annual savings. |
| **`BOOST_SINGLE` / `BOOST_5PACK`** | Consumable One-Time | `$4.99` / `$17.99` | 30-minute `3.0x` discovery ranking multiplier. |
| **`SUPERSPARK_5PACK`** | Consumable One-Time | `$9.99` | 5 priority intro-message Super Sparks. |

---

## 2. Subscription Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> TRIALING : Free Trial Started
    [*] --> ACTIVE : Initial Payment Succeeded
    TRIALING --> ACTIVE : Trial Converted (Renewal Charged)
    TRIALING --> CANCELED : User Canceled During Trial
    ACTIVE --> ACTIVE : Renewal Payment Succeeded
    ACTIVE --> PAST_DUE : Renewal Payment Failed (Retry Scheduled)
    PAST_DUE --> GRACE_PERIOD : In-App Billing Grace Period (7d)
    PAST_DUE --> ACTIVE : Payment Recovered
    GRACE_PERIOD --> ACTIVE : Payment Recovered
    GRACE_PERIOD --> EXPIRED : Grace Period Exhausted
    ACTIVE --> CANCELED : Auto-Renew Disabled (Active until Period End)
    CANCELED --> EXPIRED : Current Period Ended
    ACTIVE --> REFUNDED : Full Refund Issued
    ACTIVE --> CHARGEBACK : Dispute / Chargeback Lost
    REFUNDED --> [*] : Entitlements Revoked Immediately
    CHARGEBACK --> [*] : Entitlements Revoked & Account Flagged
```

---

## 3. Omni-Channel Payment & Webhook Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as Web / iOS / Android Client
    participant API as Go Billing Service
    participant Provider as Stripe / Apple / Google
    participant DB as PostgreSQL (ACID Tx)
    participant Affiliate as Affiliate Commission Engine

    Client->>Provider: Complete Checkout / StoreKit 2 Purchase
    Provider-->>Client: Payment Receipt / Session ID
    Provider->>API: Webhook (invoice.paid / DID_RENEW / SUBSCRIPTION_PURCHASED)
    API->>API: Verify Cryptographic Signature (HMAC / Apple X.509 / Google OIDC)
    API->>DB: BEGIN TRANSACTION
    API->>DB: INSERT INTO webhook_events (idempotency check)
    API->>DB: UPSERT subscriptions & entitlements (status = 'ACTIVE')
    API->>DB: INSERT INTO payment_transactions (gross, fee, tax, net_amount_cents)
    API->>Affiliate: Evaluate Referral Attribution & Commission Rules
    Affiliate->>DB: Post Balanced Debit/Credit Entries to ledger_entries (status = 'PENDING_CLEARANCE')
    API->>DB: INSERT INTO outbox_events (billing.subscription.activated.v1)
    API->>DB: COMMIT TRANSACTION
    API-->>Provider: 200 OK
```

---

## 4. Refunds, Chargebacks & Net Revenue Calculation

1. **Net Revenue Definition**:
   $$\text{Net Revenue Cents} = \text{Gross Charge Cents} - \text{Sales Tax / VAT Cents} - \text{Payment Processor / App Store Fee Cents}$$
   - Stripe Web default processor fee: $\approx 2.9\% + \$0.30$.
   - Apple App Store / Google Play Small Business Program fee: $15\%$ (or $30\%$ standard rate).
2. **Immediate Revocation on Refund/Chargeback**:
   - Upon receipt of `charge.refunded`, `charge.dispute.created` (Stripe), `REFUND` (Apple), or `SUBSCRIPTION_REVOKED` (Google), the user's `subscriptions.status` transitions to `REFUNDED` or `CHARGEBACK` and paid `entitlements` are revoked immediately.
   - Emits `billing.payment.refunded.v1`, triggering an automatic reversing journal entry in the Affiliate Commission Ledger.
