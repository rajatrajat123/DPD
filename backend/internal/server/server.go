package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/affiliate"
	"github.com/auradating/platform/backend/internal/analytics"
	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/billing"
	"github.com/auradating/platform/backend/internal/chat"
	"github.com/auradating/platform/backend/internal/cms"
	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/configmgr"
	"github.com/auradating/platform/backend/internal/database"
	"github.com/auradating/platform/backend/internal/discovery"
	"github.com/auradating/platform/backend/internal/health"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/media"
	"github.com/auradating/platform/backend/internal/middleware"
	"github.com/auradating/platform/backend/internal/notification"
	"github.com/auradating/platform/backend/internal/safety"
	"github.com/auradating/platform/backend/internal/support"
	"github.com/auradating/platform/backend/migrations"
)

// Server encapsulates the Aura HTTP API router, middleware chain, and net/http server.
type Server struct {
	cfg          *config.Config
	logger       *slog.Logger
	httpServer   *http.Server
	handler      http.Handler
	identityRepo identity.Repository
	identSvc     *identity.Service
	safetyRepo   safety.Repository
	billingRepo  billing.Repository
	mediaSvc     *media.Service
	discoSvc     *discovery.Service
	chatSvc      *chat.Service
	billingSvc   *billing.Service
	affSvc       *affiliate.Service
	safetySvc    *safety.Service
	notifSvc     *notification.Service
	cmsSvc       *cms.Service
	analyticsSvc *analytics.Service
	configSvc    *configmgr.Service
	supportSvc   *support.Service
}

// New constructs a configured HTTP Server with observability middleware, health probes,
// migration diagnostics, Identity/Profile, Media, and Discovery/Matching endpoints.
func New(cfg *config.Config, logger *slog.Logger, pgProbe, redisProbe health.DependencyProbe, customRepo ...identity.Repository) *Server {
	mux := http.NewServeMux()

	healthHandler := health.NewHandler(
		cfg.ServiceName,
		cfg.Version,
		string(cfg.Environment),
		pgProbe,
		redisProbe,
	)

	// Root & versioned health/readiness probes
	mux.HandleFunc("/healthz", healthHandler.Liveness)
	mux.HandleFunc("/readyz", healthHandler.Readiness)
	mux.HandleFunc("/api/v1/healthz", healthHandler.Liveness)
	mux.HandleFunc("/api/v1/readyz", healthHandler.Readiness)

	// Embedded migration manifest diagnostic endpoint
	mux.HandleFunc("/api/v1/migrations/manifest", func(w http.ResponseWriter, r *http.Request) {
		reqID := middleware.GetRequestID(r.Context())
		if r.Method != http.MethodGet {
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Only GET is allowed"))
			return
		}

		specs, err := database.LoadAndValidateMigrations(migrations.FS)
		if err != nil {
			apperror.WriteError(w, reqID, apperror.New(http.StatusInternalServerError, apperror.CodeInternalError, "Failed to load embedded SQL migrations"))
			return
		}

		type migrationSummary struct {
			Version  int    `json:"version"`
			Name     string `json:"name"`
			Checksum string `json:"checksum"`
		}

		items := make([]migrationSummary, 0, len(specs))
		for _, s := range specs {
			items = append(items, migrationSummary{
				Version:  s.Version,
				Name:     s.Name,
				Checksum: s.Checksum,
			})
		}

		apperror.WriteJSON(w, http.StatusOK, map[string]any{
			"count":      len(items),
			"migrations": items,
		})
	})

	var pg *database.Postgres
	if p, ok := pgProbe.(*database.Postgres); ok && p != nil && p.Pool != nil {
		pg = p
	}

	usePostgres := false
	if pg != nil {
		if len(customRepo) > 0 && customRepo[0] != nil {
			if _, isMem := customRepo[0].(*identity.MemoryRepository); !isMem {
				usePostgres = true
			}
		} else {
			usePostgres = true
		}
	}

	// Identity, Profile, LGBTQ+ Taxonomy & Preferences
	var identityRepo identity.Repository
	if len(customRepo) > 0 && customRepo[0] != nil {
		identityRepo = customRepo[0]
	} else if usePostgres {
		identityRepo = identity.NewPostgresRepository(pg.Pool)
	} else {
		identityRepo = identity.NewMemoryRepository()
	}

	// Safety, Moderation, Age Assurance, Audit & Fraud Prevention
	var safetyRepo safety.Repository
	if usePostgres {
		safetyRepo = safety.NewPostgresRepository(pg.Pool)
	} else {
		safetyRepo = safety.NewMemoryRepository()
	}

	var ageProvider safety.AgeAssuranceProvider
	if cfg.Environment == config.EnvProduction {
		ageProvider = safety.NewPersonaAgeAssuranceProvider(cfg.PersonaAPIKey, cfg.PersonaWebhookSecret)
	} else {
		ageProvider = safety.NewDevAgeAssuranceProvider(string(cfg.Environment))
	}

	chatHub := chat.NewHub(cfg.CORSAllowedOrigins, logger)
	safetySvc := safety.NewService(safetyRepo, identityRepo, ageProvider, chatHub, logger)
	safetyHandler := safety.NewHandler(safetySvc, logger)

	stepUpVerifier := safety.NewTokenStepUpVerifier(cfg.JWTSigningSecret)
	safetySvc.SetStepUpVerifier(stepUpVerifier)

	notificationSink := identity.NewResendNotificationSink(
		cfg.ResendAPIKey,
		cfg.ResendFromEmail,
		cfg.PasswordResetURLBase,
		string(cfg.Environment),
		logger,
	)
	identSvc := identity.NewService(
		identityRepo,
		cfg.JWTSigningSecret,
		identity.WithLoginTracker(safetySvc),
		identity.WithNotificationSink(notificationSink),
		identity.WithLogger(logger),
	)
	identHandler := identity.NewHandler(identSvc, cfg.MaxRequestBodyBytes)
	identHandler.SetExpoGoURLBase(cfg.ExpoGoURLBase)

	authMw := identity.RequireAuth(cfg.JWTSigningSecret)
	activeMw := safety.RequireActiveAccount(identityRepo)
	adultMw := safety.RequireAdult(identityRepo)

	communityMw := func(h http.Handler) http.Handler {
		return authMw(activeMw(adultMw(h)))
	}
	memberMw := func(h http.Handler) http.Handler {
		return authMw(activeMw(h))
	}

	// Public Auth Endpoints
	mux.HandleFunc("/api/v1/auth/register", identHandler.Register)
	mux.HandleFunc("/api/v1/auth/login", identHandler.Login)
	mux.HandleFunc("/api/v1/auth/google", identHandler.GoogleAuth)
	mux.HandleFunc("/api/v1/auth/refresh", identHandler.RefreshToken)
	mux.HandleFunc("/api/v1/auth/logout", identHandler.Logout)
	mux.HandleFunc("/api/v1/auth/password-reset/request", identHandler.RequestPasswordReset)
	mux.HandleFunc("/api/v1/auth/password-reset/confirm", identHandler.ConfirmPasswordReset)
	mux.HandleFunc("/auth/reset-password", identHandler.ResetPasswordWebPage)
	mux.HandleFunc("/api/v1/auth/reset-password", identHandler.ResetPasswordWebPage)

	// Authenticated Verification & Step-Up Endpoints
	mux.Handle("/api/v1/auth/verify/send", authMw(http.HandlerFunc(identHandler.SendVerification)))
	mux.Handle("/api/v1/auth/verify/confirm", authMw(http.HandlerFunc(identHandler.ConfirmVerification)))
	mux.Handle("/api/v1/auth/step-up", authMw(http.HandlerFunc(safetyHandler.StepUpAuth)))

	// Authenticated Profile Endpoints
	mux.Handle("/api/v1/profiles/me", memberMw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			identHandler.GetMyProfile(w, r)
		case http.MethodPut:
			identHandler.UpdateMyProfile(w, r)
		default:
			reqID := middleware.GetRequestID(r.Context())
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		}
	})))
	mux.Handle("/api/v1/profiles/me/location", memberMw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			reqID := middleware.GetRequestID(r.Context())
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
			return
		}
		identHandler.UpdateMyLocation(w, r)
	})))
	mux.Handle("/api/v1/profiles/me/preferences", memberMw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			identHandler.GetMyPreferences(w, r)
		case http.MethodPut:
			identHandler.UpdateMyPreferences(w, r)
		default:
			reqID := middleware.GetRequestID(r.Context())
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		}
	})))

	// Media Storage & Processing Pipeline
	var mediaRepo media.Repository
	if usePostgres {
		mediaRepo = media.NewPostgresRepository(pg.Pool)
	} else {
		mediaRepo = media.NewMemoryRepository()
	}

	storageEngine, err := media.NewFileStorageEngine(cfg.MediaStorageDir, cfg.JWTSigningSecret)
	if err != nil {
		logger.Warn("failed_to_initialize_media_storage_engine", slog.String("error", err.Error()))
	}
	mediaProc := media.NewProcessor(
		logger,
		cfg.MediaMaxImageBytes,
		cfg.MediaMaxVideoBytes,
		media.WithVisionAPIKey(cfg.VisionAPIKey),
		media.WithEnvironment(string(cfg.Environment)),
	)
	mediaSvc := media.NewService(
		mediaRepo,
		storageEngine,
		mediaProc,
		logger,
		media.WithRetentionInterval(cfg.MediaRetentionInterval),
		media.WithRetentionBatchSize(cfg.MediaRetentionBatchSize),
	)
	mediaSvc.SetProfileStatusChecker(func(ctx context.Context, userID string) (bool, error) {
		u, err := identityRepo.GetUserByID(ctx, userID)
		if err != nil || u == nil {
			return false, err
		}
		if u.Status != identity.StatusActive {
			return false, nil
		}
		p, err := identityRepo.GetProfile(ctx, userID)
		if err == nil && p != nil && p.IncognitoEnabled {
			return false, nil
		}
		return true, nil
	})
	mediaHandler := media.NewHandler(mediaSvc, storageEngine)

	// Authenticated Media Endpoints
	mux.Handle("/api/v1/media/upload", memberMw(http.HandlerFunc(mediaHandler.Upload)))
	mux.Handle("/api/v1/media/upload-intent", memberMw(http.HandlerFunc(mediaHandler.CreateUploadIntent)))
	mux.Handle("/api/v1/media/gallery/me", memberMw(http.HandlerFunc(mediaHandler.ListMyGallery)))
	mux.Handle("/api/v1/media/gallery/reorder", memberMw(http.HandlerFunc(mediaHandler.ReorderGallery)))
	mux.Handle("/api/v1/profiles/me/gallery", memberMw(http.HandlerFunc(mediaHandler.ListMyGallery)))

	// Public & Signed Media Endpoints
	mux.HandleFunc("/api/v1/media/gallery/user/", mediaHandler.ListUserGallery)
	mux.HandleFunc("/api/v1/media/stream/", mediaHandler.Stream)
	mux.HandleFunc("/api/v1/media/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/complete") {
			memberMw(http.HandlerFunc(mediaHandler.CompleteUpload)).ServeHTTP(w, r)
			return
		}
		switch r.Method {
		case http.MethodGet:
			// Extract and attach authenticated user context when token is present
			authHeader := r.Header.Get("Authorization")
			var tokenStr string
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			} else if cookie, err := r.Cookie("aura_session"); err == nil && cookie.Value != "" {
				tokenStr = cookie.Value
			}
			req := r
			if tokenStr != "" {
				if claims, err := identity.ParseAndVerifyAccessToken(cfg.JWTSigningSecret, tokenStr); err == nil && claims != nil {
					authUser := &identity.AuthUser{
						ID:    claims.Subject,
						Email: claims.Email,
						Role:  claims.Role,
					}
					req = r.WithContext(identity.ContextWithAuthUser(r.Context(), authUser))
				}
			}
			mediaHandler.GetAsset(w, req)
		case http.MethodDelete:
			memberMw(http.HandlerFunc(mediaHandler.DeleteAsset)).ServeHTTP(w, r)
		default:
			reqID := middleware.GetRequestID(r.Context())
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
		}
	})

	// Discovery, Swiping & Mutual Matching
	var discoRepo discovery.Repository
	if usePostgres {
		discoRepo = discovery.NewPostgresRepository(pg.Pool)
	} else {
		discoRepo = discovery.NewMemoryRepository(identityRepo)
	}
	discoSvc := discovery.NewService(discoRepo, identityRepo, mediaSvc, logger,
		discovery.WithEnvironment(string(cfg.Environment)),
	)
	discoSvc.SetAgeChecker(safetySvc.IsAgeVerified)
	discoHandler := discovery.NewHandler(discoSvc)

	// Authenticated Discovery Endpoints
	mux.Handle("/api/v1/discovery/feed", communityMw(http.HandlerFunc(discoHandler.Feed)))
	mux.Handle("/api/v1/discovery/search", communityMw(http.HandlerFunc(discoHandler.Search)))
	mux.Handle("/api/v1/discovery/matching-summary", communityMw(http.HandlerFunc(discoHandler.MatchingSummary)))
	mux.Handle("/api/v1/discovery/likes-you", communityMw(http.HandlerFunc(discoHandler.LikesYou)))
	mux.Handle("/api/v1/discovery/likes-you/reveal", communityMw(http.HandlerFunc(discoHandler.RevealLike)))
	mux.Handle("/api/v1/discovery/message-requests", communityMw(http.HandlerFunc(discoHandler.MessageRequests)))
	mux.Handle("/api/v1/discovery/message-requests/", communityMw(http.HandlerFunc(discoHandler.RespondMessageRequest)))
	mux.Handle("/api/v1/swipes", communityMw(http.HandlerFunc(discoHandler.Swipe)))
	mux.Handle("/api/v1/swipes/rewind", communityMw(http.HandlerFunc(discoHandler.Rewind)))
	mux.Handle("/api/v1/swipes/allowance", communityMw(http.HandlerFunc(discoHandler.Allowance)))
	mux.Handle("/api/v1/matches", communityMw(http.HandlerFunc(discoHandler.Matches)))
	mux.Handle("/api/v1/matches/", communityMw(http.HandlerFunc(discoHandler.MatchDetail)))
	mux.Handle("/api/v1/blocks", communityMw(http.HandlerFunc(discoHandler.Block)))
	mux.HandleFunc("/api/v1/ads/admob/ssv", discoHandler.AdMobSSV)

	// Authenticated Public Profile Lookup
	mux.Handle("/api/v1/profiles/", communityMw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			reqID := middleware.GetRequestID(r.Context())
			apperror.WriteError(w, reqID, apperror.New(http.StatusMethodNotAllowed, apperror.CodeMethodNotAllowed, "Method not allowed"))
			return
		}
		targetID := strings.TrimPrefix(r.URL.Path, "/api/v1/profiles/")
		if targetID == "me" {
			identHandler.GetMyProfile(w, r)
			return
		}
		if targetID == "" || strings.Contains(targetID, "/") {
			reqID := middleware.GetRequestID(r.Context())
			apperror.WriteError(w, reqID, apperror.New(http.StatusBadRequest, apperror.CodeInvalidRequest, "Invalid profile user ID"))
			return
		}
		discoHandler.GetPublicProfile(w, r, targetID)
	})))

	// Notifications & Push Delivery Infrastructure
	var notifRepo notification.Repository
	if usePostgres {
		notifRepo = notification.NewPostgresRepository(pg.Pool)
	} else {
		notifRepo = notification.NewMemoryRepository()
	}
	apnsAdapter := notification.NewAPNsProviderAdapter("", "", "", "", true)
	fcmAdapter := notification.NewFCMProviderAdapter("", "")
	notifSvc := notification.NewService(notifRepo, apnsAdapter, fcmAdapter, logger)
	notifHandler := notification.NewHandler(notifSvc)

	mux.Handle("/api/v1/notifications/preferences", memberMw(http.HandlerFunc(notifHandler.Preferences)))
	mux.Handle("/api/v1/notifications/push-token", memberMw(http.HandlerFunc(notifHandler.RegisterPushToken)))
	mux.Handle("/api/v1/notifications/logs", memberMw(http.HandlerFunc(notifHandler.Logs)))

	// Real-Time Chat, Persistent Messaging & Notifications
	var chatRepo chat.Repository
	if usePostgres {
		chatRepo = chat.NewPostgresRepository(pg.Pool)
	} else {
		chatRepo = chat.NewMemoryRepository(identityRepo)
	}
	mediaSvc.SetAttachmentAccessChecker(chatRepo.CanAccessMediaAsset)
	chatNotif := chat.NewNotificationDispatcher(chatRepo, logger)
	chatSvc := chat.NewService(chatRepo, chatHub, chatNotif, identityRepo, cfg.JWTSigningSecret, logger)
	chatHandler := chat.NewHandler(chatSvc, cfg.JWTSigningSecret)
	chatHandler.SetAccessValidator(chat.AccessValidatorFunc(func(ctx context.Context, userID string) error {
		u, err := identityRepo.GetUserByID(ctx, userID)
		if err != nil || u == nil {
			return errors.New("user account not found")
		}
		if u.Status != identity.StatusActive {
			return fmt.Errorf("account status is %s", u.Status)
		}
		p, err := identityRepo.GetProfile(ctx, userID)
		if err != nil || p == nil || p.Birthdate.IsZero() {
			return errors.New("server-validated birthdate is required")
		}
		if time.Now().UTC().Before(p.Birthdate.AddDate(18, 0, 0)) {
			return errors.New("must be at least 18 years old to access chat")
		}
		return nil
	}))

	// WebSocket Endpoints (/api/v1/ws and /ws/v1)
	mux.HandleFunc("/api/v1/ws", chatHandler.WebSocketUpgrade)
	mux.HandleFunc("/ws/v1", chatHandler.WebSocketUpgrade)

	// Authenticated Conversation & Message Endpoints
	mux.Handle("/api/v1/conversations", communityMw(http.HandlerFunc(chatHandler.ListConversations)))
	mux.Handle("/api/v1/conversations/", communityMw(http.HandlerFunc(chatHandler.ConversationMessages)))
	mux.Handle("/api/v1/message-requests", communityMw(http.HandlerFunc(chatHandler.ListMessageRequests)))
	mux.Handle("/api/v1/message-requests/", communityMw(http.HandlerFunc(chatHandler.HandleMessageRequest)))

	// Billing, Subscriptions, Consumables & Boost Entitlements
	var billingRepo billing.Repository
	if usePostgres {
		billingRepo = billing.NewPostgresRepository(pg.Pool)
	} else {
		billingRepo = billing.NewMemoryRepository()
	}

	stripeAdapter := billing.NewStripeAdapter(cfg.StripeSecretKey, cfg.StripeWebhookSecret)
	appleAdapter := billing.NewAppleAppStoreAdapter(cfg.AppleSharedSecret, cfg.AppleBundleID)
	googleAdapter := billing.NewGooglePlayAdapter(cfg.GooglePlayCredentialsJSON, cfg.GooglePlayPackageName)
	providerRegistry := billing.NewProviderRegistry(stripeAdapter, appleAdapter, googleAdapter)

	billingSvc := billing.NewService(billingRepo, providerRegistry, logger)
	billingHandler := billing.NewHandler(billingSvc, logger)

	discoSvc.SetEntitlementChecker(func(ctx context.Context, userID, code string) bool {
		has, err := billingRepo.HasEntitlement(ctx, userID, code)
		return err == nil && has
	})

	// Public Billing Plans & Storefront Policy
	mux.HandleFunc("/api/v1/billing/plans", billingHandler.Plans)
	mux.HandleFunc("/api/v1/billing/policy", billingHandler.Policy)

	// Webhooks (public with signature verification)
	mux.HandleFunc("/api/v1/billing/webhooks/", billingHandler.Webhook)

	// Authenticated Billing & Subscription Endpoints
	mux.Handle("/api/v1/billing/checkout", memberMw(http.HandlerFunc(billingHandler.Checkout)))
	mux.Handle("/api/v1/billing/verify", memberMw(http.HandlerFunc(billingHandler.Verify)))
	mux.Handle("/api/v1/billing/subscription", memberMw(http.HandlerFunc(billingHandler.Subscription)))
	mux.Handle("/api/v1/billing/subscription/cancel", memberMw(http.HandlerFunc(billingHandler.CancelSubscription)))
	mux.Handle("/api/v1/billing/transactions", memberMw(http.HandlerFunc(billingHandler.Transactions)))
	mux.Handle("/api/v1/billing/entitlements", memberMw(http.HandlerFunc(billingHandler.Entitlements)))

	// Authenticated Profile Boost Endpoints
	mux.Handle("/api/v1/boosts/status", communityMw(http.HandlerFunc(billingHandler.BoostStatus)))
	mux.Handle("/api/v1/boosts/activate", communityMw(http.HandlerFunc(billingHandler.ActivateBoost)))

	// Affiliate Marketing, Commission Engine & Double-Entry Ledger
	var affRepo affiliate.Repository
	if usePostgres {
		affRepo = affiliate.NewPostgresRepository(pg.Pool)
	} else {
		affRepo = affiliate.NewMemoryRepository()
	}

	stripePayoutAdapter := affiliate.NewStripeConnectPayoutAdapter(cfg.StripeSecretKey)
	cryptoPayoutAdapter := affiliate.NewCryptoPayoutAdapter(false, "")
	payoutRegistry := affiliate.NewPayoutRegistry(stripePayoutAdapter, cryptoPayoutAdapter)

	affSvc := affiliate.NewService(affRepo, payoutRegistry, logger)
	affHandler := affiliate.NewHandler(affSvc, logger)
	affHandler.SetStepUpVerifier(stepUpVerifier)

	// Public Referral Link Redirect (e.g. /r/{partner_code})
	mux.HandleFunc("/r/", affHandler.ReferralRedirect)

	// Authenticated Affiliate Endpoints
	mux.Handle("/api/v1/affiliates/register", memberMw(http.HandlerFunc(affHandler.Register)))
	mux.Handle("/api/v1/affiliates/me", memberMw(http.HandlerFunc(affHandler.Me)))
	mux.Handle("/api/v1/affiliates/me/payout-settings", memberMw(http.HandlerFunc(affHandler.UpdatePayoutSettings)))
	mux.Handle("/api/v1/affiliates/campaigns", memberMw(http.HandlerFunc(affHandler.Campaigns)))
	mux.Handle("/api/v1/affiliates/reports/conversions", memberMw(http.HandlerFunc(affHandler.ConversionsReport)))
	mux.Handle("/api/v1/affiliates/ledger/balance", memberMw(http.HandlerFunc(affHandler.LedgerBalance)))
	mux.Handle("/api/v1/affiliates/payouts/request", memberMw(http.HandlerFunc(affHandler.RequestPayout)))
	mux.Handle("/api/v1/affiliates/payouts", memberMw(http.HandlerFunc(affHandler.Payouts)))

	// Admin Affiliate & Ledger Endpoints (RBAC protected)
	mux.Handle("/api/v1/admin/affiliates", authMw(safety.RequirePermission(safety.PermFinanceRead, false)(http.HandlerFunc(affHandler.AdminListAffiliates))))
	mux.Handle("/api/v1/admin/affiliates/", authMw(safety.RequirePermission(safety.PermFinanceRead, false)(http.HandlerFunc(affHandler.AdminUpdateAffiliateStatus))))
	mux.Handle("/api/v1/admin/commission-rules", authMw(safety.RequirePermission(safety.PermFinanceRead, false)(http.HandlerFunc(affHandler.AdminCommissionRules))))
	mux.Handle("/api/v1/admin/payouts", authMw(safety.RequirePermission(safety.PermFinanceApprove, false)(http.HandlerFunc(affHandler.AdminPayouts))))
	mux.Handle("/api/v1/admin/payouts/", authMw(safety.RequirePermission(safety.PermFinanceApprove, false)(http.HandlerFunc(affHandler.AdminPayouts))))

	// Age Assurance & Verification Endpoints
	mux.HandleFunc("/api/v1/age-assurance/webhook/", safetyHandler.AgeVerificationWebhook)
	mux.Handle("/api/v1/age-assurance/session", memberMw(http.HandlerFunc(safetyHandler.StartAgeVerificationSession)))
	mux.Handle("/api/v1/age-assurance/status", memberMw(http.HandlerFunc(safetyHandler.GetAgeVerificationStatus)))

	// Member Safety Reporting & Appeals
	mux.Handle("/api/v1/reports", memberMw(http.HandlerFunc(safetyHandler.SubmitReport)))
	mux.Handle("/api/v1/appeals", authMw(http.HandlerFunc(safetyHandler.Appeals)))
	mux.Handle("/api/v1/appeals/me", authMw(http.HandlerFunc(safetyHandler.Appeals)))

	// Admin Moderation, Appeals, Age Override & Audit Logs (RBAC protected)
	mux.Handle("/api/v1/admin/age-assurance/", authMw(safety.RequirePermission(safety.PermAgeReview, false)(http.HandlerFunc(safetyHandler.AdminOverrideAgeAssurance))))
	mux.Handle("/api/v1/admin/moderation/cases", authMw(safety.RequirePermission(safety.PermModerationRead, false)(http.HandlerFunc(safetyHandler.AdminCases))))
	mux.Handle("/api/v1/admin/moderation/cases/", authMw(safety.RequirePermission(safety.PermModerationRead, false)(http.HandlerFunc(safetyHandler.AdminCases))))
	mux.Handle("/api/v1/admin/moderation/appeals", authMw(safety.RequirePermission(safety.PermModerationRead, false)(http.HandlerFunc(safetyHandler.AdminAppeals))))
	mux.Handle("/api/v1/admin/moderation/appeals/", authMw(safety.RequirePermission(safety.PermModerationAction, false)(http.HandlerFunc(safetyHandler.AdminAppeals))))
	mux.Handle("/api/v1/admin/audit-logs", authMw(safety.RequirePermission(safety.PermAuditRead, false)(http.HandlerFunc(safetyHandler.AdminAuditLogs))))

	// Privacy-First Platform Analytics (RBAC protected)
	var analyticsRepo analytics.Repository
	if usePostgres {
		analyticsRepo = analytics.NewPostgresRepository(pg.Pool)
	} else {
		analyticsRepo = analytics.NewMemoryRepository()
	}
	analyticsSvc := analytics.NewService(analyticsRepo, logger)
	analyticsHandler := analytics.NewHandler(analyticsSvc)

	mux.Handle("/api/v1/admin/analytics/summary", authMw(safety.RequirePermission(safety.PermAuditRead, false)(http.HandlerFunc(analyticsHandler.Summary))))

	// Content Management System (CMS) - Public & Admin
	var cmsRepo cms.Repository
	if usePostgres {
		cmsRepo = cms.NewPostgresRepository(pg.Pool)
	} else {
		cmsRepo = cms.NewMemoryRepository()
	}
	cmsSvc := cms.NewService(cmsRepo, "", logger)
	cmsHandler := cms.NewHandler(cmsSvc, logger)

	mux.HandleFunc("/api/v1/cms/public", cmsHandler.GetPublicContent)
	mux.Handle("/api/v1/admin/cms/content", authMw(safety.RequirePermission(safety.PermCMSWrite, false)(http.HandlerFunc(cmsHandler.AdminContent))))
	mux.Handle("/api/v1/admin/cms/content/", authMw(safety.RequirePermission(safety.PermCMSWrite, false)(http.HandlerFunc(cmsHandler.AdminContent))))
	mux.Handle("/api/v1/admin/cms/media", authMw(safety.RequirePermission(safety.PermCMSWrite, false)(http.HandlerFunc(cmsHandler.AdminMedia))))
	mux.Handle("/api/v1/admin/cms/audit", authMw(safety.RequirePermission(safety.PermAuditRead, false)(http.HandlerFunc(cmsHandler.AdminAudit))))

	// Admin Billing & Financial Ledger (RBAC protected)
	mux.Handle("/api/v1/admin/billing/subscriptions", authMw(safety.RequirePermission(safety.PermFinanceRead, false)(http.HandlerFunc(billingHandler.AdminSubscriptions))))
	mux.Handle("/api/v1/admin/billing/transactions", authMw(safety.RequirePermission(safety.PermFinanceRead, false)(http.HandlerFunc(billingHandler.AdminTransactions))))
	mux.Handle("/api/v1/admin/billing/refund", authMw(safety.RequirePermission(safety.PermFinanceApprove, true, stepUpVerifier)(http.HandlerFunc(billingHandler.AdminRefund))))

	// Admin User Management & Customer Support (RBAC protected)
	mux.Handle("/api/v1/admin/users", authMw(safety.RequirePermission(safety.PermSupportRead, false)(http.HandlerFunc(identHandler.AdminUsers))))
	mux.Handle("/api/v1/admin/users/", authMw(safety.RequirePermission(safety.PermSuperAdmin, true, stepUpVerifier)(http.HandlerFunc(identHandler.AdminUpdateRole))))
	mux.Handle("/api/v1/admin/support/unlock", authMw(safety.RequirePermission(safety.PermSupportAction, false)(http.HandlerFunc(identHandler.AdminSupportUnlock))))
	mux.Handle("/api/v1/admin/support/reset-password", authMw(safety.RequirePermission(safety.PermSupportAction, false)(http.HandlerFunc(identHandler.AdminSupportResetPassword))))

	// Dynamic Platform Configuration (Super Admin RBAC)
	var configRepo configmgr.Repository
	if usePostgres {
		configRepo = configmgr.NewPostgresRepository(pg.Pool)
	} else {
		configRepo = configmgr.NewMemoryRepository()
	}
	configSvc := configmgr.NewService(configRepo)
	configHandler := configmgr.NewHandler(configSvc)

	mux.Handle("/api/v1/admin/config", authMw(safety.RequirePermission(safety.PermSuperAdmin, false)(http.HandlerFunc(configHandler.HandleAdminConfig))))
	mux.Handle("/api/v1/admin/config/", authMw(safety.RequirePermission(safety.PermSuperAdmin, false)(http.HandlerFunc(configHandler.HandleAdminConfig))))

	// Customer Support Operations
	var supportRepo support.Repository
	if usePostgres {
		supportRepo = support.NewPostgresRepository(pg.Pool)
	} else {
		supportRepo = support.NewMemoryRepository()
	}
	supportSvc := support.NewService(supportRepo)
	supportHandler := support.NewHandler(supportSvc)

	// Public Support Endpoint
	mux.HandleFunc("/api/v1/support/tickets/public", supportHandler.PublicSubmitTicket)

	// Member Support Endpoints
	mux.Handle("/api/v1/support/tickets", memberMw(http.HandlerFunc(supportHandler.MemberTickets)))
	mux.Handle("/api/v1/support/tickets/", memberMw(http.HandlerFunc(supportHandler.MemberTicketDetail)))

	// Admin Support Operations Endpoints (RBAC protected)
	mux.Handle("/api/v1/admin/support/teams", authMw(safety.RequirePermission(safety.PermSupportRead, false)(http.HandlerFunc(supportHandler.AdminTeams))))
	mux.Handle("/api/v1/admin/support/teams/", authMw(safety.RequirePermission(safety.PermSupportAction, false)(http.HandlerFunc(supportHandler.AdminTeams))))
	mux.Handle("/api/v1/admin/support/tickets", authMw(safety.RequirePermission(safety.PermSupportRead, false)(http.HandlerFunc(supportHandler.AdminTickets))))
	mux.Handle("/api/v1/admin/support/tickets/", authMw(safety.RequirePermission(safety.PermSupportAction, false)(http.HandlerFunc(supportHandler.AdminTicketOperations))))

	// Fallback handler to enforce standardized JSON 404 envelopes
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		reqID := middleware.GetRequestID(r.Context())
		apperror.WriteError(
			w,
			reqID,
			apperror.New(http.StatusNotFound, apperror.CodeNotFound, fmt.Sprintf("Route %s %s does not exist", r.Method, r.URL.Path)),
		)
	})

	// Assemble middleware stack: RequestID -> Recoverer -> AccessLogger -> CORS -> SecurityHeaders
	var rootHandler http.Handler = mux
	rootHandler = middleware.SecurityHeaders(rootHandler)
	rootHandler = middleware.CORS(cfg.CORSAllowedOrigins)(rootHandler)
	rootHandler = middleware.AccessLogger(logger)(rootHandler)
	rootHandler = middleware.Recoverer(logger)(rootHandler)
	rootHandler = middleware.RequestID(rootHandler)

	httpSrv := &http.Server{
		Addr:              cfg.HTTPAddr(),
		Handler:           rootHandler,
		ReadTimeout:       cfg.ReadTimeout,
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	return &Server{
		cfg:          cfg,
		logger:       logger,
		httpServer:   httpSrv,
		handler:      rootHandler,
		identityRepo: identityRepo,
		identSvc:     identSvc,
		safetyRepo:   safetyRepo,
		billingRepo:  billingRepo,
		mediaSvc:     mediaSvc,
		discoSvc:     discoSvc,
		chatSvc:      chatSvc,
		billingSvc:   billingSvc,
		affSvc:       affSvc,
		safetySvc:    safetySvc,
		notifSvc:     notifSvc,
		cmsSvc:       cmsSvc,
		analyticsSvc: analyticsSvc,
		configSvc:    configSvc,
		supportSvc:   supportSvc,
	}
}

// ConfigService returns the platform configuration service.
func (s *Server) ConfigService() *configmgr.Service {
	return s.configSvc
}

// SupportService returns the customer support service.
func (s *Server) SupportService() *support.Service {
	return s.supportSvc
}

// HTTPServer returns the underlying *http.Server for lifecycle management.
func (s *Server) HTTPServer() *http.Server {
	return s.httpServer
}

// Handler returns the composed root http.Handler for integration testing.
func (s *Server) Handler() http.Handler {
	return s.handler
}

// IdentityRepository returns the configured identity repository.
func (s *Server) IdentityRepository() identity.Repository {
	return s.identityRepo
}

// IdentityService returns the configured identity service.
func (s *Server) IdentityService() *identity.Service {
	return s.identSvc
}

// SafetyRepository returns the configured safety repository.
func (s *Server) SafetyRepository() safety.Repository {
	return s.safetyRepo
}

// BillingRepository returns the configured billing repository.
func (s *Server) BillingRepository() billing.Repository {
	return s.billingRepo
}

// MediaService returns the media service instance for lifecycle management.
func (s *Server) MediaService() *media.Service {
	return s.mediaSvc
}

// DiscoveryService returns the discovery service instance for lifecycle management.
func (s *Server) DiscoveryService() *discovery.Service {
	return s.discoSvc
}

// ChatService returns the chat service instance for lifecycle management.
func (s *Server) ChatService() *chat.Service {
	return s.chatSvc
}

// BillingService returns the billing service instance for lifecycle management.
func (s *Server) BillingService() *billing.Service {
	return s.billingSvc
}

// AffiliateService returns the affiliate service instance for lifecycle management.
func (s *Server) AffiliateService() *affiliate.Service {
	return s.affSvc
}

// SafetyService returns the safety service instance for lifecycle management.
func (s *Server) SafetyService() *safety.Service {
	return s.safetySvc
}

// NotificationService returns the notification service instance for lifecycle management.
func (s *Server) NotificationService() *notification.Service {
	return s.notifSvc
}

// AnalyticsService returns the analytics service instance for lifecycle management.
func (s *Server) AnalyticsService() *analytics.Service {
	return s.analyticsSvc
}

// CMSService returns the CMS service instance for lifecycle management.
func (s *Server) CMSService() *cms.Service {
	return s.cmsSvc
}
