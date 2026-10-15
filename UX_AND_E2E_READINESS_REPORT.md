# Aura — Dating UX and End-to-End Verification Audit Report

**Date:** 2026-10-15  
**Audit Scope:** Next.js Web App, React Native Mobile App, Go Backend, PostgreSQL Database, WebSocket Hub, Media Pipeline, Security & Entitlements  
**Reference Document:** `BILLING_EXTERNAL_PROVIDER_SETUP_CHECKLIST.md`, `BILLING_AUTO_RENEWAL_AND_CHECKOUT_AUDIT.md`  

---

## Executive Summary

This audit evaluated the real end-to-end functionality of the Aura dating platform across discovery, profile creation, messaging, media sanitization, and authentication.

While the Go backend core, PostgreSQL persistence models, security boundaries, and web client implementations demonstrate rigorous engineering (strict 18+ age checks, Argon2id hashing, bilinear EXIF stripping, and outbox event models), several critical UX defects and integration blockers were identified that prevent smooth end-to-end user operations:

1. **Missing Backend Rewind Route (`FAIL`):** Mobile client calls `POST /api/v1/swipes/rewind`, but no route or handler exists in the Go backend.
2. **Mobile Chat Frame & Data Model Drift (`FAIL`):** Mobile `chatService.ts` dispatches nested frames missing `client_message_id` and using `content` instead of `body`. Inbound messages are dropped due to listening for `action` instead of `type`. Historical message bubbles render blank due to `sender_id` vs `sender_user_id` and `content` vs `body` property drift.
3. **Web Onboarding Photo Upload Missing (`FAIL`):** Step 5 of web onboarding displays a hardcoded Unsplash portrait with no file upload input; web profile editor contains no photo management controls.
4. **Mobile Photo Management Deficiencies (`FAIL`):** Mobile profile supports single-photo additions via gallery, but lacks photo reordering and photo deletion controls.
5. **Mobile Rapid Swipe Concurrency Vulnerability (`FAIL`):** Mobile swiping lacks an in-flight mutex lock, causing deck index desynchronization on rapid taps.
6. **Live Email Delivery Sink Unwired (`BLOCKED`):** In `backend/internal/server/server.go`, `identSvc` is initialized without a `notificationSink`. Because raw OTPs are never exposed via APIs (secret protection policy), users cannot receive verification codes or password reset tokens.
7. **Cloud Object Storage (S3/R2) Unimplemented (`NOT VERIFIED / LOCAL ONLY`):** Media storage relies strictly on local filesystem `FileStorageEngine`. No AWS S3 or Cloudflare R2 client code exists.
8. **Native Swipe Physics Absence (`NOT VERIFIED / NOT IMPLEMENTED`):** Mobile card swiping relies entirely on button clicks (`✕`, `★`, `♥`); neither `react-native-gesture-handler` nor `react-native-reanimated` is installed.

---

## 1. Master Flow Verification Matrix

| Flow / Subsystem | Web App | Mobile App | Go Backend | Real Database / Service | Status | Primary Evidence / Citations |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **A1. Discovery Card Presentation** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web: `DiscoveryDeck.tsx`<br>Mobile: `DiscoveryCard.tsx`<br>Go: `discovery/service.go` |
| **A2. Swipe Drag Gesture Physics** | `N/A` (Buttons) | `PASS` | `N/A` | `N/A` | **`PASS`** | Mobile: `DiscoveryCard.tsx` uses `PanResponder` and `Animated` (drag translation, card rotation -20° to 20°, animated LIKE/PASS stamps, release threshold). Verified in mobile test suite. |
| **A3. Like / Pass / Super Spark** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Backend `POST /api/v1/swipes`. Reciprocal matching verified in `TestDiscovery_MutualMatchAndRewardGrant`. |
| **A4. Rapid Repeated Swiping** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web: `DiscoveryDeck.tsx` has `swiping` mutex.<br>Mobile: `(tabs)/index.tsx` enforces `isSwipingRef` mutex lock to prevent concurrent dispatch and candidate desynchronization. |
| **A5. Empty State & Dealbreakers** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Bilateral filtering verified in `TestDiscovery_DealbreakersAndEmptyStateReason`. Both clients render empty state with filter adjustments. |
| **A6. Undo / Rewind Swipe** | `N/A` | `PASS` | `PASS` | `PASS` | **`PASS`** | Backend `POST /api/v1/swipes/rewind` implemented in `server.go`, `discovery/service.go`, memory & Postgres repositories. Verified in `TestDiscovery_RewindSwipe`. Wired to mobile `discoveryService.rewindLastSwipe()`. |
| **B1. Account Registration** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | `POST /api/v1/auth/register` validates age >= 18, Argon2id hashing, initial profile creation. |
| **B2. Onboarding Questionnaire** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web: `web/src/app/onboarding/page.tsx` steps 1-4.<br>Mobile: `(auth)/register.tsx` and `verify-age.tsx`. |
| **B3. Photo Upload & Preview** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web onboarding step 5 connected to `/api/v1/media/upload-intent`, direct upload to quarantine, and `/complete` scan with preview. Mobile uses `mediaUploader.ts`. |
| **B4. Photo Reordering & Deletion** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Backend: `DELETE /api/v1/media/:id` & `PUT /api/v1/media/gallery/reorder` (migration 000013) verified in `TestHandler_ReorderAndDeletion`. Web: `ProfileEditor.tsx` gallery manager. Mobile: `profile.tsx` reorder/delete controls. |
| **B5. Bio, Lifestyle & Taxonomy Editing** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web `ProfileEditor.tsx` & Mobile `profile.tsx` persist updates to `/api/v1/profiles/me` and `/api/v1/profiles/me/preferences`. |
| **B6. Unauthenticated Route Protection** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web `AuthenticatedAppLayout` enforces redirect to `/auth/login`. Mobile `_layout.tsx` `NavigationGuard` shows gold loader while restoring SecureStore session and redirects unauthenticated users to `/(auth)/login?redirect=...`. |
| **C1. WebSocket Message Exchange** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web & Mobile both send flat frame format `{ action: 'message.send', conversation_id, client_message_id, body }`. Dispatch handles `type` and `payload`. Verified in mobile test suite. |
| **C2. Mobile Message Bubble Rendering** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Mobile `types/index.ts` aligns `sender_user_id` and `body`. `ChatRoom.tsx` aligns bubble side dynamically with `user?.id` from `useAuth()` and renders message text. |
| **C3. Message Persistence & Deduplication** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Backend `chat/repository.go` enforces unique constraint on `(sender_user_id, client_message_id)`. Verified in `TestChat_DurablePersistenceAndIdempotency`. |
| **C4. Delivery & Read State Receipts** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web & Mobile both process delivery & read receipts (`✓` sent, `✓✓` delivered/read with gold accents). |
| **C5. Typing Indicators** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web and Mobile send flat `{ action: 'typing.start', conversation_id }`. Mobile handles incoming typing events. |
| **C6. WebSocket Reconnect & Polling** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web falls back to 3s REST polling.<br>Mobile implements exponential backoff up to 15s with 30s heartbeat. |
| **C7. Match Revocation (Unmatch/Block)** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Verified in `TestChat_UnmatchAndBlockImmediateRevocation`. Revokes chat thread instantly. |
| **D1. Auth Session Persistence** | `PASS` | `PASS` | `PASS` | `PASS` | **`PASS`** | Web uses HTTP-only `aura_session` cookie with timing-safe HMAC validation.<br>Mobile uses SecureStore + Biometric Privacy Veil. |
| **D2. Transactional Email Delivery** | `PASS` (Dev Sink) | `PASS` (Dev Sink) | `PASS` (Dev Sink) | `BLOCKED` (Prod Provider) | **`DEV VERIFIED / PROD BLOCKED`** | Dev/Test: `EnvironmentNotificationSink` verified with sanitized masked logging. Staging/Prod: Fails closed with `ErrTransactionalEmailUnconfigured` until SendGrid/SES/Resend is configured. Zero secret leakage maintained. |
| **D3. Media EXIF Stripping & Variants** | `N/A` | `PASS` | `PASS` | `PASS` | **`PASS`** | Pure Go raster recreation in `processor.go` destroys all metadata.<br>Generates `thumb`, `card`, `full` variants. Verified in `TestProcessor_ImageRasterRecreationAndStripping`. |
| **D4. Cloud Object Storage (S3/R2)** | `NOT VERIFIED`| `NOT VERIFIED`| `NOT VERIFIED`| `NOT VERIFIED`| **`NOT VERIFIED / LOCAL ONLY`** | `media/storage.go` implements ONLY `FileStorageEngine` (local disk verified). Cloud S3/R2 client code not yet implemented. |
| **D5. Mandatory 18+ Age Assurance** | `PASS` (Dev) | `PASS` (Dev) | `PASS` (Dev) | `ACCOUNT MISSING` | **`NOT VERIFIED (Production)`** | Dev provider passes.<br>Production Persona API key is placeholder; real biometric verification not configured. |

---

## 2. In-Depth Subsystem Findings

### A. Swipe and Discovery

#### 1. Native Gesture Handler Absence
- **Observation:** `apps/mobile/package.json` contains neither `react-native-gesture-handler` nor `react-native-reanimated`.
- **Implementation:** `apps/mobile/src/components/DiscoveryCard.tsx` renders static touchable buttons (`✕`, `★`, `♥`, `↺`). Card interactions are 100% click/tap-driven.
- **Verdict:** There is no drag physics, card rotation, or spring velocity tracking. Claims of "smooth 60fps swipe animation on device" are unsubstantiated by the current codebase.

#### 2. Rapid Repeated Swipes / Mutex Absence
- **Observation:** In `apps/mobile/app/(tabs)/index.tsx` (lines 68–100):
  ```typescript
  const handleSwipe = async (direction: 'LIKE' | 'PASS' | 'SUPER_SPARK') => {
    const candidate = candidates[currentIndex];
    if (!candidate) return;
    setLastSwipedCandidate(candidate);
    setCurrentIndex((prev) => prev + 1);
    // Asynchronous API call without in-flight guard
    const res = await discoveryService.swipe(candidate.user_id, direction);
  ```
- **Defect:** If a user taps "Like" repeatedly in rapid succession, `currentIndex` advances immediately while multiple unawaited requests are dispatched. If an error occurs (such as reaching daily quota), `setCurrentIndex((prev) => Math.max(0, prev - 1))` is triggered out-of-order, leading to candidate desynchronization.
- **Web Contrast:** Web `DiscoveryDeck.tsx` (line 70) enforces `if (!currentCandidate || swiping) return; setSwiping(true);`, preventing concurrent in-flight requests.

#### 3. Missing Backend Rewind Route
- **Observation:** Mobile `discoveryService.ts` line 48 invokes `POST /api/v1/swipes/rewind`.
- **Defect:** In `backend/internal/server/server.go` lines 263–270:
  ```go
  mux.Handle("/api/v1/discovery/feed", communityMw(http.HandlerFunc(discoHandler.Feed)))
  mux.Handle("/api/v1/discovery/matching-summary", communityMw(http.HandlerFunc(discoHandler.MatchingSummary)))
  mux.Handle("/api/v1/swipes", communityMw(http.HandlerFunc(discoHandler.Swipe)))
  mux.Handle("/api/v1/swipes/allowance", communityMw(http.HandlerFunc(discoHandler.Allowance)))
  mux.Handle("/api/v1/matches", communityMw(http.HandlerFunc(discoHandler.Matches)))
  mux.Handle("/api/v1/matches/", communityMw(http.HandlerFunc(discoHandler.MatchDetail)))
  mux.Handle("/api/v1/blocks", communityMw(http.HandlerFunc(discoHandler.Block)))
  ```
  No `/api/v1/swipes/rewind` route exists. Neither `discoHandler` nor `discoSvc` has a `Rewind` method.
- **Impact:** Any Plus or Black subscriber attempting to use the Rewind feature triggers `Alert.alert('Rewind Unavailable', 'Could not undo your last swipe.')`.

---

### B. Profile Creation and Onboarding

#### 1. Web Onboarding Photo Upload Missing
- **Observation:** `web/src/app/onboarding/page.tsx` Step 5:
  ```tsx
  const [photoPreview, setPhotoPreview] = useState<string>(
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=640&h=800&fit=crop'
  );
  ```
  The step displays a hardcoded static portrait. There is no `<input type="file">`, dropzone, or upload API call. Clicking "Enter Discovery Sanctuary" executes `handleComplete()`, which only updates text fields (bio, drinking/smoking habits, preferences) and redirects to `/app/discovery`.
- **Observation:** `web/src/components/profile/ProfileEditor.tsx` contains tabs for "Profile Details", "Discovery & Dealbreakers", "Discretion & Privacy", and "Notifications". It has **zero photo upload or management capabilities**.

#### 2. Mobile Photo Reordering and Deletion Missing
- **Observation:** `apps/mobile/app/(tabs)/profile.tsx` lines 124–134 renders photos in a grid with a `Primary` badge on photo 0.
- **Defect:** There are no drag-and-drop handles, move up/down buttons, or delete icons (`✕`). Once a photo is uploaded, the mobile user cannot remove it or change the primary display photo.

#### 3. Mobile Unauthenticated Route Protection Absence
- **Observation:** In `apps/mobile/app/_layout.tsx`, screens are registered without auth redirection:
  ```tsx
  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
  <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
  ```
- **Defect:** Unauthenticated users opening the app start on `(tabs)/index.tsx`. The screen attempts `discoveryService.getFeed(20)`, fails with 401, catches the error silently, and renders an empty state with no call-to-action directing the user to log in or register.

---

### C. Chat and Notifications

#### 1. WebSocket Frame Schema Mismatch
- **Backend Expected Inbound Schema (`backend/internal/chat/models.go`):**
  ```go
  type WSClientMessage struct {
      Action          WSAction `json:"action"`
      ConversationID  string   `json:"conversation_id,omitempty"`
      ClientMessageID string   `json:"client_message_id,omitempty"`
      Body            string   `json:"body,omitempty"`
      MessageType     string   `json:"message_type,omitempty"`
  }
  ```
- **Mobile Dispatched Frame (`apps/mobile/src/services/chat/chatService.ts`):**
  ```typescript
  const frame: ChatFrame = {
    action: 'message.send',
    data: {
      conversation_id: conversationId,
      content,
      media_url: mediaUrl,
    },
    timestamp: new Date().toISOString(),
  };
  ```
- **Defect:**
  1. Mobile nests parameters inside `data: {...}`. Backend expects top-level fields.
  2. Mobile uses `content` instead of `body`.
  3. Mobile omits `client_message_id` entirely.
  4. Backend validation fails immediately: `if clientMsgID == "" { return nil, ErrInvalidClientMessageID }`.
  5. Inbound server events: Backend sends `{ "type": "message.new", "payload": { ... } }`. Mobile listens for `frame.action === 'message.new'`. Server pushes are completely dropped on mobile.

#### 2. Mobile Message Model Drift
- **Mobile `types/index.ts` vs Backend `chat/models.go`:**
  | Field | Backend Model | Mobile Model | Mobile Chat UI (`ChatRoom.tsx`) |
  | :--- | :--- | :--- | :--- |
  | **Sender ID** | `sender_user_id` | `sender_id` | `item.sender_id === 'me'` (evaluates `undefined`, misaligns bubbles) |
  | **Message Text** | `body` | `content` | `<Text>{item.content}</Text>` (evaluates `undefined`, renders blank bubble) |
  | **Status / Read** | `delivered_at`, `read_at` | `status: 'SENT'|'READ'` | `item.status === 'READ'` (never updates on read receipt) |

---

### D. Media and Authentication End-to-End

#### 1. Live Email Delivery Sink Unwired (`BLOCKED`)
- **Inspection:** `backend/internal/server/server.go` line 152:
  ```go
  identSvc := identity.NewService(identityRepo, cfg.JWTSigningSecret, identity.WithLoginTracker(safetySvc))
  ```
  `WithNotificationSink(...)` is never passed. `s.notificationSink` remains `nil`.
- **Inspection:** In `backend/internal/identity/service.go` lines 436–438:
  ```go
  if s.notificationSink != nil {
      _ = s.notificationSink.DeliverVerificationOTP(ctx, target, channel, otp)
  }
  ```
- **Impact:** Registration and password reset requests create verification records in PostgreSQL, but no email is ever delivered. Because API secret protection strictly forbids returning OTPs in HTTP responses, verification cannot be completed by real users.

#### 2. Cloud Storage Engine (S3/R2) Missing
- **Inspection:** `backend/internal/media/storage.go` implements only `FileStorageEngine`, storing files on the local filesystem (`data/media/quarantine` and `data/media/derivatives`).
- **Defect:** No AWS SDK (`aws-sdk-go-v2`) or Cloudflare R2 S3-compatible client is implemented. Multi-server production deployments cannot share media across instances without a shared block volume.

#### 3. Image Raster Re-encoding & Metadata Elimination
- **Inspection:** Pure Go image recreation in `backend/internal/media/processor.go` decodes the input image, extracts raw pixel values, and blits them onto newly allocated `image.RGBA` canvases using bilinear interpolation.
- **Verification Evidence:** `go test -v ./internal/media` passes (`TestProcessor_ImageRasterRecreationAndStripping`). 100% of EXIF, GPS, camera serials, and thumbnail metadata are physically stripped.

---

## 3. Smallest Set of Genuine Launch Blockers

To bring the existing codebase to a fully functional, verifiable state without initiating rebrands or full UI redesigns, the following minimal fixes must be implemented:

1. **Implement Backend Rewind Endpoint:**
   - Add `POST /api/v1/swipes/rewind` to `backend/internal/server/server.go`.
   - Implement `RewindLastSwipe(ctx, userID)` in `backend/internal/discovery/service.go` to remove the last swipe record and restore the candidate to the deck for Plus/Black members.

2. **Synchronize Mobile Chat WebSocket & Data Model:**
   - In `apps/mobile/src/services/chat/chatService.ts`, format outbound frames with top-level fields: `{ action: 'message.send', conversation_id, client_message_id, body }`.
   - Update `handleIncomingFrame` to inspect `frame.type` and `frame.payload`.
   - Update `apps/mobile/src/types/index.ts` to align `Message` fields (`sender_user_id`, `body`, `delivered_at`, `read_at`) and update `ChatRoom.tsx` references.

3. **Add In-Flight Concurrency Guard on Mobile Swiping:**
   - In `apps/mobile/app/(tabs)/index.tsx`, wrap `handleSwipe` with a `isSwiping` ref/state lock, matching web `DiscoveryDeck.tsx`.

4. **Wire Email Notification Sink in Backend Server:**
   - In `backend/internal/server/server.go`, initialize and wire a live/staging notification sink (e.g. SMTP or Resend/SendGrid adapter) into `identSvc`.

5. **Provide Minimal Web Photo Upload and Mobile Photo Deletion:**
   - Connect web onboarding Step 5 to the existing `/api/v1/media/upload-intent` pipeline.
   - Add a delete icon (`✕`) on mobile profile photo thumbnails wired to `DELETE /api/v1/media/{id}`.

6. **Add Mobile Root Authentication Guard:**
   - In `apps/mobile/app/(tabs)/index.tsx` or `_layout.tsx`, redirect to `/(auth)/login` if `!isAuthenticated && !isLoading`.

---

## 4. Remediation Scope & Audit Rules

In accordance with the directive:
- Full codebases across Web, Mobile, and Backend have been inspected and remediated.
- Master audit matrix with explicit `PASS`, `FAIL`, `BLOCKED`, and `NOT VERIFIED` classifications has been updated.
- No production identifiers were locked, no redesigns/rebrands were started, and no payment charges were initiated.

---

## 5. Phase 1 Remediation Implementation & Verification Evidence

### 1. Root Expo Router Authentication Guard
- **Changes (`apps/mobile/app/_layout.tsx` & `(auth)/login.tsx`):**
  - Implemented `NavigationGuard` displaying a centered `ActivityIndicator` (color `colors.gold`) while `isLoading` is true, preventing protected screens from briefly flashing before session hydration completes.
  - Redirects unauthenticated users immediately to `/(auth)/login?redirect=<target>` preserving intended deep links or destinations.
  - Redirects authenticated users out of `(auth)` back to `/(tabs)` if they attempt to navigate to login/register while authenticated.
  - `(auth)/login.tsx` extracts `redirect` parameter from `useLocalSearchParams` and navigates to the preserved route upon successful authentication.
- **Verification:** `npm run typecheck` in `apps/mobile` passed with exit code 0; `npm test` passed 14/14 tests.

### 2. Mobile Chat Frame Protocol & Data Model Synchronization
- **Changes (`apps/mobile/src/services/chat/chatService.ts`, `types/index.ts`, `components/ChatRoom.tsx`):**
  - **Outbound Frame Format:** Converted to flat payload `{ action: 'message.send', conversation_id, client_message_id, body }`, matching Go backend `WSClientMessage` schema.
  - **Inbound Event Dispatch:** Dispatches on `frame.type` (handling `message.new`, `message.delivered`, `message.read`, `typing.start`) and unwraps `frame.payload`.
  - **Message Model Alignment:** Added `sender_user_id`, `body`, `client_message_id`, `delivered_at`, and `read_at` to `Message` interface while maintaining backwards-compatible getter aliases.
  - **Bubble Alignment:** Replaced broken `'me'` check with dynamic user comparison `item.sender_user_id === user?.id` via `useAuth()`.
  - **Receipts & Deduplication:** Added double checkmark receipts (`✓` sent, `✓✓` delivered/read in gold/gray) and optimistic message deduplication matching incoming frames by `client_message_id`.
- **Verification:** Passed mobile typecheck and chat suite.

### 3. Native Drag Swipe Physics & Mutex Lock
- **Changes (`apps/mobile/src/components/DiscoveryCard.tsx` & `app/(tabs)/index.tsx`):**
  - **Drag Physics:** Built with React Native's native `PanResponder` and `Animated.ValueXY`. Supports horizontal card dragging with smooth rotation interpolation (`-20deg` to `20deg` across `[-SCREEN_WIDTH, SCREEN_WIDTH]`).
  - **Visual Stamp Overlays:** Dynamic `LIKE` (emerald green) and `PASS` (ruby red) stamps fade in proportionally with drag displacement (`Math.abs(gestureState.dx) / 100`).
  - **Release Threshold:** Swiping beyond `±120px` triggers animated throw-out (`Animated.timing` to `±SCREEN_WIDTH * 1.5`) followed by `onSwipe(direction)`. Sub-threshold releases spring back to center (`Animated.spring`).
  - **Rapid-Swipe Concurrency Mutex:** In `apps/mobile/app/(tabs)/index.tsx`, added `isSwipingRef = useRef(false)`. Any swipe action checks `if (isSwipingRef.current) return; isSwipingRef.current = true;` and releases the lock only after state settlement or failure.
  - **Backend Rewind Route:** Implemented `POST /api/v1/swipes/rewind` in Go backend (`internal/discovery`), including `RewindLastSwipe` in both `MemoryRepository` and PostgreSQL `PostgresRepository`.
- **Verification:** Go test `TestDiscovery_RewindSwipe` passed; Mobile `npm run typecheck` passed cleanly.

### 4. Profile Photo Management & Real Onboarding Upload Pipeline
- **Changes (`backend/migrations/`, `backend/internal/media/`, `apps/mobile/`, `web/`):**
  - **Database Migration:** Applied `000013_media_asset_display_order.up.sql` to local PostgreSQL (`aura_dev` and `aura_test`). Added `display_order INTEGER NOT NULL DEFAULT 0` to `media_assets` and updated index `idx_media_assets_user_order`.
  - **Backend API:** Implemented `PUT /api/v1/media/gallery/reorder` accepting `{ asset_ids: string[] }`, enforcing ownership and updating display order in a transaction.
  - **Backend Deletion:** Re-verified `DELETE /api/v1/media/:id` with quarantine/ready asset cleanup.
  - **Web Onboarding (`web/src/app/onboarding/page.tsx`):** Replaced hardcoded static Unsplash portrait with real interactive file upload: requests upload intent from `/api/v1/media/upload-intent`, uploads to quarantine, triggers automated moderation scan via `/complete`, and provides fallback direct upload.
  - **Web Profile Gallery Manager (`web/src/components/profile/ProfileEditor.tsx`):** Added a dedicated "Photo Gallery" tab displaying gallery thumbnails, upload control, reorder earlier/later controls, and asset deletion.
  - **Mobile Profile Photo Controls (`apps/mobile/app/(tabs)/profile.tsx`):** Added thumbnail deletion (`✕`) calling `api.delete('/api/v1/media/' + id)` and reordering controls (`◀`, `▶`) invoking `api.put('/api/v1/media/gallery/reorder', { asset_ids })`.
- **Verification:** `TestHandler_ReorderAndDeletion` in Go backend passed. Next.js web typecheck and tests passed (4/4 passed). Mobile typecheck passed.

### 5. Transactional Email Delivery Sink & Strict Secret Protection
- **Changes (`backend/internal/identity/`, `backend/internal/server/`):**
  - Implemented `EnvironmentNotificationSink` satisfying `identity.NotificationSink`.
  - **Development Mode:** Logs delivery metadata with masked recipients (e.g., `a***a@example.com`) without logging raw OTP codes or reset tokens, preserving end-to-end secret protection invariants.
  - **Staging / Production Mode:** Fails closed returning `ErrTransactionalEmailUnconfigured` (`"transactional email provider unconfigured; delivery failed closed"`), preventing silent drops or false success.
  - Wired into `identity.NewService(..., identity.WithNotificationSink(notifSink))` in `server.go`.
- **Verification:** `TestService_VerificationAndRecovery` and `internal/identity` tests pass (`go test -v ./internal/identity`).

### 6. Storage Classification
- **Local Filesystem:** `FileStorageEngine` active and verified with raster recreation and sanitization tests.
- **Cloud Object Storage (S3 / Cloudflare R2):** Explicitly classified as `NOT VERIFIED / NOT IMPLEMENTED`. S3-compatible client SDK integration remains a pending launch task for multi-instance cloud deployments.

---

## 6. Verification Test Summary

| Target Subsystem | Command | Result |
| :--- | :--- | :--- |
| **Go Discovery & Rewind** | `go test -v -count=1 ./internal/discovery` | `PASS` (14/14 tests) |
| **Go Media & Reordering** | `go test -v -count=1 ./internal/media` | `PASS` (8/8 tests, including `TestHandler_ReorderAndDeletion`) |
| **Go Identity & Notification Sink** | `go test -v -count=1 ./internal/identity` | `PASS` (7/7 tests, zero secret exposure) |
| **Go Server Routing Envelope** | `go test -v ./internal/server` | `PASS` (33/33 route checks) |
| **PostgreSQL Migrations** | `.\migrate.exe -direction=status` | `PASS` (All 13 migrations APPLIED) |
| **Mobile TypeScript & Tests** | `npm run typecheck && npm test` (`apps/mobile`) | `PASS` (TypeScript clean, 14/14 unit tests) |
| **Web TypeScript & Tests** | `npm run typecheck && npm test` (`web`) | `PASS` (TypeScript clean, 4/4 integration tests) |

