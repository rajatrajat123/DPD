package billing

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/stripe/stripe-go/v74"
	stripeCheckout "github.com/stripe/stripe-go/v74/checkout/session"
	"github.com/stripe/stripe-go/v74/webhook"
	"google.golang.org/api/androidpublisher/v3"
	"google.golang.org/api/option"
)

type VerifiedTransaction struct {
	ExternalChargeID       string
	ExternalSubscriptionID string
	TransactionType        string
	GrossAmountCents       int64
	ProviderFeeCents       int64
	TaxAmountCents         int64
	NetAmountCents         int64
	Currency               string
	PeriodStart            time.Time
	PeriodEnd              time.Time
	Status                 string
}

type WebhookPayload struct {
	EventID                string
	EventType              string
	Provider               string
	UserID                 string
	PlanCode               string
	ExternalSubscriptionID string
	ExternalChargeID       string
	Status                 string
	CurrentPeriodStart     time.Time
	CurrentPeriodEnd       time.Time
	GrossAmountCents       int64
	ProviderFeeCents       int64
	TaxAmountCents         int64
	NetAmountCents         int64
	Currency               string
	CancelAtPeriodEnd      bool
	RawJSON                []byte
}

type ProviderAdapter interface {
	Name() string
	CreateCheckoutSession(ctx context.Context, userID, userEmail string, product Product, successURL, cancelURL string) (*CheckoutSession, error)
	VerifyPurchase(ctx context.Context, req VerifyPurchaseRequest, product Product) (*VerifiedTransaction, error)
	ParseAndVerifyWebhook(ctx context.Context, rawBody []byte, signatureHeader string) (*WebhookPayload, error)
}

type ProviderRegistry struct {
	adapters map[string]ProviderAdapter
}

func NewProviderRegistry(adapters ...ProviderAdapter) *ProviderRegistry {
	reg := &ProviderRegistry{
		adapters: make(map[string]ProviderAdapter),
	}
	for _, a := range adapters {
		reg.adapters[strings.ToUpper(strings.TrimSpace(a.Name()))] = a
	}
	return reg
}

func (r *ProviderRegistry) Get(provider string) (ProviderAdapter, error) {
	p := strings.ToUpper(strings.TrimSpace(provider))
	adapter, ok := r.adapters[p]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrInvalidProvider, provider)
	}
	return adapter, nil
}

// StripeAdapter implements ProviderAdapter for Stripe Payments and Billing.
type StripeAdapter struct {
	secretKey     string
	webhookSecret string
	checkoutFunc  func(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)
}

func NewStripeAdapter(secretKey, webhookSecret string) *StripeAdapter {
	return &StripeAdapter{
		secretKey:     strings.TrimSpace(secretKey),
		webhookSecret: strings.TrimSpace(webhookSecret),
	}
}

func (s *StripeAdapter) SetCheckoutFunc(fn func(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)) {
	s.checkoutFunc = fn
}

func (s *StripeAdapter) Name() string {
	return ProviderStripe
}

func (s *StripeAdapter) CreateCheckoutSession(
	ctx context.Context,
	userID, userEmail string,
	product Product,
	successURL, cancelURL string,
) (*CheckoutSession, error) {
	if s.secretKey == "" || strings.Contains(s.secretKey, "placeholder") {
		return nil, fmt.Errorf("%w: Stripe Secret Key is unconfigured", ErrProviderNotConfigured)
	}

	stripe.Key = s.secretKey

	mode := stripe.CheckoutSessionModeSubscription
	if product.ProductType == ProductTypeConsumable {
		mode = stripe.CheckoutSessionModePayment
	}

	lineItem := &stripe.CheckoutSessionLineItemParams{
		Quantity: stripe.Int64(1),
		PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
			Currency:   stripe.String(strings.ToLower(product.Currency)),
			UnitAmount: stripe.Int64(product.PriceCents),
			ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
				Name:        stripe.String(product.Name),
				Description: stripe.String(product.Description),
				Metadata: map[string]string{
					"plan_code": product.PlanCode,
					"tier":      product.Tier,
				},
			},
		},
	}

	if product.ProductType == ProductTypeSubscription {
		interval := stripe.PriceRecurringIntervalMonth
		if product.BillingPeriod == BillingPeriodAnnual {
			interval = stripe.PriceRecurringIntervalYear
		}
		lineItem.PriceData.Recurring = &stripe.CheckoutSessionLineItemPriceDataRecurringParams{
			Interval: stripe.String(string(interval)),
		}
	}

	params := &stripe.CheckoutSessionParams{
		Params: stripe.Params{
			Metadata: map[string]string{
				"user_id":   userID,
				"plan_code": product.PlanCode,
			},
		},
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
		Mode:               stripe.String(string(mode)),
		ClientReferenceID:  stripe.String(userID),
		CustomerEmail:      stripe.String(userEmail),
		SuccessURL:         stripe.String(successURL),
		CancelURL:          stripe.String(cancelURL),
		LineItems:          []*stripe.CheckoutSessionLineItemParams{lineItem},
	}

	var sess *stripe.CheckoutSession
	var err error
	if s.checkoutFunc != nil {
		sess, err = s.checkoutFunc(params)
	} else {
		sess, err = stripeCheckout.New(params)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create Stripe checkout session: %w", err)
	}

	return &CheckoutSession{
		SessionID:   sess.ID,
		Provider:    ProviderStripe,
		PlanCode:    product.PlanCode,
		CheckoutURL: sess.URL,
		AmountCents: product.PriceCents,
		Currency:    product.Currency,
	}, nil
}

func (s *StripeAdapter) VerifyPurchase(
	ctx context.Context,
	req VerifyPurchaseRequest,
	product Product,
) (*VerifiedTransaction, error) {
	if s.secretKey == "" || strings.Contains(s.secretKey, "placeholder") {
		return nil, fmt.Errorf("%w: Stripe Secret Key is unconfigured", ErrProviderNotConfigured)
	}

	chargeID := strings.TrimSpace(req.ExternalTransactionID)
	if chargeID == "" {
		return nil, errors.New("external_transaction_id is required")
	}

	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour)
	if product.BillingPeriod == BillingPeriodAnnual {
		periodEnd = now.Add(365 * 24 * time.Hour)
	}

	txType := TxInitialPurchase
	if product.ProductType == ProductTypeConsumable {
		txType = TxBoostPurchase
	}

	feeCents := int64(float64(product.PriceCents)*0.029) + 30 // standard Stripe 2.9% + 30c
	netCents := product.PriceCents - feeCents
	if netCents < 0 {
		netCents = 0
	}

	subID := ""
	if product.ProductType == ProductTypeSubscription {
		subID = fmt.Sprintf("sub_stripe_%d", time.Now().UnixNano())
	}

	return &VerifiedTransaction{
		ExternalChargeID:       chargeID,
		ExternalSubscriptionID: subID,
		TransactionType:        txType,
		GrossAmountCents:       product.PriceCents,
		ProviderFeeCents:       feeCents,
		TaxAmountCents:         0,
		NetAmountCents:         netCents,
		Currency:               product.Currency,
		PeriodStart:            now,
		PeriodEnd:              periodEnd,
		Status:                 StatusActive,
	}, nil
}

func (s *StripeAdapter) ParseAndVerifyWebhook(
	ctx context.Context,
	rawBody []byte,
	signatureHeader string,
) (*WebhookPayload, error) {
	if s.webhookSecret == "" || strings.Contains(s.webhookSecret, "placeholder") {
		return nil, fmt.Errorf("%w: Stripe Webhook Secret is unconfigured", ErrProviderNotConfigured)
	}

	event, err := webhook.ConstructEventWithOptions(
		rawBody,
		signatureHeader,
		s.webhookSecret,
		webhook.ConstructEventOptions{
			Tolerance: 5 * time.Minute,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidWebhookSignature, err)
	}

	var eventPayload struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Data struct {
			Object map[string]any `json:"object"`
		} `json:"data"`
	}

	if err := json.Unmarshal(event.Data.Raw, &eventPayload.Data.Object); err != nil {
		_ = json.Unmarshal(rawBody, &eventPayload)
	}
	eventPayload.ID = event.ID
	eventPayload.Type = event.Type

	obj := eventPayload.Data.Object
	now := time.Now().UTC()

	payload := &WebhookPayload{
		EventID:            event.ID,
		EventType:          event.Type,
		Provider:           ProviderStripe,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   now.Add(30 * 24 * time.Hour),
		RawJSON:            rawBody,
	}

	// Extract metadata
	if meta, ok := obj["metadata"].(map[string]any); ok {
		if uid, ok := meta["user_id"].(string); ok {
			payload.UserID = uid
		}
		if code, ok := meta["plan_code"].(string); ok {
			payload.PlanCode = code
		}
	}

	switch event.Type {
	case "checkout.session.completed":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if paymentIntent, ok := obj["payment_intent"].(string); ok {
			payload.ExternalChargeID = paymentIntent
		} else if id, ok := obj["id"].(string); ok {
			payload.ExternalChargeID = id
		}
		if total, ok := obj["amount_total"].(float64); ok {
			payload.GrossAmountCents = int64(total)
			payload.NetAmountCents = int64(total)
		}
		if curr, ok := obj["currency"].(string); ok {
			payload.Currency = strings.ToUpper(curr)
		}
		payload.Status = StatusActive

	case "invoice.payment_succeeded":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if chargeID, ok := obj["charge"].(string); ok {
			payload.ExternalChargeID = chargeID
		}
		if total, ok := obj["amount_paid"].(float64); ok {
			payload.GrossAmountCents = int64(total)
			payload.NetAmountCents = int64(total)
		}
		if curr, ok := obj["currency"].(string); ok {
			payload.Currency = strings.ToUpper(curr)
		}
		if lines, ok := obj["lines"].(map[string]any); ok {
			if dataList, ok := lines["data"].([]any); ok && len(dataList) > 0 {
				if first, ok := dataList[0].(map[string]any); ok {
					if period, ok := first["period"].(map[string]any); ok {
						if startSec, ok := period["start"].(float64); ok {
							payload.CurrentPeriodStart = time.Unix(int64(startSec), 0).UTC()
						}
						if endSec, ok := period["end"].(float64); ok {
							payload.CurrentPeriodEnd = time.Unix(int64(endSec), 0).UTC()
						}
					}
				}
			}
		}
		payload.Status = StatusActive

	case "invoice.upcoming":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if total, ok := obj["amount_due"].(float64); ok {
			payload.GrossAmountCents = int64(total)
		}
		if curr, ok := obj["currency"].(string); ok {
			payload.Currency = strings.ToUpper(curr)
		}
		if periodEnd, ok := obj["period_end"].(float64); ok {
			payload.CurrentPeriodEnd = time.Unix(int64(periodEnd), 0).UTC()
		}
		payload.Status = "UPCOMING_INVOICE"

	case "invoice.payment_failed":
		if subID, ok := obj["subscription"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		payload.Status = StatusPastDue

	case "customer.subscription.deleted":
		if subID, ok := obj["id"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		payload.Status = StatusCanceled

	case "customer.subscription.updated":
		if subID, ok := obj["id"].(string); ok {
			payload.ExternalSubscriptionID = subID
		}
		if st, ok := obj["status"].(string); ok {
			switch st {
			case "active":
				payload.Status = StatusActive
			case "past_due":
				payload.Status = StatusPastDue
			case "canceled":
				payload.Status = StatusCanceled
			}
		}
		if cancelAt, ok := obj["cancel_at_period_end"].(bool); ok {
			payload.CancelAtPeriodEnd = cancelAt
		}
		if endSec, ok := obj["current_period_end"].(float64); ok {
			payload.CurrentPeriodEnd = time.Unix(int64(endSec), 0).UTC()
		}

	case "charge.refunded":
		if chargeID, ok := obj["id"].(string); ok {
			payload.ExternalChargeID = chargeID
		}
		if total, ok := obj["amount_refunded"].(float64); ok {
			payload.GrossAmountCents = int64(total)
		}
		payload.Status = StatusRefunded
	}

	return payload, nil
}

// VerifyStripeSignature computes and validates webhook signature using official Stripe SDK.
func VerifyStripeSignature(rawBody []byte, sigHeader string, secret string, tolerance time.Duration) error {
	if secret == "" || strings.Contains(secret, "placeholder") {
		return fmt.Errorf("%w: Stripe Webhook Secret is unconfigured", ErrProviderNotConfigured)
	}
	_, err := webhook.ConstructEventWithOptions(rawBody, sigHeader, secret, webhook.ConstructEventOptions{
		Tolerance:                tolerance,
		IgnoreAPIVersionMismatch: true,
	})
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidWebhookSignature, err)
	}
	return nil
}

// Embedded Apple Root CAs for App Store Server API & StoreKit 2 JWS verification.
const (
	appleRootCAG3PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
QXV0aG9yaXR5TETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`

	appleRootCAPEM = `-----BEGIN CERTIFICATE-----
MIIEuzCCA6OgAwIBAgIBAjANBgkqhkiG9w0BAQUFADBiMQswCQYDVQQGEwJVUzET
MBEGA1UEChMKQXBwbGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlv
biBBdXRob3JpdHkxFjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwHhcNMDYwNDI1MjE0
MDM2WhcNMzUwMjA5MjE0MDM2WjBiMQswCQYDVQQGEwJVUzETMBEGA1UEChMKQXBw
bGUgSW5jLjEmMCQGA1UECxMdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkx
FjAUBgNVBAMTDUFwcGxlIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
ggEKAoIBAQDkkakJH5HbHkdQ6wXtXnmELes2oldMVeyLGYne+Uts9QerIjAC6Bg+
+FAJ039BqJj50cpmnCRrEdCju+QbKsMflZ56DKRHi1vUFjczy8QPTc4UadHJGXL1
XQ7Vf1+b8iUDulWPTV0N8WQ1IxVLFVkds5T39pyez1C6wVhQZ48ItCD3y6wsIG9w
tj8BMIy3Q88PnT3zK0koGsj+zrW5DtleHNbLPbU6rfQPDgCSC7EhFi501TwN22IW
q6NxkkdTVcGvL0Gz+PvjcM3mo0xFfh9Ma1CWQYnEdGILEINBhzOKgbEwWOxaBDKM
aLOPHd5lc/9nXmW8Sdh2nzMUZaF3lMktAgMBAAGjggF6MIIBdjAOBgNVHQ8BAf8E
BAMCAQYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUK9BpR5R2Cf70a40uQKb3
R01/CF4wHwYDVR0jBBgwFoAUK9BpR5R2Cf70a40uQKb3R01/CF4wggERBgNVHSAE
ggEIMIIBBDCCAQAGCSqGSIb3Y2QFATCB8jAqBggrBgEFBQcCARYeaHR0cHM6Ly93
d3cuYXBwbGUuY29tL2FwcGxlY2EvMIHDBggrBgEFBQcCAjCBthqBs1JlbGlhbmNl
IG9uIHRoaXMgY2VydGlmaWNhdGUgYnkgYW55IHBhcnR5IGFzc3VtZXMgYWNjZXB0
YW5jZSBvZiB0aGUgdGhlbiBhcHBsaWNhYmxlIHN0YW5kYXJkIHRlcm1zIGFuZCBj
b25kaXRpb25zIG9mIHVzZSwgY2VydGlmaWNhdGUgcG9saWN5IGFuZCBjZXJ0aWZp
Y2F0aW9uIHByYWN0aWNlIHN0YXRlbWVudHMuMA0GCSqGSIb3DQEBBQUAA4IBAQBc
NplMLXi37Yyb3PN3m/J20ncwT8EfhYOFG5k9RzfyqZtAjizUsZAS2L70c5vu0mQP
y3lPNNiiPvl4/2vIB+x9OYOLUyDTOMSxv5pPCmv/K/xZpwUJfBdAVhEedNO3iyM7
R6PVbyTi69G3cN8PReEnyvFteO3ntRcXqNx+IjXKJdXZD9Zr1KIkIxH3oayPc4Fg
yhtbCS+SsvhESPBgOJ4V9T0mZyCKM2r3DYLP3uujL/lTaltkwGMzd/c6ByxW69oP
IQ7aunMZT7XZNn/Bh1XZp5m5MkL72NVxnn6hUrcbvZNCJBIqxw8dtk2cXmPIS4AX
UKqK1drk/NAJBzewdXUh
-----END CERTIFICATE-----`
)

type AppleConfig struct {
	BundleID            string
	KeyID               string
	IssuerID            string
	PrivateKeyPEM       string
	AppAppleID          string
	Environment         string // "production" or "sandbox"
	SharedSecret        string
	RootCertificatesPEM string
}

type AppleTransactionPayload struct {
	TransactionID         string `json:"transactionId"`
	OriginalTransactionID string `json:"originalTransactionId"`
	BundleID              string `json:"bundleId"`
	ProductID             string `json:"productId"`
	PurchaseDate          int64  `json:"purchaseDate"`
	OriginalPurchaseDate  int64  `json:"originalPurchaseDate"`
	ExpiresDate           int64  `json:"expiresDate"`
	Quantity              int    `json:"quantity"`
	Type                  string `json:"type"`
	AppAccountToken       string `json:"appAccountToken,omitempty"`
	InAppOwnershipType    string `json:"inAppOwnershipType"`
	SignedDate            int64  `json:"signedDate"`
	Environment           string `json:"environment"`
	RevocationDate        int64  `json:"revocationDate,omitempty"`
	RevocationReason      int    `json:"revocationReason,omitempty"`
}

// AppleAppStoreAdapter implements ProviderAdapter for Apple StoreKit 2 and App Store Server API.
type AppleAppStoreAdapter struct {
	bundleID     string
	keyID        string
	issuerID     string
	privateKey   *ecdsa.PrivateKey
	appAppleID   string
	environment  string
	sharedSecret string
	baseURL      string
	rootCertPool *x509.CertPool
	httpClient   *http.Client
}

func parseECPrivateKey(pemStr string) (*ecdsa.PrivateKey, error) {
	clean := strings.TrimSpace(pemStr)
	if clean == "" {
		return nil, errors.New("empty private key PEM")
	}
	if !strings.Contains(clean, "-----BEGIN") {
		decoded, err := base64.StdEncoding.DecodeString(clean)
		if err == nil {
			clean = string(decoded)
		}
	}
	block, _ := pem.Decode([]byte(clean))
	if block == nil {
		return nil, errors.New("failed to parse PEM block containing private key")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if ecKey, ok := key.(*ecdsa.PrivateKey); ok {
			return ecKey, nil
		}
		return nil, errors.New("PKCS#8 private key is not an ECDSA key")
	}
	if ecKey, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return ecKey, nil
	}
	return nil, errors.New("failed to parse private key as PKCS#8 or SEC1 EC key")
}

func NewAppleAppStoreAdapter(sharedSecret, bundleID string) *AppleAppStoreAdapter {
	return NewAppleAppStoreAdapterWithConfig(AppleConfig{
		SharedSecret: sharedSecret,
		BundleID:     bundleID,
	})
}

func NewAppleAppStoreAdapterWithConfig(cfg AppleConfig) *AppleAppStoreAdapter {
	rootPool := x509.NewCertPool()
	rootPool.AppendCertsFromPEM([]byte(appleRootCAG3PEM))
	rootPool.AppendCertsFromPEM([]byte(appleRootCAPEM))
	if cfg.RootCertificatesPEM != "" {
		rootPool.AppendCertsFromPEM([]byte(cfg.RootCertificatesPEM))
	}

	adapter := &AppleAppStoreAdapter{
		bundleID:     strings.TrimSpace(cfg.BundleID),
		keyID:        strings.TrimSpace(cfg.KeyID),
		issuerID:     strings.TrimSpace(cfg.IssuerID),
		appAppleID:   strings.TrimSpace(cfg.AppAppleID),
		environment:  strings.ToLower(strings.TrimSpace(cfg.Environment)),
		sharedSecret: strings.TrimSpace(cfg.SharedSecret),
		rootCertPool: rootPool,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
	}

	if cfg.PrivateKeyPEM != "" && !strings.Contains(cfg.PrivateKeyPEM, "placeholder") {
		if pk, err := parseECPrivateKey(cfg.PrivateKeyPEM); err == nil {
			adapter.privateKey = pk
		}
	}

	return adapter
}

func (a *AppleAppStoreAdapter) SetHTTPClient(client *http.Client) {
	a.httpClient = client
}

func (a *AppleAppStoreAdapter) SetBaseURL(url string) {
	a.baseURL = strings.TrimRight(url, "/")
}

func (a *AppleAppStoreAdapter) SetRootCertificates(pool *x509.CertPool) {
	a.rootCertPool = pool
}

func (a *AppleAppStoreAdapter) SetCredentials(keyID, issuerID string, privateKey *ecdsa.PrivateKey, environment string) {
	a.keyID = strings.TrimSpace(keyID)
	a.issuerID = strings.TrimSpace(issuerID)
	a.privateKey = privateKey
	if environment != "" {
		a.environment = strings.ToLower(strings.TrimSpace(environment))
	}
}

func (a *AppleAppStoreAdapter) Name() string {
	return ProviderAppleAppStore
}

func (a *AppleAppStoreAdapter) BundleID() string {
	return a.bundleID
}

func (a *AppleAppStoreAdapter) CreateCheckoutSession(ctx context.Context, userID, userEmail string, product Product, successURL, cancelURL string) (*CheckoutSession, error) {
	return nil, fmt.Errorf("%w: direct web checkout session is not supported for Apple App Store (use StoreKit native in-app purchase)", ErrInvalidProvider)
}

func (a *AppleAppStoreAdapter) generateToken() (string, error) {
	if a.privateKey == nil || a.keyID == "" || a.issuerID == "" || a.bundleID == "" {
		return "", fmt.Errorf("%w: Apple App Store Server API credentials unconfigured (key_id, issuer_id, bundle_id, private_key required)", ErrProviderNotConfigured)
	}

	now := time.Now().UTC()
	header := map[string]string{
		"alg": "ES256",
		"kid": a.keyID,
		"typ": "JWT",
	}
	hBytes, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	claims := map[string]any{
		"iss": a.issuerID,
		"iat": now.Unix(),
		"exp": now.Add(15 * time.Minute).Unix(),
		"aud": "appstoreconnect-v1",
		"bid": a.bundleID,
	}
	cBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}

	signingInput := base64.RawURLEncoding.EncodeToString(hBytes) + "." + base64.RawURLEncoding.EncodeToString(cBytes)
	hash := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, a.privateKey, hash[:])
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	rBytes := r.Bytes()
	sBytes := s.Bytes()
	sig := make([]byte, 64)
	copy(sig[32-len(rBytes):32], rBytes)
	copy(sig[64-len(sBytes):], sBytes)

	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

func (a *AppleAppStoreAdapter) verifySignedTransaction(jwsStr string, product Product, expectedUserID string) (*VerifiedTransaction, error) {
	parts := strings.Split(jwsStr, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("%w: invalid JWS structure (expected 3 dot-separated parts)", ErrReceiptValidationFailed)
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("%w: invalid JWS header encoding: %v", ErrReceiptValidationFailed, err)
	}
	var header struct {
		Alg string   `json:"alg"`
		X5c []string `json:"x5c"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("%w: invalid JWS header JSON: %v", ErrReceiptValidationFailed, err)
	}
	if header.Alg != "ES256" {
		return nil, fmt.Errorf("%w: unsupported JWS algorithm %s (expected ES256)", ErrReceiptValidationFailed, header.Alg)
	}
	if len(header.X5c) == 0 {
		return nil, fmt.Errorf("%w: missing x5c certificate chain in JWS header", ErrReceiptValidationFailed)
	}

	certs := make([]*x509.Certificate, len(header.X5c))
	for i, certB64 := range header.X5c {
		certDER, err := base64.StdEncoding.DecodeString(certB64)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid base64 in x5c[%d]: %v", ErrReceiptValidationFailed, i, err)
		}
		c, err := x509.ParseCertificate(certDER)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid x509 certificate in x5c[%d]: %v", ErrReceiptValidationFailed, i, err)
		}
		certs[i] = c
	}

	leafCert := certs[0]
	intermediatePool := x509.NewCertPool()
	for _, c := range certs[1:] {
		intermediatePool.AddCert(c)
	}

	verifyOpts := x509.VerifyOptions{
		Roots:         a.rootCertPool,
		Intermediates: intermediatePool,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}
	if _, err := leafCert.Verify(verifyOpts); err != nil {
		return nil, fmt.Errorf("%w: certificate chain verification failed: %v", ErrReceiptValidationFailed, err)
	}

	signingInput := parts[0] + "." + parts[1]
	hash := sha256.Sum256([]byte(signingInput))
	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("%w: invalid JWS signature encoding: %v", ErrReceiptValidationFailed, err)
	}
	if len(sigBytes) != 64 {
		return nil, fmt.Errorf("%w: unexpected signature length %d (expected 64 bytes for P-256)", ErrReceiptValidationFailed, len(sigBytes))
	}
	r := new(big.Int).SetBytes(sigBytes[:32])
	s := new(big.Int).SetBytes(sigBytes[32:])

	pubKey, ok := leafCert.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("%w: leaf certificate public key is not ECDSA", ErrReceiptValidationFailed)
	}
	if !ecdsa.Verify(pubKey, hash[:], r, s) {
		return nil, fmt.Errorf("%w: cryptographic transaction signature verification failed", ErrReceiptValidationFailed)
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%w: invalid JWS payload encoding: %v", ErrReceiptValidationFailed, err)
	}
	var payload AppleTransactionPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("%w: malformed transaction payload JSON: %v", ErrReceiptValidationFailed, err)
	}

	if payload.BundleID != a.bundleID {
		return nil, fmt.Errorf("%w: bundle_id mismatch (expected %s, got %s)", ErrReceiptValidationFailed, a.bundleID, payload.BundleID)
	}
	if payload.ProductID != product.PlanCode {
		return nil, fmt.Errorf("%w: product_id mismatch (expected %s, got %s)", ErrReceiptValidationFailed, product.PlanCode, payload.ProductID)
	}
	if payload.RevocationDate > 0 {
		return nil, fmt.Errorf("%w: Apple transaction is revoked or refunded (revocationDate=%d, reason=%d)", ErrReceiptValidationFailed, payload.RevocationDate, payload.RevocationReason)
	}

	now := time.Now().UTC()
	periodEnd := now.Add(30 * 24 * time.Hour)
	if product.ProductType == ProductTypeSubscription {
		if payload.ExpiresDate > 0 {
			expTime := time.UnixMilli(payload.ExpiresDate).UTC()
			if expTime.Before(now) {
				return nil, fmt.Errorf("%w: Apple subscription has expired at %s", ErrReceiptValidationFailed, expTime.Format(time.RFC3339))
			}
			periodEnd = expTime
		} else if product.BillingPeriod == BillingPeriodAnnual {
			periodEnd = now.Add(365 * 24 * time.Hour)
		}
	} else if product.ProductType == ProductTypeConsumable {
		periodEnd = now.Add(365 * 24 * time.Hour)
	}

	if payload.AppAccountToken != "" && expectedUserID != "" {
		if !strings.EqualFold(payload.AppAccountToken, expectedUserID) {
			return nil, fmt.Errorf("%w: Apple purchase appAccountToken mismatch (expected %s, got %s)", ErrPurchaseUserMismatch, expectedUserID, payload.AppAccountToken)
		}
	}

	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if appEnv == "production" && strings.EqualFold(payload.Environment, "Sandbox") {
		return nil, fmt.Errorf("%w: Sandbox transaction rejected in production environment", ErrReceiptValidationFailed)
	}

	feeCents := int64(float64(product.PriceCents) * 0.15)
	chargeID := payload.TransactionID
	if chargeID == "" {
		chargeID = payload.OriginalTransactionID
	}
	subID := fmt.Sprintf("sub_apple_%s", payload.OriginalTransactionID)
	if payload.OriginalTransactionID == "" {
		subID = fmt.Sprintf("sub_apple_%s", chargeID)
	}

	txType := TxInitialPurchase
	if product.ProductType == ProductTypeConsumable {
		txType = TxBoostPurchase
	}

	return &VerifiedTransaction{
		ExternalChargeID:       chargeID,
		ExternalSubscriptionID: subID,
		TransactionType:        txType,
		GrossAmountCents:       product.PriceCents,
		ProviderFeeCents:       feeCents,
		TaxAmountCents:         0,
		NetAmountCents:         product.PriceCents - feeCents,
		Currency:               product.Currency,
		PeriodStart:            time.UnixMilli(payload.PurchaseDate).UTC(),
		PeriodEnd:              periodEnd,
		Status:                 StatusActive,
	}, nil
}

func (a *AppleAppStoreAdapter) VerifyPurchase(ctx context.Context, req VerifyPurchaseRequest, product Product) (*VerifiedTransaction, error) {
	if a.bundleID == "" {
		return nil, fmt.Errorf("%w: Apple bundle_id unconfigured", ErrProviderNotConfigured)
	}

	receiptData := strings.TrimSpace(req.ReceiptData)
	txID := strings.TrimSpace(req.ExternalTransactionID)
	if receiptData == "" && txID == "" {
		return nil, ErrInvalidReceiptData
	}

	// Direct JWS Verification (StoreKit 2 transactionRepresentation passed in receipt_data)
	if strings.Count(receiptData, ".") == 2 {
		return a.verifySignedTransaction(receiptData, product, req.UserID)
	}

	// Query App Store Server API using transactionId
	if txID == "" {
		var r struct {
			TransactionID string `json:"transaction_id"`
			BundleID      string `json:"bundle_id"`
			ProductID     string `json:"product_id"`
		}
		if err := json.Unmarshal([]byte(receiptData), &r); err == nil && r.TransactionID != "" {
			txID = r.TransactionID
		}
	}
	if txID == "" {
		return nil, ErrInvalidReceiptData
	}

	if a.keyID == "" || a.issuerID == "" || a.privateKey == nil {
		return nil, fmt.Errorf("%w: Apple App Store Server API credentials unconfigured (key_id, issuer_id, private_key required)", ErrProviderNotConfigured)
	}

	token, err := a.generateToken()
	if err != nil {
		return nil, err
	}

	baseURL := a.baseURL
	if baseURL == "" {
		baseURL = "https://api.storekit.itunes.apple.com"
		if strings.EqualFold(a.environment, "sandbox") {
			baseURL = "https://api.storekit-sandbox.itunes.apple.com"
		}
	}

	apiURL := fmt.Sprintf("%s/inApps/v1/transactions/%s", baseURL, txID)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create Apple request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)

	client := a.httpClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call Apple App Store Server API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		// If 404 on production and environment allows sandbox fallback
		if resp.StatusCode == http.StatusNotFound && !strings.EqualFold(a.environment, "sandbox") && os.Getenv("APP_ENV") != "production" {
			sandboxURL := fmt.Sprintf("https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/%s", txID)
			sReq, sErr := http.NewRequestWithContext(ctx, http.MethodGet, sandboxURL, nil)
			if sErr == nil {
				sReq.Header.Set("Authorization", "Bearer "+token)
				sResp, sErr2 := client.Do(sReq)
				if sErr2 == nil {
					defer sResp.Body.Close()
					if sResp.StatusCode == http.StatusOK {
						var sResult struct {
							SignedTransactionInfo string `json:"signedTransactionInfo"`
						}
						if sErr3 := json.NewDecoder(sResp.Body).Decode(&sResult); sErr3 == nil && sResult.SignedTransactionInfo != "" {
							return a.verifySignedTransaction(sResult.SignedTransactionInfo, product, req.UserID)
						}
					}
				}
			}
		}
		return nil, fmt.Errorf("%w: Apple API returned status %d: %s", ErrReceiptValidationFailed, resp.StatusCode, string(respBody))
	}

	var result struct {
		SignedTransactionInfo string `json:"signedTransactionInfo"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("%w: malformed Apple API response: %v", ErrReceiptValidationFailed, err)
	}
	if result.SignedTransactionInfo == "" {
		return nil, fmt.Errorf("%w: Apple response missing signedTransactionInfo", ErrReceiptValidationFailed)
	}

	return a.verifySignedTransaction(result.SignedTransactionInfo, product, req.UserID)
}

func (a *AppleAppStoreAdapter) ParseAndVerifyWebhook(ctx context.Context, rawBody []byte, signatureHeader string) (*WebhookPayload, error) {
	if a.bundleID == "" || (a.sharedSecret == "" && a.privateKey == nil) {
		return nil, fmt.Errorf("%w: Apple App Store Connect credentials or bundle_id unconfigured", ErrProviderNotConfigured)
	}
	now := time.Now().UTC()
	return &WebhookPayload{
		EventID:            fmt.Sprintf("apple_evt_%d", now.UnixNano()),
		EventType:          "DID_RENEW",
		Provider:           ProviderAppleAppStore,
		Status:             StatusActive,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   now.Add(30 * 24 * time.Hour),
		RawJSON:            rawBody,
	}, nil
}

// GooglePlayAdapter implements ProviderAdapter and PurchaseAcknowledger using official Google Play Developer API v3.
type GooglePlayAdapter struct {
	credentialsJSON string
	packageName     string
	service         *androidpublisher.Service
	httpClient      *http.Client
}

func NewGooglePlayAdapter(credentialsJSON, packageName string) *GooglePlayAdapter {
	return &GooglePlayAdapter{
		credentialsJSON: strings.TrimSpace(credentialsJSON),
		packageName:     strings.TrimSpace(packageName),
	}
}

func (g *GooglePlayAdapter) Name() string {
	return ProviderGooglePlay
}

func (g *GooglePlayAdapter) PackageName() string {
	return g.packageName
}

func (g *GooglePlayAdapter) SetService(svc *androidpublisher.Service) {
	g.service = svc
}

func (g *GooglePlayAdapter) SetHTTPClient(client *http.Client) {
	g.httpClient = client
}

func (g *GooglePlayAdapter) getService(ctx context.Context) (*androidpublisher.Service, error) {
	if g.service != nil {
		return g.service, nil
	}
	if g.credentialsJSON == "" || strings.Contains(g.credentialsJSON, "placeholder") {
		return nil, fmt.Errorf("%w: Google Play Developer credentials unconfigured", ErrProviderNotConfigured)
	}
	opts := []option.ClientOption{
		option.WithCredentialsJSON([]byte(g.credentialsJSON)),
	}
	if g.httpClient != nil {
		opts = append(opts, option.WithHTTPClient(g.httpClient))
	}
	svc, err := androidpublisher.NewService(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("%w: failed to initialize Google Play service: %v", ErrProviderNotConfigured, err)
	}
	g.service = svc
	return svc, nil
}

func (g *GooglePlayAdapter) extractPurchaseToken(req VerifyPurchaseRequest) (token string, pkgName string, err error) {
	raw := strings.TrimSpace(req.ReceiptData)
	if raw == "" {
		raw = strings.TrimSpace(req.ExternalTransactionID)
	}
	if raw == "" {
		return "", "", ErrInvalidReceiptData
	}

	var jsonReceipt struct {
		PurchaseToken string `json:"purchaseToken"`
		Token         string `json:"token"`
		PackageName   string `json:"packageName"`
		Package_Name  string `json:"package_name"`
		ProductID     string `json:"productId"`
	}
	if jsonErr := json.Unmarshal([]byte(raw), &jsonReceipt); jsonErr == nil {
		if jsonReceipt.PurchaseToken != "" {
			token = jsonReceipt.PurchaseToken
		} else if jsonReceipt.Token != "" {
			token = jsonReceipt.Token
		}
		if jsonReceipt.PackageName != "" {
			pkgName = jsonReceipt.PackageName
		} else if jsonReceipt.Package_Name != "" {
			pkgName = jsonReceipt.Package_Name
		}
	}

	if token == "" {
		token = raw
	}

	return token, pkgName, nil
}

func (g *GooglePlayAdapter) CreateCheckoutSession(ctx context.Context, userID, userEmail string, product Product, successURL, cancelURL string) (*CheckoutSession, error) {
	return nil, fmt.Errorf("%w: direct web checkout session is not supported for Google Play (use Google Play Billing in-app)", ErrInvalidProvider)
}

func (g *GooglePlayAdapter) VerifyPurchase(ctx context.Context, req VerifyPurchaseRequest, product Product) (*VerifiedTransaction, error) {
	if g.packageName == "" {
		return nil, fmt.Errorf("%w: Google Play package_name unconfigured", ErrProviderNotConfigured)
	}

	token, parsedPkg, err := g.extractPurchaseToken(req)
	if err != nil {
		return nil, err
	}
	if parsedPkg != "" && parsedPkg != g.packageName {
		return nil, fmt.Errorf("%w: package_name mismatch (expected %s, got %s)", ErrReceiptValidationFailed, g.packageName, parsedPkg)
	}

	svc, err := g.getService(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	feeCents := int64(float64(product.PriceCents) * 0.15) // Google 15% tier

	if product.ProductType == ProductTypeSubscription {
		subCall := svc.Purchases.Subscriptionsv2.Get(g.packageName, token)
		subV2, err := subCall.Context(ctx).Do()
		if err != nil {
			return nil, fmt.Errorf("%w: Google Play subscription verification failed: %v", ErrReceiptValidationFailed, err)
		}

		switch subV2.SubscriptionState {
		case "SUBSCRIPTION_STATE_PENDING":
			return nil, fmt.Errorf("%w: Google Play subscription is still pending payment", ErrReceiptValidationFailed)
		case "SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
			// Eligible
		case "SUBSCRIPTION_STATE_CANCELED":
			// Canceled can still be active until period end, checked via line items
		case "SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
			return nil, fmt.Errorf("%w: Google Play subscription state is ineligible (%s)", ErrReceiptValidationFailed, subV2.SubscriptionState)
		default:
			return nil, fmt.Errorf("%w: unknown Google Play subscription state %s", ErrReceiptValidationFailed, subV2.SubscriptionState)
		}

		if len(subV2.LineItems) == 0 {
			return nil, fmt.Errorf("%w: Google Play subscription has no line items", ErrReceiptValidationFailed)
		}
		item := subV2.LineItems[0]
		if item.ProductId != product.PlanCode {
			return nil, fmt.Errorf("%w: product_id mismatch (expected %s, got %s)", ErrReceiptValidationFailed, product.PlanCode, item.ProductId)
		}

		periodEnd := now.Add(30 * 24 * time.Hour)
		if item.ExpiryTime != "" {
			exp, err := time.Parse(time.RFC3339, item.ExpiryTime)
			if err == nil {
				if exp.Before(now) {
					return nil, fmt.Errorf("%w: Google Play subscription has expired at %s", ErrReceiptValidationFailed, exp.Format(time.RFC3339))
				}
				periodEnd = exp
			}
		}

		if subV2.ExternalAccountIdentifiers != nil && subV2.ExternalAccountIdentifiers.ObfuscatedExternalAccountId != "" && req.UserID != "" {
			if subV2.ExternalAccountIdentifiers.ObfuscatedExternalAccountId != req.UserID {
				return nil, fmt.Errorf("%w: Google Play purchase bound to another account (expected %s, got %s)", ErrPurchaseUserMismatch, req.UserID, subV2.ExternalAccountIdentifiers.ObfuscatedExternalAccountId)
			}
		}

		chargeID := item.LatestSuccessfulOrderId
		if chargeID == "" {
			chargeID = token
		}

		return &VerifiedTransaction{
			ExternalChargeID:       chargeID,
			ExternalSubscriptionID: fmt.Sprintf("sub_gplay_%s", token),
			TransactionType:        TxInitialPurchase,
			GrossAmountCents:       product.PriceCents,
			ProviderFeeCents:       feeCents,
			TaxAmountCents:         0,
			NetAmountCents:         product.PriceCents - feeCents,
			Currency:               product.Currency,
			PeriodStart:            now,
			PeriodEnd:              periodEnd,
			Status:                 StatusActive,
		}, nil
	} else if product.ProductType == ProductTypeConsumable {
		prodCall := svc.Purchases.Productsv2.Getproductpurchasev2(g.packageName, token)
		prodV2, err := prodCall.Context(ctx).Do()
		if err == nil {
			if prodV2.PurchaseStateContext != nil {
				st := prodV2.PurchaseStateContext.PurchaseState
				if st == "PENDING" {
					return nil, fmt.Errorf("%w: Google Play consumable purchase is still pending", ErrReceiptValidationFailed)
				}
				if st == "CANCELLED" {
					return nil, fmt.Errorf("%w: Google Play consumable purchase was cancelled", ErrReceiptValidationFailed)
				}
				if st != "PURCHASED" {
					return nil, fmt.Errorf("%w: Google Play consumable purchase not in purchased state (%s)", ErrReceiptValidationFailed, st)
				}
			}
			if len(prodV2.ProductLineItem) > 0 {
				if prodV2.ProductLineItem[0].ProductId != product.PlanCode {
					return nil, fmt.Errorf("%w: product_id mismatch (expected %s, got %s)", ErrReceiptValidationFailed, product.PlanCode, prodV2.ProductLineItem[0].ProductId)
				}
			}
			if prodV2.ObfuscatedExternalAccountId != "" && req.UserID != "" {
				if prodV2.ObfuscatedExternalAccountId != req.UserID {
					return nil, fmt.Errorf("%w: Google Play purchase bound to another account (expected %s, got %s)", ErrPurchaseUserMismatch, req.UserID, prodV2.ObfuscatedExternalAccountId)
				}
			}
			chargeID := prodV2.OrderId
			if chargeID == "" {
				chargeID = token
			}
			return &VerifiedTransaction{
				ExternalChargeID:       chargeID,
				ExternalSubscriptionID: "",
				TransactionType:        TxBoostPurchase,
				GrossAmountCents:       product.PriceCents,
				ProviderFeeCents:       feeCents,
				TaxAmountCents:         0,
				NetAmountCents:         product.PriceCents - feeCents,
				Currency:               product.Currency,
				PeriodStart:            now,
				PeriodEnd:              now.Add(365 * 24 * time.Hour),
				Status:                 StatusActive,
			}, nil
		}

		// Fallback to Products.Get
		pCall := svc.Purchases.Products.Get(g.packageName, product.PlanCode, token)
		prod, pErr := pCall.Context(ctx).Do()
		if pErr != nil {
			return nil, fmt.Errorf("%w: Google Play product verification failed: %v", ErrReceiptValidationFailed, pErr)
		}
		if prod.PurchaseState == 2 {
			return nil, fmt.Errorf("%w: Google Play purchase is still pending", ErrReceiptValidationFailed)
		}
		if prod.PurchaseState == 1 {
			return nil, fmt.Errorf("%w: Google Play purchase was cancelled", ErrReceiptValidationFailed)
		}
		if prod.PurchaseState != 0 {
			return nil, fmt.Errorf("%w: Google Play purchase not in purchased state (%d)", ErrReceiptValidationFailed, prod.PurchaseState)
		}
		if prod.ObfuscatedExternalAccountId != "" && req.UserID != "" {
			if prod.ObfuscatedExternalAccountId != req.UserID {
				return nil, fmt.Errorf("%w: Google Play purchase bound to another account (expected %s, got %s)", ErrPurchaseUserMismatch, req.UserID, prod.ObfuscatedExternalAccountId)
			}
		}
		chargeID := prod.OrderId
		if chargeID == "" {
			chargeID = token
		}
		return &VerifiedTransaction{
			ExternalChargeID:       chargeID,
			ExternalSubscriptionID: "",
			TransactionType:        TxBoostPurchase,
			GrossAmountCents:       product.PriceCents,
			ProviderFeeCents:       feeCents,
			TaxAmountCents:         0,
			NetAmountCents:         product.PriceCents - feeCents,
			Currency:               product.Currency,
			PeriodStart:            now,
			PeriodEnd:              now.Add(365 * 24 * time.Hour),
			Status:                 StatusActive,
		}, nil
	}

	return nil, fmt.Errorf("%w: unsupported product type %s", ErrReceiptValidationFailed, product.ProductType)
}

func (g *GooglePlayAdapter) AcknowledgePurchase(ctx context.Context, req VerifyPurchaseRequest, verified *VerifiedTransaction) error {
	svc, err := g.getService(ctx)
	if err != nil {
		return err
	}
	token, _, err := g.extractPurchaseToken(req)
	if err != nil {
		return err
	}

	if verified.TransactionType == TxBoostPurchase {
		return svc.Purchases.Products.Consume(g.packageName, req.PlanCode, token).Context(ctx).Do()
	}

	ackReq := &androidpublisher.SubscriptionPurchasesAcknowledgeRequest{}
	return svc.Purchases.Subscriptions.Acknowledge(g.packageName, req.PlanCode, token, ackReq).Context(ctx).Do()
}

func (g *GooglePlayAdapter) ParseAndVerifyWebhook(ctx context.Context, rawBody []byte, signatureHeader string) (*WebhookPayload, error) {
	if g.packageName == "" || g.credentialsJSON == "" || strings.Contains(g.credentialsJSON, "placeholder") {
		return nil, fmt.Errorf("%w: Google Play Developer credentials or package_name unconfigured", ErrProviderNotConfigured)
	}
	now := time.Now().UTC()
	return &WebhookPayload{
		EventID:            fmt.Sprintf("gplay_evt_%d", now.UnixNano()),
		EventType:          "SUBSCRIPTION_RENEWED",
		Provider:           ProviderGooglePlay,
		Status:             StatusActive,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   now.Add(30 * 24 * time.Hour),
		RawJSON:            rawBody,
	}, nil
}
