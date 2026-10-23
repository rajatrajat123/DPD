package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/auradating/platform/backend/internal/config"
	"github.com/auradating/platform/backend/internal/database"
)

func main() {
	emailFlag := flag.String("email", "", "Registered email address of the owner account")
	verifyFlag := flag.Bool("verify", false, "Confirm email verification during initial bootstrap")
	statusOnly := flag.Bool("status-only", false, "Only inspect account status and superadmin configuration")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	targetEmail := strings.ToLower(strings.TrimSpace(*emailFlag))
	if targetEmail == "" && !*statusOnly {
		fmt.Println("Usage: go run ./cmd/bootstrap-admin -email <owner@example.com> [-verify] [-status-only]")
		os.Exit(1)
	}

	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Error("failed_to_load_config", slog.String("error", err.Error()))
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pg, err := database.NewPostgres(ctx, cfg)
	if err != nil {
		logger.Error("failed_to_connect_postgres", slog.String("error", err.Error()))
		os.Exit(1)
	}
	defer pg.Close()

	// 1. Check existing SUPER_ADMIN accounts in database
	var superAdminCount int
	err = pg.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM users WHERE role = 'SUPER_ADMIN'").Scan(&superAdminCount)
	if err != nil {
		logger.Error("failed_to_query_super_admins", slog.String("error", err.Error()))
		os.Exit(1)
	}

	fmt.Printf("[AURA BOOTSTRAP] Current SUPER_ADMIN accounts in system: %d\n", superAdminCount)

	if *statusOnly && targetEmail == "" {
		return
	}

	// 2. Query target account
	var userID, email, status, role string
	var emailVerifiedAt *time.Time
	var createdAt time.Time

	query := `SELECT id, email, status, role, email_verified_at, created_at FROM users WHERE email = $1`
	err = pg.Pool.QueryRow(ctx, query, targetEmail).Scan(&userID, &email, &status, &role, &emailVerifiedAt, &createdAt)
	if err != nil {
		fmt.Printf("[AURA BOOTSTRAP] ERROR: User account '%s' was not found in the database.\n", targetEmail)
		os.Exit(1)
	}

	isVerified := emailVerifiedAt != nil
	fmt.Printf("[AURA BOOTSTRAP] Account Found:\n")
	fmt.Printf("  - User ID:      %s\n", userID)
	fmt.Printf("  - Email:        %s\n", email)
	fmt.Printf("  - Status:       %s\n", status)
	fmt.Printf("  - Current Role: %s\n", role)
	fmt.Printf("  - Verified:     %t\n", isVerified)
	if isVerified {
		fmt.Printf("  - Verified At:  %s\n", emailVerifiedAt.Format(time.RFC3339))
	}
	fmt.Printf("  - Created At:   %s\n", createdAt.Format(time.RFC3339))

	if *statusOnly {
		return
	}

	// 3. Safety Guard: Disallow bootstrap if a Super Admin is already configured
	if superAdminCount > 0 && role != "SUPER_ADMIN" {
		fmt.Println("[AURA BOOTSTRAP] SECURITY ABORT: A Super Admin is already configured in this system.")
		fmt.Println("Bootstrap is only permitted for initial setup when zero Super Admins exist.")
		os.Exit(1)
	}

	if role == "SUPER_ADMIN" {
		fmt.Println("[AURA BOOTSTRAP] Account is already configured as SUPER_ADMIN. No action needed.")
		return
	}

	// 4. Verify check
	now := time.Now().UTC()
	if !isVerified {
		if !*verifyFlag {
			fmt.Println("[AURA BOOTSTRAP] ATTENTION: This account email is currently UNVERIFIED.")
			fmt.Println("Required Step: Pass '-verify' to verify the owner email address during this bootstrap,")
			fmt.Println("or complete email OTP verification through the app/API.")
			os.Exit(1)
		}

		// Mark email as verified
		_, err = pg.Pool.Exec(ctx, `UPDATE users SET email_verified_at = $1 WHERE id = $2`, now, userID)
		if err != nil {
			logger.Error("failed_to_update_verification", slog.String("error", err.Error()))
			os.Exit(1)
		}
		// Also mark pending account_verifications
		_, _ = pg.Pool.Exec(ctx, `UPDATE account_verifications SET verified_at = $1 WHERE user_id = $2 AND verified_at IS NULL`, now, userID)
		fmt.Println("[AURA BOOTSTRAP] Account email successfully marked as VERIFIED.")
	}

	// 5. Grant SUPER_ADMIN role
	_, err = pg.Pool.Exec(ctx, `UPDATE users SET role = 'SUPER_ADMIN', updated_at = $1 WHERE id = $2`, now, userID)
	if err != nil {
		logger.Error("failed_to_grant_super_admin", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// 6. Invalidate existing sessions so fresh token with SUPER_ADMIN role is issued
	_, _ = pg.Pool.Exec(ctx, `UPDATE user_sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, now, userID)

	// 7. Write audit log entry
	auditQuery := `
		INSERT INTO security_audit_logs (actor_user_id, actor_role, action, target_type, target_id, outcome, reason, metadata, created_at)
		VALUES ($1, 'SYSTEM_BOOTSTRAP', 'admin.bootstrap_super_admin', 'USER', $2, 'SUCCESS', 'Initial local Super Admin bootstrap for platform owner', '{"bootstrap": true}'::jsonb, $3)
	`
	_, _ = pg.Pool.Exec(ctx, auditQuery, userID, userID, now)

	fmt.Printf("\n[AURA BOOTSTRAP] SUCCESS: Account '%s' (%s) is now granted SUPER_ADMIN!\n", email, userID)
	fmt.Println("Existing sessions have been invalidated. Please log in to receive a fresh Super Admin access token.")
}
