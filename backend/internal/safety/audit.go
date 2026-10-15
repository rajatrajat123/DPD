package safety

import (
	"context"
	"net"
	"strings"
	"time"
)

// Sensitive keys that must be redacted from audit log metadata
var sensitiveKeys = []string{
	"password",
	"token",
	"secret",
	"authorization",
	"jwt",
	"credit_card",
	"card_number",
	"cvv",
	"ssn",
	"id_image",
	"document",
	"biometric",
	"raw_body",
	"chat_content",
}

// SanitizeAuditMetadata removes any confidential passwords, tokens, payment credentials, or raw PII.
func SanitizeAuditMetadata(raw map[string]any) map[string]any {
	if raw == nil {
		return make(map[string]any)
	}

	sanitized := make(map[string]any, len(raw))
	for k, v := range raw {
		lowerK := strings.ToLower(k)
		isSensitive := false
		for _, s := range sensitiveKeys {
			if strings.Contains(lowerK, s) {
				isSensitive = true
				break
			}
		}

		if isSensitive {
			sanitized[k] = "[REDACTED]"
			continue
		}

		// Recursively sanitize nested maps
		if nestedMap, ok := v.(map[string]any); ok {
			sanitized[k] = SanitizeAuditMetadata(nestedMap)
		} else {
			sanitized[k] = v
		}
	}
	return sanitized
}

// PseudonymizeIP masks client IP addresses for privacy compliance while retaining subnet diagnostic capability.
func PseudonymizeIP(ipStr string) string {
	ipStr = strings.TrimSpace(ipStr)
	if ipStr == "" {
		return ""
	}

	// Remove port if present
	host, _, err := net.SplitHostPort(ipStr)
	if err == nil {
		ipStr = host
	}

	ip := net.ParseIP(ipStr)
	if ip == nil {
		return "0.0.0.0"
	}

	if ipv4 := ip.To4(); ipv4 != nil {
		// Mask the last octet (e.g. 192.168.1.123 -> 192.168.1.0)
		ipv4[3] = 0
		return ipv4.String()
	}

	// IPv6: zero out last 80 bits, retaining top 48 bits (site prefix)
	for i := 6; i < 16; i++ {
		ip[i] = 0
	}
	return ip.String()
}

// AuditLogger records tamper-evident audit events
type AuditLogger interface {
	Record(ctx context.Context, log *SecurityAuditLog) error
}

type ServiceAuditLogger struct {
	repo Repository
}

func NewServiceAuditLogger(repo Repository) *ServiceAuditLogger {
	return &ServiceAuditLogger{repo: repo}
}

func (s *ServiceAuditLogger) Record(ctx context.Context, log *SecurityAuditLog) error {
	if log == nil {
		return nil
	}

	// Sanitize metadata & pseudonymize IP
	log.Metadata = SanitizeAuditMetadata(log.Metadata)
	log.IPAddress = PseudonymizeIP(log.IPAddress)
	if log.CreatedAt.IsZero() {
		log.CreatedAt = time.Now().UTC()
	}

	return s.repo.InsertAuditLog(ctx, log)
}
