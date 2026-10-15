# Aura — Global LGBTQ+ Dating & Connection Platform

Aura is a commercial, privacy-first LGBTQ+ dating and connection platform designed with an **Enterprise SEO Consumer Web Architecture** (`web/`), a **Go Modular Monolith Backend Foundation** (`backend/`), and native **iOS (SwiftUI)** and **Android (Jetpack Compose)** client specifications.

---

## Repository Structure

```text
lgbtq-dating-platform/
├── .github/workflows/ci.yml              # Automated CI pipeline for Go Backend & Next.js SEO Web
├── .env.example                          # Documented environment variable defaults
├── docker-compose.yml                    # Local PostgreSQL 16 (PostGIS 3.4) & Redis 7.4 stack
├── PRODUCT_SPEC.md                       # Complete product & functional specification (15 domains)
├── ARCHITECTURE.md                       # System architecture, domain ownership & Mermaid diagrams
├── DATABASE.md                           # PostgreSQL 16 + PostGIS 3.4 schema & ER diagrams
├── API_CONTRACTS.md                      # REST (/api/v1) & WebSocket (/ws/v1) API contracts
├── EVENTS.md                             # Transactional outbox, event catalog & consumer contracts
├── SECURITY.md                           # Threat model, zero-trust auth, regional safety & GDPR
├── BILLING_SPEC.md                       # Multi-provider billing (Stripe, Apple IAP, Google Play)
├── AFFILIATE_SPEC.md                     # Attribution engine, double-entry ledger & payouts
├── MEDIA_SPEC.md                         # Mandatory media optimization, moderation & CDN pipeline
├── DEPLOYMENT.md                         # Kubernetes topology, DR runbooks & backup drills
├── PLAN.md                               # Phased platform execution roadmap (Phases 00–10)
├── TASKS.md                              # Granular task registry with verification evidence
├── PHASE_00_VERIFICATION_REPORT.md       # Phase 00 Enterprise SEO verification report
├── PHASE_01_VERIFICATION_REPORT.md       # Phase 01 Blueprint & Go Foundation verification report
├── docs/
│   └── architecture/                     # Deep-dive SEO & platform architecture specifications
├── backend/                              # Go 1.24+ Backend Modular Monolith
│   ├── cmd/api/main.go                   # HTTP API server entrypoint (/healthz, /readyz, /api/v1)
│   ├── cmd/migrate/main.go               # Versioned SQL migration runner (validate, status, up, down)
│   ├── internal/
│   │   ├── affiliate/                    # Affiliate link attribution, multi-tier commission rules, double-entry ledger & payouts
│   │   ├── analytics/                    # First-party aggregate funnel, conversion, and platform health metrics (strict zero-PII)
│   │   ├── apperror/                     # Standardized JSON error envelopes & HTTP helpers
│   │   ├── billing/                      # Stripe, Apple IAP, Google Play, subscriptions, boosts & entitlements
│   │   ├── cache/                        # Redis 7 client wrapper & health check probes
│   │   ├── chat/                         # WebSocket hub, persistent conversations, messaging & push notifications
│   │   ├── config/                       # Environment configuration loader & validator
│   │   ├── database/                     # PostgreSQL pgxpool manager & transactional SQL migrator
│   │   ├── discovery/                    # Geospatial PostGIS feed, reciprocal ranking, lifestyle dealbreakers & nearby summary
│   │   ├── events/                       # Transactional outbox envelope & exponential backoff
│   │   ├── health/                       # Liveness (/healthz) & dependency readiness (/readyz)
│   │   ├── identity/                     # Auth, Argon2id, JWT sessions, LGBTQ+ profiles, taxonomy & recovery
│   │   ├── media/                        # Metadata stripping, raster recreation, moderation & signed streams
│   │   ├── middleware/                   # Request ID, structured slog logging, panic recovery, headers
│   │   ├── notification/                 # Push delivery engine, APNs/FCM adapters, quiet hours, consent & token cleanup
│   │   ├── safety/                       # Admin security, RBAC, moderation queue, reports, appeals, audit logs, fraud & age assurance
│   │   ├── server/                       # HTTP router & middleware composition
│   │   └── validator/                    # Request payload & field validator
│   └── migrations/                       # Embedded up/down SQL migrations (000001 - 000010)
└── web/                                  # Next.js 15 App Router Consumer Website & Member Area
    ├── src/app/                          # Public SEO landings, safety guides, sitemaps, private /app routes
    ├── src/components/                   # SEO components, auth forms, discovery cards, matches list, chat
    ├── src/lib/api/                      # Typed API clients for discovery, swipes, matches, and chat
    ├── src/lib/auth/                     # Session guard & HMAC verification
    ├── src/lib/seo/                      # Metadata, JSON-LD, hreflang, market governance, CMS workflow
    └── tests/seo/                        # 37 Playwright Enterprise SEO & privacy protection tests
```

### Implemented & Verified Capabilities
- **Phase 00**: Enterprise SEO architecture, canonical URLs, hreflang, JSON-LD structured data, and 37 Playwright SEO tests passing.
- **Phase 01**: Engineering foundation, configuration, structured logging, health/readiness probes, and transactional outbox.
- **Phase 02**: Database-backed identity, secure Argon2id password hashing, session tokens, LGBTQ+ gender identities, pronouns, orientations, dating preferences, and privacy visibility controls.
- **Phase 03**: Media pipeline, EXIF/GPS metadata stripping, pure Go raster recreation, WebP/AVIF derivative generation, automated moderation gating, and HMAC-signed time-limited streaming URLs.
- **Phase 04**: PostGIS `ST_DWithin` discovery feed with reciprocal filtering, bilateral block exclusion, multi-dimensional LGBTQ+ compatibility ranking, fuzzed distance privacy floor, canonical `LEAST/GREATEST` mutual matching, `match.created.v1` outbox event emission, 24h unlimited swipes reward grant, and Next.js discovery deck/matches management UI.
- **Phase 05**: Real-time WebSocket messaging (`/api/v1/ws`, `/ws/v1`), monotonic sequence ordering, cursor pagination, member chat rooms, privacy-safe notifications without raw body or identity leakage, and disconnect cleanup.
- **Phase 06**: Multi-provider billing architecture (`billing.ProviderAdapter`), server-authoritative product catalog (`billing_products`), integer minor currency units (`price_cents`), Stripe checkout & HMAC-SHA256 webhooks, Apple App Store & Google Play purchase verification, idempotent event deduplication, real-time entitlement projections (`user_entitlements`), subscription lifecycle with cancellation grace periods, consumable boost credits with atomic double-spend prevention, 30-minute 2.5x profile boosts, discovery ranking integration (`CalculateBoostedScore`), and complete transactional outbox domain events.
- **Phase 07**: Affiliate marketing lifecycle (`affiliates`, `affiliate_campaigns`), server-side link tracking (`GET /r/{code}`), signed first-party `aura_ref` cookies, 30-day attribution window with anti-fraud safeguards (self-referral prevention, duplicate rate limiting), configurable commission rules engine (`CPA_FIXED`, `REVSHARE_PERCENT`, `HYBRID`) calculating basis points in minor units (`cents`), immutable double-entry accounting ledger (`ledger_accounts`, `ledger_journals`, `ledger_entries`) with balanced journal constraint ($\sum \text{Debit} == \sum \text{Credit}$), Net-30 escrow hold release (`matures_at`), compensating refund reversals (`COMMISSION_CLAWED_BACK`), W-9/W-8BEN tax verification gate, multi-provider payout orchestration (`payout_batches`) with Stripe Connect and secure disabled-by-default EVM/Solana crypto adapter, and asynchronous billing event integration (`billing.transaction_verified.v1`, `billing.transaction_refunded.v1`).
- **Phase 08**: Admin security & role-based access control (`identity.UserRole`, `safety.Permission`), anti-self-approval (`ValidateNonSelfAction`), step-up authentication (`X-Aura-Step-Up`), member safety reporting (`POST /api/v1/reports`), SLA-prioritized moderation case queue (`GET/POST /api/v1/admin/moderation/cases/*`), case actions (`WARN`, `RESTRICT`, `SUSPEND`, `BAN`, `CLEAR`) cascading to account status and immediate WebSocket termination, member appeals (`POST /api/v1/appeals`, `POST /api/v1/admin/moderation/appeals/{id}/decide`), login brute-force rate limiter (`login_attempts`, `FraudManager`) with 5-attempt threshold and 15-minute lockout, append-only security audit trail (`security_audit_logs`) with recursive PII/secret scrubbing (`SanitizeAuditMetadata`) and IP pseudonymization (`PseudonymizeIP`), and mandatory 18+ age assurance fail-closed gating (`RequireAgeVerified`, Persona webhook HMAC-SHA256 verification, production-gated dev provider) auto-suspending underage accounts with 2h SLA escalation.
- **Phase 09**: Discovery dealbreaker integrity (`NonSmokerOnly`, `RequireVerified`, `RequireMonogamous`) with zero scarcity overrides, reciprocal orientation/gender spectrum compatibility, descriptive `empty_state_reason`, authoritative matching nearby summary with 5-min caching and small-number privacy floor ($< 5$), notification delivery infrastructure (`notification.Service`, APNs/FCM adapters, category consent, quiet hours windowing, deduplication, invalid token cleanup, truthful delivery reporting), first-party aggregate platform analytics (`analytics.Service`, funnel, subscriptions, safety SLAs, notifications), and cryptographic step-up verification hardening (`TokenStepUpVerifier`).

---

## Quick Start

### 1. Local Infrastructure (PostgreSQL + PostGIS & Redis)

```bash
cp .env.example .env
docker compose up -d
```

### 2. Go Backend (`backend/`)

Validate embedded SQL migrations, run unit tests, and start the API server:

```bash
cd backend

# Validate embedded SQL migrations and SHA-256 checksums offline
go run ./cmd/migrate -direction=validate

# Apply migrations to running PostgreSQL + PostGIS instance
go run ./cmd/migrate -direction=up

# Run unit & HTTP server integration tests
go test -v ./...

# Start the Go API server (listens on :8080 by default)
go run ./cmd/api
```

Health and diagnostic endpoints:
- `GET http://localhost:8080/healthz` — Process liveness check (`200 OK`)
- `GET http://localhost:8080/readyz` — Dependency readiness check (`200 OK` when Postgres & Redis are reachable; `503 Service Unavailable` with diagnostic breakdown when degraded)
- `GET http://localhost:8080/api/v1/migrations/manifest` — Embedded SQL migration manifest and SHA-256 checksums

### 3. Next.js Consumer Website & SEO Suite (`web/`)

```bash
cd web
npm install

# Type checking, linting, and production build
npm run typecheck
npm run lint
npm run build

# Run the 37 Enterprise SEO Playwright tests
npm run test:seo
```
