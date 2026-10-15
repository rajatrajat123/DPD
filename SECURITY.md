# Aura Platform — Security, Privacy & Threat Model Specification (`SECURITY.md`)

**Related SEO Security Spec**: See [`docs/architecture/privacy-preserving-seo-and-security.md`](file:///C:/Users/ACER/.gemini/antigravity/scratch/lgbtq-dating-platform/docs/architecture/privacy-preserving-seo-and-security.md) for search-engine privacy boundaries.

---

## 1. Threat Model for an LGBTQ+ Dating Platform

An LGBTQ+ dating platform faces significantly higher threat severity than standard consumer apps:
1. **Outing, Harassment & Doxxing**: Malicious actors attempting to scrape member profiles, photos, or orientations.
2. **Geospatial Trilateration Attacks**: Adversaries spoofing GPS coordinates at 3 surrounding points to mathematically triangulate a member's exact apartment or workplace.
3. **Hostile State / Jurisdiction Surveillance**: Users travelling to or residing in jurisdictions where same-sex relationships are criminalized.
4. **Malicious Media Uploads**: Polyglot files, decompression bombs (10KB PNG expanding to 40GB RAM), FFmpeg SSRF/local-file-read exploits via crafted HLS playlists, and EXIF GPS leakage.
5. **Financial & Affiliate Fraud**: Stolen credit cards, receipt replay attacks, self-referrals, and refund abuse.

---

## 2. Authentication & Session Security

- **Password Hashing**: `Argon2id` (`memory = 64 MiB`, `iterations = 3`, `parallelism = 4`, `salt = 16 bytes`, `keyLength = 32 bytes`).
- **Token Architecture**:
  - **Access Token**: Short-lived (`15 minutes`) signed `EdDSA (Ed25519)` or `HMAC-SHA256` JWT containing `sub`, `role`, `session_id`, `iat`, `exp`.
  - **Refresh Token**: 256-bit cryptographically random opaque token (`crypto/rand`), stored only as a `SHA-256` digest in `user_sessions`. Rotated on every refresh with automatic reuse detection (if a rotated token is replayed, the entire session family is revoked immediately).
- **Web SSR Boundary Guard**: Next.js Edge Middleware and Server Components verify session signatures and enforce `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: private, no-store` on all private routes. *(Note: The Phase 00/01 Next.js `session.ts` helper enforces HMAC-SHA256 cookie verification as a structural route guard; full Go Identity Service integration is scheduled for Phase 02).*

---

## 3. Geospatial Privacy & Anti-Trilateration Defense

- **Server-Side Coordinate Quarantine**: Raw `GEOGRAPHY(Point, 4326)` coordinates in `profile_locations` never leave PostgreSQL.
- **Distance Bucketing & Grid Snapping**:
  - Before computing display distance, member positions are snapped to a hexagonal H3 / grid cell ($\approx 1.5\text{ km}$ resolution) with deterministic per-pair salt jitter.
  - Minimum displayed distance is clamped to `< 2 km away` (never `0.1 km` or exact meters).
  - Rapid coordinate teleportation checks (`> 1000 km/h` without Global Passport entitlement) trigger anti-spoofing rate limits.

---

## 4. Media Upload & Processing Security

- **Direct-to-Quarantine Presigned Uploads**: Clients upload binary payloads directly to a locked S3/R2 quarantine bucket with strict `Content-Length` conditions.
- **Magic-Byte & Decompression Bomb Protection**:
  - Workers inspect the first 512 bytes using `http.DetectContentType` and container parsers before decoding.
  - Image headers (`width`, `height`, frame count) are read before allocating pixel buffers; images exceeding `8192 x 8192` pixels are rejected immediately.
- **Unconditional Metadata Destruction**: Re-encoding strips 100% of EXIF, GPS, IPTC, XMP, and color-profile comment blocks.
- **Sandboxed FFmpeg Execution**: Video transcoding runs inside non-root, network-isolated containers with `-nostdin -protocols file` (disabling `http://`, `concat:`, and `subfile:` protocols to prevent SSRF/LFI), hard CPU/memory cgroups, and a 120-second process kill timer.

---

## 5. Payment & Webhook Integrity

- **Stripe**: Verified using `Stripe-Signature` HMAC-SHA256 with a 5-minute timestamp tolerance to prevent replay attacks.
- **Apple App Store Server API v2**: Verified using Apple Root CA X.509 certificate chain validation on the `signedPayload` JWS.
- **Google Play RTDN**: Verified via Google Cloud Pub/Sub OIDC bearer token validation and Play Developer API purchase status verification.
- **Idempotency**: Every webhook `event_id` is recorded in `webhook_events` with a `UNIQUE (provider, external_event_id)` constraint prior to processing.

---

## 6. Secrets Management & Repository Hygiene

- **Zero Secrets in Git**: `.gitignore` blocks `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, and credential files.
- **Configuration Validation**: The Go backend (`internal/config`) validates required environment variables at startup and refuses to boot in `staging` or `production` if default/placeholder secrets are detected.
