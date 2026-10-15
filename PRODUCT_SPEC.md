# Aura LGBTQ+ Dating Platform — Complete Product Specification

**Document Status**: Phase 01 Approved Blueprint  
**Target Platforms**: iOS (SwiftUI), Android (Kotlin / Jetpack Compose), Consumer & Member Web (Next.js 15 App Router), Admin & Affiliate Consoles, Go Backend Services

---

## 1. Product Vision & Commercial Scope

Aura is a full-scale, enterprise-grade global LGBTQ+ dating and community platform engineered for authenticity, physical and digital safety, intersectional inclusivity, and high-performance mobile/web experiences. Unlike thin MVP dating apps, Aura encompasses complete commercial capabilities including multi-platform subscriptions (Stripe, Apple App Store, Google Play), consumable boosts, real-time encrypted messaging, automated media transcoding and safety moderation, and a multi-tier affiliate attribution and commission ledger system.

---

## 2. Core Product Capabilities (15 Functional Domains)

### 2.1 Native iOS & Android Applications
- **Native Clients**: iOS 16+ (SwiftUI) and Android 12+ (Kotlin / Jetpack Compose) communicating over TLS 1.3 REST (`JSON`) and WebSocket (`WSS`) APIs.
- **Discretion & Safety Controls**:
  - **Discrete App Icon Switcher**: Users can disguise the mobile home-screen launcher icon as a neutral utility app (Calculator, Weather, Notes).
  - **Biometric & PIN App Lock**: FaceID / TouchID / Android BiometricPrompt required on app foregrounding.
  - **Travel Advisory & Panic Wipe**: Automatic detection of travel into high-risk jurisdictions with one-tap profile hiding.
- **Offline Resilience**: Local SQLite/Room message cache, optimistic swipe queuing, and background chunked media upload resumption.

### 2.2 Consumer Website & Enterprise SEO Engine
- **Architecture**: Next.js 15 App Router (`web/`), integrated with the existing Phase 00 Enterprise SEO specifications in [`docs/architecture/`](file:///C:/Users/ACER/.gemini/antigravity/scratch/lgbtq-dating-platform/docs/architecture/phase-00-seo-architecture-and-implementation-plan.md).
- **Public Discovery Layer**: High-intent demographic hubs (`/gay-dating`, `/lesbian-dating`, `/bisexual-dating`, `/queer-dating`), curated city guides (`/dating/[country]/[city]`), safety guides (`/safety`), editorial magazine (`/blog`), and conversion landers (`/pricing`, `/features`, `/download`).
- **Privacy Firewall**: Strict separation between crawlable public pages and authenticated `/app/*` routes (`X-Robots-Tag: noindex, nofollow, noarchive`, `Cache-Control: private, no-store`).

### 2.3 Identity, Profiles, LGBTQ+ Identities & Dating Preferences
- **Authentication & Verification**:
  - Argon2id password hashing, OAuth 2.0 / OIDC (Sign in with Apple, Google), Phone SMS/WhatsApp OTP verification with rate-limiting, and mandatory liveness selfie verification.
  - Cryptographic short-lived JWT access tokens (`15m`) + rotating opaque refresh tokens (`30d`) bound to device fingerprints.
- **Expansive LGBTQ+ Identity Taxonomy**:
  - **Gender Identities**: Multi-select taxonomy (Cis Man, Trans Man, Cis Woman, Trans Woman, Non-Binary, Genderfluid, Agender, Two-Spirit, Genderqueer, Custom) with primary visibility buckets.
  - **Sexual Orientations**: Gay, Lesbian, Bisexual, Pansexual, Queer, Asexual, Demisexual, Questioning, Custom.
  - **Pronouns**: `he/him`, `she/her`, `they/them`, `ze/zir`, custom combinations.
  - **Relationship Intents & Structures**: Long-term partner, serious dating, casual dating, queer platonic / community, ethical non-monogamy (ENM), polyamorous, monogamous.
  - **Granular Visibility**: Per-attribute privacy toggles (e.g., hide orientation or trans status from unverified profiles or specific filter groups).

### 2.4 Discovery, Geographic Filtering, Ranking & Matching
- **Geospatial Engine**: PostGIS `GEOGRAPHY(Point, 4326)` spatial indexing with `ST_DWithin` radius queries.
- **Anti-Trilateration Privacy**: Exact GPS coordinates are never transmitted to clients; distances are bucketed and randomized within a $\pm 1.5\text{ km}$ privacy fuzzing ring.
- **Multi-Stage Ranking Pipeline**:
  1. **Hard Eligibility Filter**: Mutual gender/orientation compatibility, age range, distance radius (or Global Passport mode), block/report exclusion, and active account status.
  2. **Compatibility & Quality Scoring**: Weighted composite score of reciprocal preference alignment, profile completeness, photo verification status, recent activity decay, and active Boost multipliers.
  3. **Diversity & Fairness Re-ranking**: Prevents feed monopolization and cold-start starvation for new members.

### 2.5 Swipes, Match Rewards & Entitlement Management
- **Interactions**: `LIKE`, `PASS`, `SUPER_SPARK` (high-priority intro message), and `REWIND` (undo last pass).
- **Mutual Match Engine**: Atomic detection of reciprocal `LIKE` / `SUPER_SPARK` creating an active `Match` record and unlocking a real-time conversation thread.
- **Entitlement & Quota Service**:
  - Free tier: Configurable daily intentional likes (default 20/day), basic filters.
  - Paid tiers (`Aura Plus`, `Aura Black`): Unlimited likes, "See Who Liked You" queue, Rewinds, Incognito mode, Global Passport, advanced relationship-intent filters, and monthly profile boosts.
- **Match Rewards**: Activity and safety milestones (e.g., completing selfie verification, maintaining respectful conversation streaks) grant non-monetary entitlement rewards (bonus Super Sparks or temporary visibility boosts).

### 2.6 Real-Time Chat & Notifications
- **Real-Time Transport**: Persistent WebSocket (`WSS`) gateway backed by Redis Pub/Sub for horizontal fan-out across Go backend nodes.
- **Messaging Capabilities**: Text, voice notes, approved internal media attachments, typing indicators, delivery/read receipts (entitlement-gated), and message reactions.
- **Safety In-Chat**: Pre-send harassment warning classifier, blurred image receiver controls, and one-tap "Unmatch & Report" with immutable transcript snapshot preservation for trust & safety review.
- **Push & Email Notifications**: APNs (iOS), FCM (Android), and transactional email with privacy-safe lock-screen payloads (e.g., *"You have a new notification"* when discrete mode is enabled).

### 2.7 Subscriptions, Billing & Refunds
- **Omni-Channel Billing**:
  - **Web**: Stripe Checkout & Billing Subscriptions (`USD`, `GBP`, `EUR`).
  - **iOS**: Apple App Store StoreKit 2 + App Store Server API v2 notifications.
  - **Android**: Google Play Billing Library v7 + Real-Time Developer Notifications (RTDN).
- **Unified Entitlement State Machine**: Normalizes cross-platform subscription lifecycles (`ACTIVE`, `TRIALING`, `PAST_DUE`, `GRACE_PERIOD`, `CANCELED`, `EXPIRED`, `REFUNDED`, `CHARGEBACK`).
- **Refund & Chargeback Automation**: Immediate entitlement revocation on refund/dispute webhook receipt, coupled with automated affiliate commission clawback.

### 2.8 Profile Boosts & Promotions
- **Consumable Boosts**: 30-minute and 24-hour spotlight multipliers purchased standalone or granted via subscription tier entitlements.
- **Promotional Campaigns**: Coupon codes, seasonal Pride trials, and referral discounts with strict redemption limits and fraud checks.

### 2.9 Affiliate Links & Attribution
- **Partner Ecosystem**: LGBTQ+ creators, community organizations, event promoters, and media publishers receive unique tracking links (`/r/[code]` or `?ref=[code]`).
- **Attribution Window**: Configurable first-touch or last-touch attribution window (default 30 days) persisted via signed first-party attribution tokens and server-side registration binding.
- **Anti-Fraud Rules**: Self-referral blocking, duplicate device/payment fingerprint detection, and bot traffic filtering.

### 2.10 Configurable Commissions & Recurring Commissions
- **Flexible Commission Rules Engine**:
  - Supports **CPA** (fixed bounty per verified paid conversion), **Revenue Share %** (percentage of net subscription revenue after app store / payment processor fees), or **Hybrid** models.
  - Supports **One-Time First Payment** or **Recurring Renewal Commissions** (e.g., 25% rev-share for the first 12 monthly renewals).
  - Tiered partner overrides (Standard, Silver, Gold, Strategic Partner).

### 2.11 Commission Ledger, Reversals & Payouts
- **Immutable Double-Entry Accounting**: Every commission accrual, hold release, refund clawback, and payout is recorded as balanced debit/credit journal entries in PostgreSQL.
- **Escrow Hold Period**: Commissions enter a `PENDING_CLEARANCE` state for a configurable refund-window hold (default 30 days) before moving to `AVAILABLE_FOR_PAYOUT`.
- **Reversals**: Subscription refunds or chargebacks automatically generate reversing ledger entries against pending or available partner balances.
- **Payout Execution**: Automated batch payouts via Stripe Connect / Wise / bank wire once partner balance exceeds minimum payout threshold (default `$50.00`), with tax form (`W-9` / `W-8BEN`) verification gates.

### 2.12 Admin Panel, Moderation & Reporting
- **Role-Based Access Control (RBAC)**: `SUPER_ADMIN`, `TRUST_AND_SAFETY`, `FINANCE_ADMIN`, `EDITORIAL_CMS`, `AFFILIATE_MANAGER`.
- **Moderation Queue**: SLA-prioritized queue for user reports, flagged chat transcripts, selfie verification reviews, and media moderation escalations.
- **Audit Logging**: Every administrative view or mutation of user records is written to an append-only audit log with actor ID, IP, timestamp, and reason code.

### 2.13 Mandatory Media Processing & Safety Pipeline (PERMANENT REQUIREMENT)

> [!IMPORTANT]
> **Permanent Product Requirement**: Whenever a user uploads an image or video through the mobile apps or website, the platform **must** automatically process, sanitize, moderate, and optimize that media before it can ever be published or viewed by other members.

#### Image Processing Requirements:
1. **Validation**: Verify MIME type and cryptographic magic bytes (`JPEG`, `PNG`, `WebP`, `HEIC`, `AVIF`); reject polyglot or disguised executables.
2. **Limits**: Enforce configurable file-size (default max `15 MB`) and dimension limits (min `400x400`, max `8192x8192` to prevent decompression bombs).
3. **Resizing & Compression**: Downscale oversized images while preserving aspect ratio and perceptual quality.
4. **Modern Variants & Responsive Sizes**: Generate optimized `WebP` and `AVIF` derivatives across standard responsive breakpoints (`thumbnail: 160x160`, `card: 640x800`, `full: 1280x1600`).
5. **Privacy Metadata Stripping**: Unconditionally strip all EXIF, IPTC, XMP, camera serial numbers, and GPS coordinate metadata during re-encoding.
6. **Safety & Moderation**: Run automated CSAM hash matching and NSFW/violence classification prior to publication.
7. **Original Retention Policy**: Store raw originals in a locked, non-public vault bucket with an automated lifecycle deletion policy (default purge after `7 days` once derivatives are verified, unless flagged for legal preservation).

#### Video Processing Requirements:
1. **Validation**: Inspect container and stream headers (`MP4`, `MOV`, `WebM`), file size (default max `100 MB`), resolution (max `4K`), frame rate, and duration (profile clips `3s–30s`).
2. **Transcoding & Compression**: Asynchronous FFmpeg worker pipeline transcoding video into H.264 / H.265 / VP9 streams with normalized audio (`AAC`).
3. **Derivatives & Streaming**: Generate playback-appropriate resolutions (`480p`, `720p`, `1080p`), HLS adaptive bitrate manifests (`.m3u8` + `.ts`/`.m4s` segments), and animated WebP / static poster thumbnails.
4. **Malicious Upload Defense**: Enforce strict CPU/memory/timeout sandboxes on FFmpeg worker processes.

#### Pipeline Reliability Requirements:
1. **Non-Blocking Uploads**: Client requests never block waiting for transcoding. Clients upload directly to a quarantined ingest bucket via short-lived presigned URLs, triggering an asynchronous durable job.
2. **Observable State Machine**: Media records transition deterministically through `PENDING_UPLOAD` $\rightarrow$ `UPLOADED` $\rightarrow$ `PROCESSING` $\rightarrow$ `MODERATION_PENDING` $\rightarrow$ `READY` (or `REJECTED` / `FAILED`) with exponential-backoff retries.
3. **Zero Premature Publication**: Media in any state other than `READY` is strictly invisible to other users.
4. **Idempotency**: Content-addressable SHA-256 hashes and job idempotency keys prevent duplicate processing from corrupting media records.
5. **Private Storage & Authorized CDN**: All buckets are strictly private; approved derivatives are served exclusively via signed CDN URLs or short-lived signed cookies.

### 2.14 Analytics, Security, Privacy & International Deployment
- **Privacy-Preserving Telemetry**: First-party event tracking that never leaks sexual orientation, gender identity, or exact GPS coordinates to third-party marketing trackers.
- **Internationalization & Legal Gatekeeper**: Market clearance registry (`US`, `UK`, `EU`, `UAE`) ensuring high-risk jurisdictions remain locked out of matchmaking until legal, operational, and safety reviews are approved.

### 2.15 Monitoring, Backup & Disaster Recovery
- **Observability**: OpenTelemetry distributed tracing, Prometheus metrics, structured JSON logs (`slog`), and PagerDuty alerting on SLO breaches.
- **Resilience**: Continuous PostgreSQL WAL archiving (Point-in-Time Recovery $\text{RPO} < 5\text{ minutes}$, $\text{RTO} < 30\text{ minutes}$), cross-region encrypted backups, and multi-AZ failover.

---

## 3.Recorded Architectural Defaults (Deferred to Phase 02)

1. **Editorial CMS Workflow**: Internal PostgreSQL-backed editorial tables (`cms_articles`, `cms_revisions`) with clean repository interfaces supporting optional headless CMS adapters.
2. **Initial Curated Location Pages**: Restricted to 10 vetted Tier-1 cities in legally cleared markets (NYC, SF, LA, Chicago, London, Manchester, Berlin, Paris, Toronto, Sydney).
3. **Regional Restrictions**: Disabled by default (`enableRegionalRestrictions: false`) until formal legal and safety sign-off.
