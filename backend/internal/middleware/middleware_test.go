package middleware

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestID_GeneratesOrPreservesID(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(GetRequestID(r.Context())))
	}))

	// 1. Generates UUID when missing
	req1 := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, req1)

	gotID := rec1.Header().Get(HeaderRequestID)
	if len(gotID) != 36 {
		t.Errorf("expected generated 36-char UUID, got %q", gotID)
	}

	// 2. Preserves valid caller-supplied X-Request-ID
	req2 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req2.Header.Set(HeaderRequestID, "trace-abc-999")
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	if rec2.Header().Get(HeaderRequestID) != "trace-abc-999" {
		t.Errorf("expected preserved X-Request-ID trace-abc-999, got %q", rec2.Header().Get(HeaderRequestID))
	}

	// 3. Rejects header injection characters
	req3 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req3.Header.Set(HeaderRequestID, "bad\r\nheader:injected")
	rec3 := httptest.NewRecorder()
	handler.ServeHTTP(rec3, req3)

	if strings.Contains(rec3.Header().Get(HeaderRequestID), "bad") {
		t.Errorf("expected malicious request ID to be replaced")
	}
}

func TestRecoverer_ReturnsStandard500EnvelopeOnPanic(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	handler := RequestID(Recoverer(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("simulated failure")
	})))

	req := httptest.NewRequest(http.MethodGet, "/boom", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on panic, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "INTERNAL_SERVER_ERROR") {
		t.Errorf("expected INTERNAL_SERVER_ERROR JSON envelope, got %s", rec.Body.String())
	}
}

func TestCORS_AllowedOrigin(t *testing.T) {
	allowed := []string{"http://localhost:3000", "http://localhost:8081"}
	handler := CORS(allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	// 1. Preflight OPTIONS request
	optReq := httptest.NewRequest(http.MethodOptions, "/api/v1/test", nil)
	optReq.Header.Set("Origin", "http://localhost:3000")
	optRec := httptest.NewRecorder()
	handler.ServeHTTP(optRec, optReq)

	if optRec.Code != http.StatusNoContent {
		t.Errorf("expected 204 No Content for preflight, got %d", optRec.Code)
	}
	if optRec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Errorf("expected Access-Control-Allow-Origin http://localhost:3000, got %q", optRec.Header().Get("Access-Control-Allow-Origin"))
	}
	if optRec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Errorf("expected Access-Control-Allow-Credentials true, got %q", optRec.Header().Get("Access-Control-Allow-Credentials"))
	}

	// 2. Normal GET request
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	getReq.Header.Set("Origin", "http://localhost:8081")
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d", getRec.Code)
	}
	if getRec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8081" {
		t.Errorf("expected Access-Control-Allow-Origin http://localhost:8081, got %q", getRec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCORS_DisallowedOrigin(t *testing.T) {
	allowed := []string{"http://localhost:3000"}
	handler := CORS(allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	// 1. Preflight from untrusted origin is forbidden
	optReq := httptest.NewRequest(http.MethodOptions, "/api/v1/test", nil)
	optReq.Header.Set("Origin", "https://attacker.com")
	optRec := httptest.NewRecorder()
	handler.ServeHTTP(optRec, optReq)

	if optRec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for untrusted origin preflight, got %d", optRec.Code)
	}
	if optRec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("expected empty Access-Control-Allow-Origin for untrusted preflight, got %q", optRec.Header().Get("Access-Control-Allow-Origin"))
	}

	// 2. Normal GET from untrusted origin does NOT receive CORS header
	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	getReq.Header.Set("Origin", "https://attacker.com")
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)

	if getRec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("expected empty Access-Control-Allow-Origin for untrusted GET, got %q", getRec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCORS_WildcardInAllowedListDoesNotMatchArbitraryOrigin(t *testing.T) {
	allowed := []string{"*", "http://localhost:3000"}
	handler := CORS(allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/test", nil)
	req.Header.Set("Origin", "https://malicious.org")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden when matching against wildcard, got %d", rec.Code)
	}
}

func TestCORS_NonBrowserPassThrough(t *testing.T) {
	allowed := []string{"http://localhost:3000"}
	handler := CORS(allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("native-app-response"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d", rec.Code)
	}
	if rec.Body.String() != "native-app-response" {
		t.Errorf("expected response body 'native-app-response', got %q", rec.Body.String())
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("expected no CORS header for non-browser request, got %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

