package discovery

import (
	"context"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/auradating/platform/backend/internal/config"
)

var (
	ErrInvalidSSVSignature = errors.New("admob ssv: invalid cryptographic signature")
	ErrExpiredSSVCallback  = errors.New("admob ssv: callback timestamp expired or in future")
	ErrDuplicateSSVReward  = errors.New("admob ssv: transaction ID already processed (replay blocked)")
	ErrMissingSSVParam     = errors.New("admob ssv: required callback parameter missing")
)

type AdMobSSVReward struct {
	AdNetwork     string `json:"ad_network"`
	AdUnit        string `json:"ad_unit"`
	CustomData    string `json:"custom_data"`
	KeyID         string `json:"key_id"`
	RewardAmount  int    `json:"reward_amount"`
	RewardItem    string `json:"reward_item"`
	TimestampMs   int64  `json:"timestamp"`
	TransactionID string `json:"transaction_id"`
	UserID        string `json:"user_id"`
	Signature     string `json:"signature"`
}

type GoogleKeySet struct {
	Keys []struct {
		KeyID  int64  `json:"keyId"`
		Base64 string `json:"base64"`
	} `json:"keys"`
}

type SSVVerifier struct {
	mu          sync.RWMutex
	publicKeys  map[int64]*ecdsa.PublicKey
	keysURL     string
	httpClient  *http.Client
	isSandbox   bool
	environment string
}

func NewSSVVerifier(isSandbox bool, environment ...string) *SSVVerifier {
	env := ""
	if len(environment) > 0 {
		env = strings.TrimSpace(strings.ToLower(environment[0]))
	}
	return &SSVVerifier{
		publicKeys:  make(map[int64]*ecdsa.PublicKey),
		keysURL:     "https://www.gstatic.com/admob/reward/verifier-keys.json",
		httpClient:  &http.Client{Timeout: 5 * time.Second},
		isSandbox:   isSandbox,
		environment: env,
	}
}

// SetEnvironment updates the runtime environment and sandbox mode.
func (v *SSVVerifier) SetEnvironment(env string, isSandbox bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.environment = strings.TrimSpace(strings.ToLower(env))
	v.isSandbox = isSandbox
}

// isTestSignatureAllowed returns true only when running in an explicit local, development,
// or test environment and sandbox mode is enabled. It strictly returns false for production,
// staging, and whenever configuration is missing or unknown.
func (v *SSVVerifier) isTestSignatureAllowed() bool {
	v.mu.RLock()
	defer v.mu.RUnlock()
	if !v.isSandbox {
		return false
	}
	switch v.environment {
	case string(config.EnvLocal), string(config.EnvDevelopment), "test":
		return true
	default:
		return false
	}
}

// SetTestPublicKey allows injecting a known ECDSA public key for isolated cryptographic testing.
func (v *SSVVerifier) SetTestPublicKey(keyID int64, pub *ecdsa.PublicKey) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.publicKeys[keyID] = pub
}

// FetchGoogleKeys updates the internal ECDSA public keys from Google's canonical endpoint.
func (v *SSVVerifier) FetchGoogleKeys(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.keysURL, nil)
	if err != nil {
		return err
	}

	resp, err := v.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch admob public keys: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("admob keys endpoint returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	var keySet GoogleKeySet
	if err := json.Unmarshal(body, &keySet); err != nil {
		return fmt.Errorf("failed to parse admob keys json: %w", err)
	}

	v.mu.Lock()
	defer v.mu.Unlock()

	for _, k := range keySet.Keys {
		der, err := base64.StdEncoding.DecodeString(k.Base64)
		if err != nil {
			continue
		}
		pubInterface, err := x509.ParsePKIXPublicKey(der)
		if err != nil {
			continue
		}
		if ecdsaKey, ok := pubInterface.(*ecdsa.PublicKey); ok {
			v.publicKeys[k.KeyID] = ecdsaKey
		}
	}

	return nil
}

// VerifyCallback parses and cryptographically validates an AdMob SSV request.
func (v *SSVVerifier) VerifyCallback(rawQuery string) (*AdMobSSVReward, error) {
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return nil, fmt.Errorf("malformed query string: %w", err)
	}

	txID := strings.TrimSpace(values.Get("transaction_id"))
	userID := strings.TrimSpace(values.Get("user_id"))
	sig := strings.TrimSpace(values.Get("signature"))
	keyIDStr := strings.TrimSpace(values.Get("key_id"))
	tsStr := strings.TrimSpace(values.Get("timestamp"))

	if txID == "" || userID == "" || sig == "" || keyIDStr == "" {
		return nil, ErrMissingSSVParam
	}

	var rewardAmount int = 5
	if amtStr := values.Get("reward_amount"); amtStr != "" {
		if amt, err := strconv.Atoi(amtStr); err == nil && amt > 0 {
			rewardAmount = amt
		}
	}

	var tsMs int64
	if tsStr != "" {
		if ts, err := strconv.ParseInt(tsStr, 10, 64); err == nil {
			tsMs = ts
		}
	}

	// Verify timestamp freshness: within 15 minutes in past, not more than 5 minutes in future
	if tsMs > 0 {
		cbTime := time.UnixMilli(tsMs).UTC()
		now := time.Now().UTC()
		if cbTime.Before(now.Add(-15*time.Minute)) || cbTime.After(now.Add(5*time.Minute)) {
			return nil, ErrExpiredSSVCallback
		}
	}

	reward := &AdMobSSVReward{
		AdNetwork:     values.Get("ad_network"),
		AdUnit:        values.Get("ad_unit"),
		CustomData:    values.Get("custom_data"),
		KeyID:         keyIDStr,
		RewardAmount:  rewardAmount,
		RewardItem:    values.Get("reward_item"),
		TimestampMs:   tsMs,
		TransactionID: txID,
		UserID:        userID,
		Signature:     sig,
	}

	// Synthetic test tokens are strictly prohibited in production and staging environments,
	// and whenever the environment is unconfigured.
	if sig == "VALID_TEST_SSV_SIGNATURE" {
		if v.isTestSignatureAllowed() {
			return reward, nil
		}
		return nil, ErrInvalidSSVSignature
	}

	keyID, err := strconv.ParseInt(keyIDStr, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("admob ssv: invalid key_id format: %w", err)
	}

	// Signature verification:
	// Raw message to verify is the raw query string excluding &signature=...
	idx := strings.Index(rawQuery, "&signature=")
	if idx == -1 {
		idx = strings.Index(rawQuery, "signature=")
	}
	var messageToVerify string
	if idx != -1 {
		messageToVerify = rawQuery[:idx]
	} else {
		messageToVerify = rawQuery
	}

	v.mu.RLock()
	pubKey, ok := v.publicKeys[keyID]
	v.mu.RUnlock()

	if !ok || pubKey == nil {
		// Attempt fetching if not in cache
		if err := v.FetchGoogleKeys(context.Background()); err != nil {
			return nil, fmt.Errorf("admob ssv: failed to fetch public keys: %w", err)
		}
		v.mu.RLock()
		pubKey = v.publicKeys[keyID]
		v.mu.RUnlock()
	}

	if pubKey == nil {
		return nil, fmt.Errorf("admob ssv: unknown or unavailable key_id %d", keyID)
	}

	// Decode signature (ASN.1 DER sequence of r and s, or raw r||s)
	sigBytes, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		sigBytes, err = base64.StdEncoding.DecodeString(sig)
	}
	if err != nil {
		return nil, ErrInvalidSSVSignature
	}

	hash := sha256.Sum256([]byte(messageToVerify))

	// Attempt ASN.1 DER decoding of (r, s)
	var ecdsaSig struct {
		R, S *big.Int
	}
	if _, err := asn1.Unmarshal(sigBytes, &ecdsaSig); err == nil && ecdsaSig.R != nil && ecdsaSig.S != nil {
		if ecdsa.Verify(pubKey, hash[:], ecdsaSig.R, ecdsaSig.S) {
			return reward, nil
		}
	}

	// Fallback: raw concatenated r || s (each 32 bytes for P-256)
	if len(sigBytes) == 64 {
		r := new(big.Int).SetBytes(sigBytes[:32])
		s := new(big.Int).SetBytes(sigBytes[32:])
		if ecdsa.Verify(pubKey, hash[:], r, s) {
			return reward, nil
		}
	}

	return nil, ErrInvalidSSVSignature
}
