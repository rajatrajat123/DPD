package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrResendDeliveryFailed = errors.New("failed to deliver transactional email via Resend")
	ErrInvalidRecipient     = errors.New("invalid or empty recipient email address")
)

// HTTPTransport abstracts HTTP client requests for deterministic unit testing.
type HTTPTransport interface {
	Do(req *http.Request) (*http.Response, error)
}

// ResendEmailPayload represents the JSON payload expected by Resend's /emails endpoint.
type ResendEmailPayload struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

// ResendEmailResponse represents the JSON response returned by Resend upon success.
type ResendEmailResponse struct {
	ID string `json:"id"`
}

// ResendErrorResponse represents the JSON error structure returned by Resend.
type ResendErrorResponse struct {
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
	Name       string `json:"name"`
}

// ResendNotificationSink implements NotificationDeliverySink using Resend's HTTP API.
// In development/local with no API key, it falls back to safe mock logging.
// In production/staging with no API key, it fails closed with ErrTransactionalEmailUnconfigured.
type ResendNotificationSink struct {
	apiKey       string
	fromEmail    string
	resetURLBase string
	env          string
	logger       *slog.Logger
	httpClient   HTTPTransport
	apiEndpoint  string
}

func NewResendNotificationSink(apiKey, fromEmail, resetURLBase, env string, logger *slog.Logger, transport ...HTTPTransport) *ResendNotificationSink {
	from := strings.TrimSpace(fromEmail)
	if from == "" {
		from = "Aura <security@aura.dating>"
	}

	urlBase := strings.TrimSpace(resetURLBase)
	if urlBase == "" {
		urlBase = "http://192.168.29.15:8080/auth/reset-password"
	}

	var client HTTPTransport = &http.Client{Timeout: 10 * time.Second}
	if len(transport) > 0 && transport[0] != nil {
		client = transport[0]
	}

	if logger == nil {
		logger = slog.Default()
	}

	return &ResendNotificationSink{
		apiKey:       strings.TrimSpace(apiKey),
		fromEmail:    from,
		resetURLBase: urlBase,
		env:          strings.ToLower(strings.TrimSpace(env)),
		logger:       logger,
		httpClient:   client,
		apiEndpoint:  "https://api.resend.com/emails",
	}
}

// SetAPIEndpoint overrides the target URL (useful for integration tests with httptest.Server).
func (s *ResendNotificationSink) SetAPIEndpoint(endpoint string) {
	s.apiEndpoint = endpoint
}

// IsConfigured returns true if a Resend API key is present.
func (s *ResendNotificationSink) IsConfigured() bool {
	return s.apiKey != ""
}

// DeliverPasswordReset sends an account recovery email containing a time-limited reset link.
func (s *ResendNotificationSink) DeliverPasswordReset(ctx context.Context, email, resetToken string) error {
	normalizedEmail := strings.TrimSpace(email)
	if normalizedEmail == "" {
		return ErrInvalidRecipient
	}

	if !s.IsConfigured() {
		if s.env == "production" || s.env == "staging" {
			s.logger.Error("out_of_band_notification_blocked_unconfigured",
				slog.String("env", s.env),
				slog.String("channel", "EMAIL"),
				slog.String("target_masked", maskRecipient(normalizedEmail)),
			)
			return ErrTransactionalEmailUnconfigured
		}

		s.logger.Warn("resend_unconfigured_development_mode",
			slog.String("hint", "RESEND_API_KEY is not configured in backend/.env; email was not dispatched to Gmail"),
			slog.String("target_masked", maskRecipient(normalizedEmail)),
		)
		s.logger.Info("dev_notification_sink_delivered_password_reset",
			slog.String("env", s.env),
			slog.String("target_masked", maskRecipient(normalizedEmail)),
			slog.Int("token_length", len(resetToken)),
		)
		return nil
	}

	// Construct password reset URL
	resetURL := s.buildResetURL(resetToken)

	subject := "Reset your Aura password"
	textBody := fmt.Sprintf(
		"AURA — Exclusive LGBTQ+ Dating\n\n"+
			"Password Reset Request\n\n"+
			"We received a request to reset the password for your Aura account.\n"+
			"Use the following link to choose a new password:\n\n%s\n\n"+
			"This link will expire in 1 hour and can only be used once.\n\n"+
			"If you did not request this reset, your account is safe and you can safely ignore this email.\n",
		resetURL,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Aura Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0b0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5f5f7;">
  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background-color: #0b0b0c; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%%" style="max-width: 520px; background-color: #161618; border: 1px solid #2a2a2e; border-radius: 12px; overflow: hidden; padding: 36px 32px;">
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 50%%; border: 1.5px solid #d4af37; color: #d4af37; font-weight: bold; font-size: 20px; text-align: center;">A</div>
              <div style="color: #d4af37; font-size: 20px; font-weight: 700; letter-spacing: 3px; margin-top: 10px;">AURA</div>
              <div style="color: #8e8e93; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px;">Exclusive LGBTQ+ Dating</div>
            </td>
          </tr>
          <tr>
            <td>
              <h1 style="color: #f5f5f7; font-size: 22px; font-weight: 600; margin: 0 0 16px 0; text-align: center;">Reset Your Password</h1>
              <p style="color: #a1a1a6; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                We received a request to reset the password for your Aura account. Click the button below to establish a new password:
              </p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="%s" style="display: inline-block; background-color: #d4af37; color: #0b0b0c; font-weight: 600; font-size: 15px; padding: 14px 32px; border-radius: 8px; text-decoration: none; letter-spacing: 0.5px;">Reset Password</a>
              </div>
              <p style="color: #8e8e93; font-size: 13px; line-height: 1.5; margin: 24px 0 0 0;">
                This recovery link is valid for <strong>1 hour</strong> and can only be used once. If you did not make this request, you can safely ignore this notification.
              </p>
              <hr style="border: none; border-top: 1px solid #2a2a2e; margin: 28px 0 20px 0;">
              <p style="color: #636366; font-size: 11px; line-height: 1.4; margin: 0; text-align: center;">
                If the button above does not work, copy and paste this link into your browser:<br>
                <span style="color: #d4af37; word-break: break-all;">%s</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="color: #48484a; font-size: 12px; margin-top: 24px; text-align: center;">
          &copy; Aura Dating. All rights reserved. Zero-tolerance safety & privacy protection.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`, resetURL, resetURL)

	return s.sendResendEmail(ctx, normalizedEmail, subject, textBody, htmlBody)
}

// DeliverVerificationOTP sends an email verification code (6-digit numeric OTP).
func (s *ResendNotificationSink) DeliverVerificationOTP(ctx context.Context, target, channel, otp string) error {
	normalizedTarget := strings.TrimSpace(target)
	if normalizedTarget == "" {
		return ErrInvalidRecipient
	}

	if strings.ToUpper(strings.TrimSpace(channel)) != "EMAIL" {
		// Non-email channels (e.g. SMS) are logged or handled by alternative SMS gateways
		if s.logger != nil {
			s.logger.Info("dev_notification_sink_delivered_verification_otp",
				slog.String("env", s.env),
				slog.String("channel", channel),
				slog.String("target_masked", maskRecipient(normalizedTarget)),
				slog.Int("otp_length", len(otp)),
			)
		}
		return nil
	}

	if !s.IsConfigured() {
		if s.env == "production" || s.env == "staging" {
			s.logger.Error("out_of_band_notification_blocked_unconfigured",
				slog.String("env", s.env),
				slog.String("channel", "EMAIL"),
				slog.String("target_masked", maskRecipient(normalizedTarget)),
			)
			return ErrTransactionalEmailUnconfigured
		}

		s.logger.Info("dev_notification_sink_delivered_verification_otp",
			slog.String("env", s.env),
			slog.String("channel", "EMAIL"),
			slog.String("target_masked", maskRecipient(normalizedTarget)),
			slog.Int("otp_length", len(otp)),
		)
		return nil
	}

	subject := fmt.Sprintf("Your Aura Verification Code: %s", otp)
	textBody := fmt.Sprintf(
		"AURA — Exclusive LGBTQ+ Dating\n\n"+
			"Your verification code is: %s\n\n"+
			"This code will expire in 15 minutes. Enter this code to verify your email address.\n"+
			"Do not share this code with anyone.\n",
		otp,
	)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Aura Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b0b0c; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f5f5f7;">
  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background-color: #0b0b0c; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%%" style="max-width: 480px; background-color: #161618; border: 1px solid #2a2a2e; border-radius: 12px; padding: 32px 28px; text-align: center;">
          <tr>
            <td>
              <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 50%%; border: 1.5px solid #d4af37; color: #d4af37; font-weight: bold; font-size: 18px;">A</div>
              <h2 style="color: #f5f5f7; font-size: 20px; margin: 16px 0 8px 0;">Verify Your Email</h2>
              <p style="color: #a1a1a6; font-size: 14px; margin: 0 0 24px 0;">Enter this code in Aura to complete your verification:</p>
              <div style="background-color: #1c1c1e; border: 1px solid #d4af37; border-radius: 8px; padding: 16px; margin: 0 auto 24px auto; max-width: 240px;">
                <span style="font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #d4af37;">%s</span>
              </div>
              <p style="color: #8e8e93; font-size: 12px; margin: 0;">Valid for 15 minutes. Never share this code.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`, otp)

	return s.sendResendEmail(ctx, normalizedTarget, subject, textBody, htmlBody)
}

func (s *ResendNotificationSink) sendResendEmail(ctx context.Context, toEmail, subject, textBody, htmlBody string) error {
	payload := ResendEmailPayload{
		From:    s.fromEmail,
		To:      []string{toEmail},
		Subject: subject,
		HTML:    htmlBody,
		Text:    textBody,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal email payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.apiEndpoint, bytes.NewReader(payloadBytes))
	if err != nil {
		return fmt.Errorf("failed to build resend request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Aura-Backend-NotificationSink/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		s.logger.Error("resend_email_transport_failed",
			slog.String("target_masked", maskRecipient(toEmail)),
			slog.String("error", err.Error()),
		)
		return fmt.Errorf("%w: %v", ErrResendDeliveryFailed, err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp ResendErrorResponse
		_ = json.Unmarshal(bodyBytes, &errResp)

		errMsg := strings.TrimSpace(errResp.Message)
		if errMsg == "" {
			errMsg = string(bodyBytes)
		}

		s.logger.Error("resend_email_api_error",
			slog.Int("status_code", resp.StatusCode),
			slog.String("target_masked", maskRecipient(toEmail)),
			slog.String("error_message", errMsg),
		)
		return fmt.Errorf("%w: resend API responded with status %d: %s", ErrResendDeliveryFailed, resp.StatusCode, errMsg)
	}

	var successResp ResendEmailResponse
	_ = json.Unmarshal(bodyBytes, &successResp)

	s.logger.Info("resend_email_delivered_successfully",
		slog.String("target_masked", maskRecipient(toEmail)),
		slog.String("resend_id", successResp.ID),
	)

	return nil
}

func (s *ResendNotificationSink) buildResetURL(token string) string {
	base := s.resetURLBase
	escapedToken := url.QueryEscape(token)
	if strings.Contains(base, "?") {
		return fmt.Sprintf("%s&token=%s", base, escapedToken)
	}
	return fmt.Sprintf("%s?token=%s", base, escapedToken)
}
