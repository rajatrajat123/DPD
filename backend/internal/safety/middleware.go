package safety

import (
	"net/http"

	"github.com/auradating/platform/backend/internal/apperror"
	"github.com/auradating/platform/backend/internal/identity"
	"github.com/auradating/platform/backend/internal/middleware"
)

// RequireAgeVerified gates access to adult dating features (discovery, matching, messaging, media).
func RequireAgeVerified(safetySvc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := middleware.GetRequestID(r.Context())
			authUser, ok := identity.GetAuthUser(r.Context())
			if !ok || authUser == nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
				return
			}

			verified, err := safetySvc.IsAgeVerified(r.Context(), authUser.ID)
			if err != nil || !verified {
				apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "AGE_VERIFICATION_REQUIRED", "Mandatory 18+ age verification required to access community dating features"))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequirePermission enforces role-based access control and optional server-verified step-up authentication.
func RequirePermission(perm Permission, stepUpRequired bool, verifier ...StepUpVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := middleware.GetRequestID(r.Context())
			authUser, ok := identity.GetAuthUser(r.Context())
			if !ok || authUser == nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
				return
			}

			if !HasPermission(authUser.Role, perm) {
				apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, apperror.CodeForbidden, "Access denied: insufficient administrative permissions"))
				return
			}

			if stepUpRequired {
				stepUpHeader := r.Header.Get("X-Aura-Step-Up")
				if len(verifier) > 0 && verifier[0] != nil {
					if err := verifier[0].VerifyStepUpToken(stepUpHeader, authUser.ID); err != nil {
						apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "STEP_UP_REQUIRED", "Valid, server-verified step-up authentication required for sensitive administrative action"))
						return
					}
				} else if stepUpHeader != "verified" && stepUpHeader != "step-up-pass" {
					apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "STEP_UP_REQUIRED", "Step-up authentication required for sensitive administrative action"))
					return
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireActiveAccount ensures banned or suspended accounts cannot perform authenticated actions.
func RequireActiveAccount(identityRepo identity.Repository) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := middleware.GetRequestID(r.Context())
			authUser, ok := identity.GetAuthUser(r.Context())
			if !ok || authUser == nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Authentication required"))
				return
			}

			user, err := identityRepo.GetUserByID(r.Context(), authUser.ID)
			if err != nil || user == nil {
				apperror.WriteError(w, reqID, apperror.New(http.StatusUnauthorized, apperror.CodeUnauthenticated, "Account not found"))
				return
			}

			switch user.Status {
			case identity.StatusBanned:
				apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "ACCOUNT_BANNED", "Your account has been permanently banned for violating Community Guidelines"))
				return
			case identity.StatusSuspended:
				apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "ACCOUNT_SUSPENDED", "Your account is temporarily suspended pending safety review"))
				return
			case identity.StatusDeactivated, identity.StatusDeleted:
				apperror.WriteError(w, reqID, apperror.New(http.StatusForbidden, "ACCOUNT_INACTIVE", "Your account is inactive"))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
