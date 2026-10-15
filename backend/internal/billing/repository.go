package billing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/auradating/platform/backend/internal/events"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetProducts(ctx context.Context, activeOnly bool) ([]Product, error)
	GetProductByPlanCode(ctx context.Context, planCode string) (*Product, error)

	GetSubscriptionByID(ctx context.Context, id string) (*Subscription, error)
	GetActiveSubscriptionByUserID(ctx context.Context, userID string) (*Subscription, error)
	GetSubscriptionByExternalID(ctx context.Context, provider, externalID string) (*Subscription, error)
	UpsertSubscription(ctx context.Context, sub *Subscription) error
	CancelSubscriptionAtPeriodEnd(ctx context.Context, userID, subID string) (*Subscription, error)
	ListAllSubscriptions(ctx context.Context, statusFilter, planFilter string, limit, offset int) ([]Subscription, int, error)

	CreateTransaction(ctx context.Context, tx *PaymentTransaction) error
	GetTransactionByExternalID(ctx context.Context, provider, externalChargeID string) (*PaymentTransaction, error)
	ListTransactionsByUserID(ctx context.Context, userID string, limit int) ([]PaymentTransaction, error)
	ListAllTransactions(ctx context.Context, txTypeFilter string, limit, offset int) ([]PaymentTransaction, int, error)
	RefundTransaction(ctx context.Context, txID string, reason string, actorID string) (*PaymentTransaction, error)

	RecordWebhookEvent(ctx context.Context, eventID, provider, eventType string, payload []byte) (isDuplicate bool, err error)

	GrantEntitlements(ctx context.Context, userID string, codes []string, source string, expiresAt time.Time, metadata map[string]any) error
	RevokeEntitlements(ctx context.Context, userID string, source string) error
	GetActiveEntitlements(ctx context.Context, userID string) ([]UserEntitlement, error)
	HasEntitlement(ctx context.Context, userID, code string) (bool, error)

	GetBoostCredits(ctx context.Context, userID string) (int, error)
	AddBoostCredits(ctx context.Context, userID string, credits int) (int, error)
	ConsumeBoostCredit(ctx context.Context, userID string) (remaining int, err error)

	CreateProfileBoost(ctx context.Context, boost *ProfileBoost) error
	GetActiveProfileBoost(ctx context.Context, userID string) (*ProfileBoost, error)

	RecordConsent(ctx context.Context, consent *SubscriptionConsentRecord) error
	GetLatestConsent(ctx context.Context, userID, planCode string) (*SubscriptionConsentRecord, error)

	PublishOutboxEvent(ctx context.Context, event events.Envelope) error
}

// MemoryRepository provides thread-safe in-memory billing repository for testing and standalone dev.
type MemoryRepository struct {
	mu            sync.RWMutex
	products      map[string]*Product
	subscriptions map[string]*Subscription       // key: id
	subByExternal map[string]string              // key: provider:externalID -> subID
	transactions  map[string]*PaymentTransaction // key: id
	txByExternal  map[string]string              // key: provider:chargeID -> txID
	webhooks      map[string]struct{}            // key: provider:eventID
	entitlements  map[string][]UserEntitlement   // key: userID
	boostCredits  map[string]int                 // key: userID
	boosts        map[string][]ProfileBoost      // key: userID
	consents      map[string]*SubscriptionConsentRecord // key: userID:planCode
	outboxEvents  []events.Envelope
}

func NewMemoryRepository() *MemoryRepository {
	m := &MemoryRepository{
		products:      make(map[string]*Product),
		subscriptions: make(map[string]*Subscription),
		subByExternal: make(map[string]string),
		transactions:  make(map[string]*PaymentTransaction),
		txByExternal:  make(map[string]string),
		webhooks:      make(map[string]struct{}),
		entitlements:  make(map[string][]UserEntitlement),
		boostCredits:  make(map[string]int),
		boosts:        make(map[string][]ProfileBoost),
		consents:      make(map[string]*SubscriptionConsentRecord),
	}

	// Seed canonical products
	now := time.Now().UTC()
	defaults := []Product{
		{
			ID: "prod_plus_monthly", PlanCode: PlanAuraPlusMonthly, Name: "Aura Plus (Monthly)",
			Description: "Unlimited swipes, see who liked you, rewind, and travel passport.",
			ProductType: ProductTypeSubscription, Tier: TierPlus, BillingPeriod: BillingPeriodMonthly,
			PriceCents: 1999, Currency: "USD", Entitlements: []string{EntitlementUnlimitedSwipes, EntitlementSeeWhoLikedYou, EntitlementRewind, EntitlementTravelMode},
			BoostCredits: 1, IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "prod_plus_annual", PlanCode: PlanAuraPlusAnnual, Name: "Aura Plus (Annual)",
			Description: "Save 50% with annual Aura Plus billing. Includes 1 free boost per month.",
			ProductType: ProductTypeSubscription, Tier: TierPlus, BillingPeriod: BillingPeriodAnnual,
			PriceCents: 11988, Currency: "USD", Entitlements: []string{EntitlementUnlimitedSwipes, EntitlementSeeWhoLikedYou, EntitlementRewind, EntitlementTravelMode},
			BoostCredits: 12, IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "prod_black_monthly", PlanCode: PlanAuraBlackMonthly, Name: "Aura Black (Monthly)",
			Description: "VIP features: read receipts, incognito browsing, priority likes, and all Plus benefits.",
			ProductType: ProductTypeSubscription, Tier: TierBlack, BillingPeriod: BillingPeriodMonthly,
			PriceCents: 3499, Currency: "USD", Entitlements: []string{EntitlementUnlimitedSwipes, EntitlementSeeWhoLikedYou, EntitlementRewind, EntitlementTravelMode, EntitlementReadReceipts, EntitlementPriorityLikes, EntitlementIncognitoBrowsing},
			BoostCredits: 3, IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "prod_black_annual", PlanCode: PlanAuraBlackAnnual, Name: "Aura Black (Annual)",
			Description: "VIP annual membership with 36 boost credits and priority ranking in discovery.",
			ProductType: ProductTypeSubscription, Tier: TierBlack, BillingPeriod: BillingPeriodAnnual,
			PriceCents: 20988, Currency: "USD", Entitlements: []string{EntitlementUnlimitedSwipes, EntitlementSeeWhoLikedYou, EntitlementRewind, EntitlementTravelMode, EntitlementReadReceipts, EntitlementPriorityLikes, EntitlementIncognitoBrowsing},
			BoostCredits: 36, IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "prod_boost_single", PlanCode: PlanBoostSingle, Name: "Single Profile Boost",
			Description: "30-minute 2.5x profile visibility boost in local discovery.",
			ProductType: ProductTypeConsumable, Tier: TierConsumable, BillingPeriod: BillingPeriodNone,
			PriceCents: 499, Currency: "USD", Entitlements: []string{},
			BoostCredits: 1, IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "prod_boost_5pack", PlanCode: PlanBoost5Pack, Name: "5-Pack Profile Boosts",
			Description: "Bundle of five 30-minute profile visibility boosts.",
			ProductType: ProductTypeConsumable, Tier: TierConsumable, BillingPeriod: BillingPeriodNone,
			PriceCents: 1799, Currency: "USD", Entitlements: []string{},
			BoostCredits: 5, IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "prod_superspark_5pack", PlanCode: PlanSuperSpark5Pack, Name: "5-Pack Super Sparks",
			Description: "Send 5 high-intent sparks with instant personalized direct messaging.",
			ProductType: ProductTypeConsumable, Tier: TierConsumable, BillingPeriod: BillingPeriodNone,
			PriceCents: 999, Currency: "USD", Entitlements: []string{EntitlementSuperSpark},
			BoostCredits: 0, IsActive: true, CreatedAt: now, UpdatedAt: now,
		},
	}

	for _, p := range defaults {
		cp := p
		m.products[p.PlanCode] = &cp
	}

	return m
}

func (m *MemoryRepository) GetProducts(ctx context.Context, activeOnly bool) ([]Product, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var res []Product
	for _, p := range m.products {
		if !activeOnly || p.IsActive {
			res = append(res, *p)
		}
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].PriceCents < res[j].PriceCents
	})
	return res, nil
}

func (m *MemoryRepository) GetProductByPlanCode(ctx context.Context, planCode string) (*Product, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	p, ok := m.products[planCode]
	if !ok {
		return nil, ErrProductNotFound
	}
	cp := *p
	return &cp, nil
}

func (m *MemoryRepository) GetSubscriptionByID(ctx context.Context, id string) (*Subscription, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.subscriptions[id]
	if !ok {
		return nil, ErrSubscriptionNotFound
	}
	cp := *s
	return &cp, nil
}

func (m *MemoryRepository) GetActiveSubscriptionByUserID(ctx context.Context, userID string) (*Subscription, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, s := range m.subscriptions {
		if s.UserID == userID && s.IsActive() {
			cp := *s
			return &cp, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) GetSubscriptionByExternalID(ctx context.Context, provider, externalID string) (*Subscription, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", provider, externalID)
	id, ok := m.subByExternal[key]
	if !ok {
		return nil, ErrSubscriptionNotFound
	}
	s := m.subscriptions[id]
	cp := *s
	return &cp, nil
}

func (m *MemoryRepository) UpsertSubscription(ctx context.Context, sub *Subscription) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if sub.ID == "" {
		sub.ID = fmt.Sprintf("sub_%d", time.Now().UnixNano())
	}
	sub.UpdatedAt = time.Now().UTC()
	if sub.CreatedAt.IsZero() {
		sub.CreatedAt = sub.UpdatedAt
	}

	cp := *sub
	m.subscriptions[sub.ID] = &cp
	if sub.Provider != "" && sub.ExternalSubscriptionID != "" {
		key := fmt.Sprintf("%s:%s", sub.Provider, sub.ExternalSubscriptionID)
		m.subByExternal[key] = sub.ID
	}
	return nil
}

func (m *MemoryRepository) CancelSubscriptionAtPeriodEnd(ctx context.Context, userID, subID string) (*Subscription, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	s, ok := m.subscriptions[subID]
	if !ok || s.UserID != userID {
		return nil, ErrSubscriptionNotFound
	}
	s.CancelAtPeriodEnd = true
	s.Status = StatusCanceled
	s.UpdatedAt = time.Now().UTC()
	cp := *s
	return &cp, nil
}

func (m *MemoryRepository) ListAllSubscriptions(_ context.Context, statusFilter, planFilter string, limit, offset int) ([]Subscription, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var matched []Subscription
	for _, sub := range m.subscriptions {
		if statusFilter != "" && sub.Status != statusFilter {
			continue
		}
		if planFilter != "" && sub.PlanCode != planFilter {
			continue
		}
		matched = append(matched, *sub)
	}

	sort.Slice(matched, func(i, j int) bool {
		return matched[i].CreatedAt.After(matched[j].CreatedAt)
	})

	total := len(matched)
	if offset >= total {
		return []Subscription{}, total, nil
	}
	end := offset + limit
	if limit <= 0 || end > total {
		end = total
	}
	return matched[offset:end], total, nil
}

func (m *MemoryRepository) CreateTransaction(ctx context.Context, tx *PaymentTransaction) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if tx.ID == "" {
		tx.ID = fmt.Sprintf("tx_%d", time.Now().UnixNano())
	}
	if tx.OccurredAt.IsZero() {
		tx.OccurredAt = time.Now().UTC()
	}

	key := fmt.Sprintf("%s:%s", tx.Provider, tx.ExternalChargeID)
	if _, exists := m.txByExternal[key]; exists {
		return nil // idempotent duplicate
	}

	cp := *tx
	m.transactions[tx.ID] = &cp
	m.txByExternal[key] = tx.ID
	return nil
}

func (m *MemoryRepository) GetTransactionByExternalID(ctx context.Context, provider, externalChargeID string) (*PaymentTransaction, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", provider, externalChargeID)
	id, ok := m.txByExternal[key]
	if !ok {
		return nil, ErrTransactionNotFound
	}
	cp := *m.transactions[id]
	return &cp, nil
}

func (m *MemoryRepository) ListTransactionsByUserID(ctx context.Context, userID string, limit int) ([]PaymentTransaction, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var res []PaymentTransaction
	for _, tx := range m.transactions {
		if tx.UserID == userID {
			res = append(res, *tx)
		}
	}
	sort.Slice(res, func(i, j int) bool {
		return res[i].OccurredAt.After(res[j].OccurredAt)
	})
	if limit > 0 && len(res) > limit {
		res = res[:limit]
	}
	return res, nil
}

func (m *MemoryRepository) ListAllTransactions(_ context.Context, txTypeFilter string, limit, offset int) ([]PaymentTransaction, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var matched []PaymentTransaction
	for _, tx := range m.transactions {
		if txTypeFilter != "" && tx.TransactionType != txTypeFilter {
			continue
		}
		matched = append(matched, *tx)
	}

	sort.Slice(matched, func(i, j int) bool {
		return matched[i].OccurredAt.After(matched[j].OccurredAt)
	})

	total := len(matched)
	if offset >= total {
		return []PaymentTransaction{}, total, nil
	}
	end := offset + limit
	if limit <= 0 || end > total {
		end = total
	}
	return matched[offset:end], total, nil
}

func (m *MemoryRepository) RefundTransaction(_ context.Context, txID string, reason string, actorID string) (*PaymentTransaction, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	orig, ok := m.transactions[txID]
	if !ok {
		return nil, errors.New("transaction not found")
	}
	if orig.TransactionType == TxRefund {
		return nil, errors.New("transaction is already a refund")
	}

	refundID := fmt.Sprintf("tx_ref_%d_%s", time.Now().Unix(), generateRandomString(6))
	refundTx := &PaymentTransaction{
		ID:                refundID,
		UserID:            orig.UserID,
		SubscriptionID:    orig.SubscriptionID,
		Provider:          orig.Provider,
		ExternalChargeID:  "ref_" + orig.ExternalChargeID,
		TransactionType:   TxRefund,
		GrossAmountCents:  -orig.GrossAmountCents,
		ProviderFeeCents:  0,
		TaxAmountCents:    -orig.TaxAmountCents,
		NetAmountCents:    -orig.NetAmountCents,
		Currency:          orig.Currency,
		BillingCycleIndex: orig.BillingCycleIndex,
		OccurredAt:        time.Now().UTC(),
	}
	m.transactions[refundID] = refundTx

	if orig.SubscriptionID != nil && *orig.SubscriptionID != "" {
		if sub, exists := m.subscriptions[*orig.SubscriptionID]; exists {
			sub.Status = StatusRefunded
			sub.UpdatedAt = time.Now().UTC()
		}
	}

	return refundTx, nil
}

func (m *MemoryRepository) RecordWebhookEvent(ctx context.Context, eventID, provider, eventType string, payload []byte) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%s:%s", provider, eventID)
	if _, exists := m.webhooks[key]; exists {
		return true, nil
	}
	m.webhooks[key] = struct{}{}
	return false, nil
}

func (m *MemoryRepository) GrantEntitlements(ctx context.Context, userID string, codes []string, source string, expiresAt time.Time, metadata map[string]any) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for _, c := range codes {
		m.entitlements[userID] = append(m.entitlements[userID], UserEntitlement{
			ID:              fmt.Sprintf("ent_%d", time.Now().UnixNano()),
			UserID:          userID,
			EntitlementCode: c,
			Source:          source,
			GrantedAt:       now,
			ExpiresAt:       expiresAt,
			Metadata:        metadata,
		})
	}
	return nil
}

func (m *MemoryRepository) RevokeEntitlements(ctx context.Context, userID string, source string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	current := m.entitlements[userID]
	var remaining []UserEntitlement
	for _, e := range current {
		if e.Source != source {
			remaining = append(remaining, e)
		}
	}
	m.entitlements[userID] = remaining
	return nil
}

func (m *MemoryRepository) GetActiveEntitlements(ctx context.Context, userID string) ([]UserEntitlement, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var res []UserEntitlement
	now := time.Now().UTC()
	for _, e := range m.entitlements[userID] {
		if e.ExpiresAt.After(now) {
			res = append(res, e)
		}
	}
	return res, nil
}

func (m *MemoryRepository) HasEntitlement(ctx context.Context, userID, code string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	for _, e := range m.entitlements[userID] {
		if e.EntitlementCode == code && e.ExpiresAt.After(now) {
			return true, nil
		}
	}
	return false, nil
}

func (m *MemoryRepository) GetBoostCredits(ctx context.Context, userID string) (int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.boostCredits[userID], nil
}

func (m *MemoryRepository) AddBoostCredits(ctx context.Context, userID string, credits int) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.boostCredits[userID] += credits
	return m.boostCredits[userID], nil
}

func (m *MemoryRepository) ConsumeBoostCredit(ctx context.Context, userID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	current := m.boostCredits[userID]
	if current < 1 {
		return current, ErrInsufficientBoostCredits
	}
	m.boostCredits[userID] = current - 1
	return m.boostCredits[userID], nil
}

func (m *MemoryRepository) CreateProfileBoost(ctx context.Context, boost *ProfileBoost) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if boost.ID == "" {
		boost.ID = fmt.Sprintf("boost_%d", time.Now().UnixNano())
	}
	m.boosts[boost.UserID] = append(m.boosts[boost.UserID], *boost)
	return nil
}

func (m *MemoryRepository) GetActiveProfileBoost(ctx context.Context, userID string) (*ProfileBoost, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now().UTC()
	for _, b := range m.boosts[userID] {
		if b.Status == BoostStatusActive && b.ExpiresAt.After(now) {
			cp := b
			return &cp, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) PublishOutboxEvent(ctx context.Context, event events.Envelope) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.outboxEvents = append(m.outboxEvents, event)
	return nil
}

func (m *MemoryRepository) GetOutboxEvents() []events.Envelope {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]events.Envelope, len(m.outboxEvents))
	copy(res, m.outboxEvents)
	return res
}

func (m *MemoryRepository) RecordConsent(ctx context.Context, consent *SubscriptionConsentRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if consent.ID == "" {
		consent.ID = fmt.Sprintf("consent_%d", time.Now().UnixNano())
	}
	key := fmt.Sprintf("%s:%s", consent.UserID, consent.PlanCode)
	cp := *consent
	m.consents[key] = &cp
	return nil
}

func (m *MemoryRepository) GetLatestConsent(ctx context.Context, userID, planCode string) (*SubscriptionConsentRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	key := fmt.Sprintf("%s:%s", userID, planCode)
	c, ok := m.consents[key]
	if !ok {
		return nil, nil
	}
	cp := *c
	return &cp, nil
}

// PostgresRepository implements Repository using PostgreSQL and PostGIS.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) GetProducts(ctx context.Context, activeOnly bool) ([]Product, error) {
	query := `
		SELECT id, plan_code, name, description, product_type, tier, billing_period,
		       price_cents, currency, entitlements, boost_credits, is_active, created_at, updated_at
		FROM billing_products
	`
	if activeOnly {
		query += " WHERE is_active = TRUE ORDER BY price_cents ASC"
	} else {
		query += " ORDER BY price_cents ASC"
	}

	rows, err := p.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var pr Product
		var entJSON []byte
		if err := rows.Scan(
			&pr.ID, &pr.PlanCode, &pr.Name, &pr.Description, &pr.ProductType, &pr.Tier,
			&pr.BillingPeriod, &pr.PriceCents, &pr.Currency, &entJSON, &pr.BoostCredits,
			&pr.IsActive, &pr.CreatedAt, &pr.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(entJSON, &pr.Entitlements)
		products = append(products, pr)
	}
	return products, nil
}

func (p *PostgresRepository) GetProductByPlanCode(ctx context.Context, planCode string) (*Product, error) {
	query := `
		SELECT id, plan_code, name, description, product_type, tier, billing_period,
		       price_cents, currency, entitlements, boost_credits, is_active, created_at, updated_at
		FROM billing_products
		WHERE plan_code = $1
		LIMIT 1
	`
	var pr Product
	var entJSON []byte
	err := p.pool.QueryRow(ctx, query, planCode).Scan(
		&pr.ID, &pr.PlanCode, &pr.Name, &pr.Description, &pr.ProductType, &pr.Tier,
		&pr.BillingPeriod, &pr.PriceCents, &pr.Currency, &entJSON, &pr.BoostCredits,
		&pr.IsActive, &pr.CreatedAt, &pr.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrProductNotFound
		}
		return nil, err
	}
	_ = json.Unmarshal(entJSON, &pr.Entitlements)
	return &pr, nil
}

func (p *PostgresRepository) GetSubscriptionByID(ctx context.Context, id string) (*Subscription, error) {
	query := `
		SELECT id, user_id, plan_code, provider, external_subscription_id, status,
		       currency, price_cents, current_period_start, current_period_end,
		       cancel_at_period_end, created_at, updated_at
		FROM subscriptions
		WHERE id = $1
	`
	var s Subscription
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&s.ID, &s.UserID, &s.PlanCode, &s.Provider, &s.ExternalSubscriptionID, &s.Status,
		&s.Currency, &s.PriceCents, &s.CurrentPeriodStart, &s.CurrentPeriodEnd,
		&s.CancelAtPeriodEnd, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (p *PostgresRepository) GetActiveSubscriptionByUserID(ctx context.Context, userID string) (*Subscription, error) {
	query := `
		SELECT id, user_id, plan_code, provider, external_subscription_id, status,
		       currency, price_cents, current_period_start, current_period_end,
		       cancel_at_period_end, created_at, updated_at
		FROM subscriptions
		WHERE user_id = $1 AND status IN ('ACTIVE', 'TRIALING', 'GRACE_PERIOD', 'CANCELED')
		  AND current_period_end > NOW()
		ORDER BY current_period_end DESC
		LIMIT 1
	`
	var s Subscription
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&s.ID, &s.UserID, &s.PlanCode, &s.Provider, &s.ExternalSubscriptionID, &s.Status,
		&s.Currency, &s.PriceCents, &s.CurrentPeriodStart, &s.CurrentPeriodEnd,
		&s.CancelAtPeriodEnd, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

func (p *PostgresRepository) GetSubscriptionByExternalID(ctx context.Context, provider, externalID string) (*Subscription, error) {
	query := `
		SELECT id, user_id, plan_code, provider, external_subscription_id, status,
		       currency, price_cents, current_period_start, current_period_end,
		       cancel_at_period_end, created_at, updated_at
		FROM subscriptions
		WHERE provider = $1 AND external_subscription_id = $2
		LIMIT 1
	`
	var s Subscription
	err := p.pool.QueryRow(ctx, query, provider, externalID).Scan(
		&s.ID, &s.UserID, &s.PlanCode, &s.Provider, &s.ExternalSubscriptionID, &s.Status,
		&s.Currency, &s.PriceCents, &s.CurrentPeriodStart, &s.CurrentPeriodEnd,
		&s.CancelAtPeriodEnd, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (p *PostgresRepository) UpsertSubscription(ctx context.Context, sub *Subscription) error {
	query := `
		INSERT INTO subscriptions (
			user_id, plan_code, provider, external_subscription_id, status,
			currency, price_cents, current_period_start, current_period_end, cancel_at_period_end, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
		ON CONFLICT (provider, external_subscription_id)
		DO UPDATE SET
			status = EXCLUDED.status,
			current_period_start = EXCLUDED.current_period_start,
			current_period_end = EXCLUDED.current_period_end,
			cancel_at_period_end = EXCLUDED.cancel_at_period_end,
			updated_at = NOW()
		RETURNING id, created_at, updated_at
	`
	return p.pool.QueryRow(
		ctx, query,
		sub.UserID, sub.PlanCode, sub.Provider, sub.ExternalSubscriptionID, sub.Status,
		sub.Currency, sub.PriceCents, sub.CurrentPeriodStart, sub.CurrentPeriodEnd, sub.CancelAtPeriodEnd,
	).Scan(&sub.ID, &sub.CreatedAt, &sub.UpdatedAt)
}

func (p *PostgresRepository) CancelSubscriptionAtPeriodEnd(ctx context.Context, userID, subID string) (*Subscription, error) {
	query := `
		UPDATE subscriptions
		SET cancel_at_period_end = TRUE, status = 'CANCELED', updated_at = NOW()
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, plan_code, provider, external_subscription_id, status,
		          currency, price_cents, current_period_start, current_period_end,
		          cancel_at_period_end, created_at, updated_at
	`
	var s Subscription
	err := p.pool.QueryRow(ctx, query, subID, userID).Scan(
		&s.ID, &s.UserID, &s.PlanCode, &s.Provider, &s.ExternalSubscriptionID, &s.Status,
		&s.Currency, &s.PriceCents, &s.CurrentPeriodStart, &s.CurrentPeriodEnd,
		&s.CancelAtPeriodEnd, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSubscriptionNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (p *PostgresRepository) CreateTransaction(ctx context.Context, tx *PaymentTransaction) error {
	query := `
		INSERT INTO payment_transactions (
			user_id, subscription_id, provider, external_charge_id, transaction_type,
			gross_amount_cents, provider_fee_cents, tax_amount_cents, net_amount_cents,
			currency, billing_cycle_index, occurred_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (provider, external_charge_id) DO NOTHING
		RETURNING id
	`
	err := p.pool.QueryRow(
		ctx, query,
		tx.UserID, tx.SubscriptionID, tx.Provider, tx.ExternalChargeID, tx.TransactionType,
		tx.GrossAmountCents, tx.ProviderFeeCents, tx.TaxAmountCents, tx.NetAmountCents,
		tx.Currency, tx.BillingCycleIndex, tx.OccurredAt,
	).Scan(&tx.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Idempotent duplicate
			return nil
		}
		return err
	}
	return nil
}

func (p *PostgresRepository) GetTransactionByExternalID(ctx context.Context, provider, externalChargeID string) (*PaymentTransaction, error) {
	query := `
		SELECT id, user_id, subscription_id, provider, external_charge_id, transaction_type,
		       gross_amount_cents, provider_fee_cents, tax_amount_cents, net_amount_cents,
		       currency, billing_cycle_index, occurred_at
		FROM payment_transactions
		WHERE provider = $1 AND external_charge_id = $2
		LIMIT 1
	`
	var tx PaymentTransaction
	err := p.pool.QueryRow(ctx, query, provider, externalChargeID).Scan(
		&tx.ID, &tx.UserID, &tx.SubscriptionID, &tx.Provider, &tx.ExternalChargeID, &tx.TransactionType,
		&tx.GrossAmountCents, &tx.ProviderFeeCents, &tx.TaxAmountCents, &tx.NetAmountCents,
		&tx.Currency, &tx.BillingCycleIndex, &tx.OccurredAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTransactionNotFound
		}
		return nil, err
	}
	return &tx, nil
}

func (p *PostgresRepository) ListTransactionsByUserID(ctx context.Context, userID string, limit int) ([]PaymentTransaction, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT id, user_id, subscription_id, provider, external_charge_id, transaction_type,
		       gross_amount_cents, provider_fee_cents, tax_amount_cents, net_amount_cents,
		       currency, billing_cycle_index, occurred_at
		FROM payment_transactions
		WHERE user_id = $1
		ORDER BY occurred_at DESC
		LIMIT $2
	`
	rows, err := p.pool.Query(ctx, query, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []PaymentTransaction
	for rows.Next() {
		var tx PaymentTransaction
		if err := rows.Scan(
			&tx.ID, &tx.UserID, &tx.SubscriptionID, &tx.Provider, &tx.ExternalChargeID, &tx.TransactionType,
			&tx.GrossAmountCents, &tx.ProviderFeeCents, &tx.TaxAmountCents, &tx.NetAmountCents,
			&tx.Currency, &tx.BillingCycleIndex, &tx.OccurredAt,
		); err != nil {
			return nil, err
		}
		txs = append(txs, tx)
	}
	return txs, nil
}

func (p *PostgresRepository) RecordWebhookEvent(ctx context.Context, eventID, provider, eventType string, payload []byte) (bool, error) {
	query := `
		INSERT INTO webhook_events (provider, external_event_id, event_type, payload)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (provider, external_event_id) DO NOTHING
		RETURNING id
	`
	var id string
	err := p.pool.QueryRow(ctx, query, provider, eventID, eventType, payload).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil // duplicate event
		}
		return false, err
	}
	return false, nil
}

func (p *PostgresRepository) GrantEntitlements(ctx context.Context, userID string, codes []string, source string, expiresAt time.Time, metadata map[string]any) error {
	metaJSON, _ := json.Marshal(metadata)
	query := `
		INSERT INTO user_entitlements (user_id, entitlement_code, source, granted_at, expires_at, metadata)
		VALUES ($1, $2, $3, NOW(), $4, $5)
	`
	for _, code := range codes {
		if _, err := p.pool.Exec(ctx, query, userID, code, source, expiresAt, metaJSON); err != nil {
			return err
		}
	}
	return nil
}

func (p *PostgresRepository) RevokeEntitlements(ctx context.Context, userID string, source string) error {
	query := `
		DELETE FROM user_entitlements
		WHERE user_id = $1 AND source = $2
	`
	_, err := p.pool.Exec(ctx, query, userID, source)
	return err
}

func (p *PostgresRepository) GetActiveEntitlements(ctx context.Context, userID string) ([]UserEntitlement, error) {
	query := `
		SELECT id, user_id, entitlement_code, source, granted_at, expires_at, metadata
		FROM user_entitlements
		WHERE user_id = $1 AND expires_at > NOW()
		ORDER BY granted_at DESC
	`
	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ents []UserEntitlement
	for rows.Next() {
		var e UserEntitlement
		var metaJSON []byte
		if err := rows.Scan(&e.ID, &e.UserID, &e.EntitlementCode, &e.Source, &e.GrantedAt, &e.ExpiresAt, &metaJSON); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(metaJSON, &e.Metadata)
		ents = append(ents, e)
	}
	return ents, nil
}

func (p *PostgresRepository) HasEntitlement(ctx context.Context, userID, code string) (bool, error) {
	query := `
		SELECT 1 FROM user_entitlements
		WHERE user_id = $1 AND entitlement_code = $2 AND expires_at > NOW()
		LIMIT 1
	`
	var exists int
	err := p.pool.QueryRow(ctx, query, userID, code).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (p *PostgresRepository) GetBoostCredits(ctx context.Context, userID string) (int, error) {
	query := `SELECT credits_remaining FROM user_boost_credits WHERE user_id = $1`
	var credits int
	err := p.pool.QueryRow(ctx, query, userID).Scan(&credits)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return credits, nil
}

func (p *PostgresRepository) AddBoostCredits(ctx context.Context, userID string, credits int) (int, error) {
	query := `
		INSERT INTO user_boost_credits (user_id, credits_remaining, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET credits_remaining = user_boost_credits.credits_remaining + EXCLUDED.credits_remaining, updated_at = NOW()
		RETURNING credits_remaining
	`
	var total int
	err := p.pool.QueryRow(ctx, query, userID, credits).Scan(&total)
	return total, err
}

func (p *PostgresRepository) ConsumeBoostCredit(ctx context.Context, userID string) (int, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var current int
	err = tx.QueryRow(ctx, `SELECT credits_remaining FROM user_boost_credits WHERE user_id = $1 FOR UPDATE`, userID).Scan(&current)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrInsufficientBoostCredits
		}
		return 0, err
	}

	if current < 1 {
		return current, ErrInsufficientBoostCredits
	}

	var remaining int
	err = tx.QueryRow(
		ctx,
		`UPDATE user_boost_credits SET credits_remaining = credits_remaining - 1, updated_at = NOW() WHERE user_id = $1 RETURNING credits_remaining`,
		userID,
	).Scan(&remaining)
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return remaining, nil
}

func (p *PostgresRepository) CreateProfileBoost(ctx context.Context, boost *ProfileBoost) error {
	query := `
		INSERT INTO profile_boosts (user_id, duration_minutes, multiplier, activated_at, expires_at, status)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`
	return p.pool.QueryRow(
		ctx, query,
		boost.UserID, boost.DurationMinutes, boost.Multiplier, boost.ActivatedAt, boost.ExpiresAt, boost.Status,
	).Scan(&boost.ID)
}

func (p *PostgresRepository) GetActiveProfileBoost(ctx context.Context, userID string) (*ProfileBoost, error) {
	query := `
		SELECT id, user_id, duration_minutes, multiplier, activated_at, expires_at, status
		FROM profile_boosts
		WHERE user_id = $1 AND status = 'ACTIVE' AND expires_at > NOW()
		ORDER BY expires_at DESC
		LIMIT 1
	`
	var b ProfileBoost
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&b.ID, &b.UserID, &b.DurationMinutes, &b.Multiplier, &b.ActivatedAt, &b.ExpiresAt, &b.Status,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &b, nil
}

func (p *PostgresRepository) PublishOutboxEvent(ctx context.Context, event events.Envelope) error {
	query := `
		INSERT INTO outbox_events (
			event_id, aggregate_type, aggregate_id, event_type, schema_version, occurred_at, correlation_id, payload
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := p.pool.Exec(
		ctx, query,
		event.ID, event.AggregateType, event.AggregateID, event.EventType,
		event.SchemaVersion, event.OccurredAt, event.CorrelationID, event.Payload,
	)
	return err
}

func (p *PostgresRepository) ListAllSubscriptions(ctx context.Context, statusFilter, planFilter string, limit, offset int) ([]Subscription, int, error) {
	whereClauses := []string{"1=1"}
	args := []any{}
	argIdx := 1

	if statusFilter != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}
	if planFilter != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("plan_code = $%d", argIdx))
		args = append(args, planFilter)
		argIdx++
	}

	whereSQL := strings.Join(whereClauses, " AND ")
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM subscriptions WHERE %s", whereSQL)
	var total int
	if err := p.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if limit <= 0 {
		limit = 50
	}
	query := fmt.Sprintf("SELECT id, user_id, plan_code, provider, external_subscription_id, status, currency, price_cents, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at FROM subscriptions WHERE %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d", whereSQL, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var subs []Subscription
	for rows.Next() {
		var s Subscription
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.PlanCode, &s.Provider, &s.ExternalSubscriptionID,
			&s.Status, &s.Currency, &s.PriceCents, &s.CurrentPeriodStart, &s.CurrentPeriodEnd,
			&s.CancelAtPeriodEnd, &s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		subs = append(subs, s)
	}
	return subs, total, rows.Err()
}

func (p *PostgresRepository) ListAllTransactions(ctx context.Context, txTypeFilter string, limit, offset int) ([]PaymentTransaction, int, error) {
	whereClauses := []string{"1=1"}
	args := []any{}
	argIdx := 1

	if txTypeFilter != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("transaction_type = $%d", argIdx))
		args = append(args, txTypeFilter)
		argIdx++
	}

	whereSQL := strings.Join(whereClauses, " AND ")
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM payment_transactions WHERE %s", whereSQL)
	var total int
	if err := p.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if limit <= 0 {
		limit = 50
	}
	query := fmt.Sprintf("SELECT id, user_id, subscription_id, provider, external_charge_id, transaction_type, gross_amount_cents, provider_fee_cents, tax_amount_cents, net_amount_cents, currency, billing_cycle_index, occurred_at FROM payment_transactions WHERE %s ORDER BY occurred_at DESC LIMIT $%d OFFSET $%d", whereSQL, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var txs []PaymentTransaction
	for rows.Next() {
		var tx PaymentTransaction
		if err := rows.Scan(
			&tx.ID, &tx.UserID, &tx.SubscriptionID, &tx.Provider, &tx.ExternalChargeID,
			&tx.TransactionType, &tx.GrossAmountCents, &tx.ProviderFeeCents, &tx.TaxAmountCents,
			&tx.NetAmountCents, &tx.Currency, &tx.BillingCycleIndex, &tx.OccurredAt,
		); err != nil {
			return nil, 0, err
		}
		txs = append(txs, tx)
	}
	return txs, total, rows.Err()
}

func (p *PostgresRepository) RefundTransaction(ctx context.Context, txID string, reason string, actorID string) (*PaymentTransaction, error) {
	query := `SELECT id, user_id, subscription_id, provider, external_charge_id, transaction_type, gross_amount_cents, provider_fee_cents, tax_amount_cents, net_amount_cents, currency, billing_cycle_index, occurred_at FROM payment_transactions WHERE id = $1`
	var orig PaymentTransaction
	err := p.pool.QueryRow(ctx, query, txID).Scan(
		&orig.ID, &orig.UserID, &orig.SubscriptionID, &orig.Provider, &orig.ExternalChargeID,
		&orig.TransactionType, &orig.GrossAmountCents, &orig.ProviderFeeCents, &orig.TaxAmountCents,
		&orig.NetAmountCents, &orig.Currency, &orig.BillingCycleIndex, &orig.OccurredAt,
	)
	if err != nil {
		return nil, err
	}
	if orig.TransactionType == TxRefund {
		return nil, errors.New("transaction is already a refund")
	}

	refundID := fmt.Sprintf("tx_ref_%d_%s", time.Now().Unix(), generateRandomString(6))
	refundTx := &PaymentTransaction{
		ID:                refundID,
		UserID:            orig.UserID,
		SubscriptionID:    orig.SubscriptionID,
		Provider:          orig.Provider,
		ExternalChargeID:  "ref_" + orig.ExternalChargeID,
		TransactionType:   TxRefund,
		GrossAmountCents:  -orig.GrossAmountCents,
		ProviderFeeCents:  0,
		TaxAmountCents:    -orig.TaxAmountCents,
		NetAmountCents:    -orig.NetAmountCents,
		Currency:          orig.Currency,
		BillingCycleIndex: orig.BillingCycleIndex,
		OccurredAt:        time.Now().UTC(),
	}

	if err := p.CreateTransaction(ctx, refundTx); err != nil {
		return nil, err
	}

	if orig.SubscriptionID != nil && *orig.SubscriptionID != "" {
		_, _ = p.pool.Exec(ctx, `UPDATE subscriptions SET status = $2, updated_at = NOW() WHERE id = $1`, *orig.SubscriptionID, StatusRefunded)
	}

	return refundTx, nil
}

func (p *PostgresRepository) RecordConsent(ctx context.Context, consent *SubscriptionConsentRecord) error {
	initQuery := `
		CREATE TABLE IF NOT EXISTS subscription_consents (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			plan_code VARCHAR(32) NOT NULL,
			price_cents BIGINT NOT NULL,
			currency CHAR(3) NOT NULL,
			billing_interval VARCHAR(32) NOT NULL,
			terms_version VARCHAR(32) NOT NULL,
			consent_given BOOLEAN NOT NULL DEFAULT TRUE,
			ip_address VARCHAR(45),
			user_agent TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`
	_, _ = p.pool.Exec(ctx, initQuery)

	query := `
		INSERT INTO subscription_consents (
			user_id, plan_code, price_cents, currency, billing_interval, terms_version, consent_given, ip_address, user_agent, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id;
	`
	now := time.Now().UTC()
	if consent.CreatedAt.IsZero() {
		consent.CreatedAt = now
	}
	return p.pool.QueryRow(
		ctx, query,
		consent.UserID, consent.PlanCode, consent.PriceCents, consent.Currency,
		consent.BillingInterval, consent.TermsVersion, consent.ConsentGiven,
		consent.IPAddress, consent.UserAgent, consent.CreatedAt,
	).Scan(&consent.ID)
}

func (p *PostgresRepository) GetLatestConsent(ctx context.Context, userID, planCode string) (*SubscriptionConsentRecord, error) {
	query := `
		SELECT id, user_id, plan_code, price_cents, currency, billing_interval, terms_version, consent_given, ip_address, user_agent, created_at
		FROM subscription_consents
		WHERE user_id = $1 AND plan_code = $2
		ORDER BY created_at DESC
		LIMIT 1;
	`
	var c SubscriptionConsentRecord
	var ip, ua *string
	err := p.pool.QueryRow(ctx, query, userID, planCode).Scan(
		&c.ID, &c.UserID, &c.PlanCode, &c.PriceCents, &c.Currency,
		&c.BillingInterval, &c.TermsVersion, &c.ConsentGiven, &ip, &ua, &c.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if ip != nil {
		c.IPAddress = *ip
	}
	if ua != nil {
		c.UserAgent = *ua
	}
	return &c, nil
}

func generateRandomString(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
