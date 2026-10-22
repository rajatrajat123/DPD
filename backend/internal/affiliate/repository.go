package affiliate

import (
	"context"
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
	CreateAffiliate(ctx context.Context, aff *Affiliate) error
	GetAffiliateByID(ctx context.Context, id string) (*Affiliate, error)
	GetAffiliateByUserID(ctx context.Context, userID string) (*Affiliate, error)
	GetAffiliateByPartnerCode(ctx context.Context, code string) (*Affiliate, error)
	UpdateAffiliateStatus(ctx context.Context, id, status, tier string, taxFormVerified *bool) error
	UpdateAffiliatePayoutSettings(ctx context.Context, id string, req UpdateAffiliatePayoutSettingsRequest) error
	ListAffiliates(ctx context.Context, limit int) ([]Affiliate, error)

	CreateCampaign(ctx context.Context, camp *AffiliateCampaign) error
	GetCampaignBySlug(ctx context.Context, affiliateID, slug string) (*AffiliateCampaign, error)
	ListCampaigns(ctx context.Context, affiliateID string) ([]AffiliateCampaign, error)
	RecordClick(ctx context.Context, click *ReferralClick) error
	GetClickByToken(ctx context.Context, token string) (*ReferralClick, error)
	IncrementCampaignClick(ctx context.Context, affiliateID, slug string) error
	IncrementCampaignConversion(ctx context.Context, affiliateID, slug string) error

	CreateAttribution(ctx context.Context, attr *ReferralAttribution) error
	GetAttributionByReferredUser(ctx context.Context, userID string) (*ReferralAttribution, error)
	ListAttributionsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]ReferralAttribution, error)

	GetCommissionRuleByTier(ctx context.Context, tier string) (*CommissionRule, error)
	ListCommissionRules(ctx context.Context) ([]CommissionRule, error)
	UpsertCommissionRule(ctx context.Context, rule *CommissionRule) error

	CreateCommission(ctx context.Context, comm *AffiliateCommission) error
	GetCommissionByTransactionID(ctx context.Context, transactionID string) (*AffiliateCommission, error)
	ListCommissionsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]AffiliateCommission, error)
	UpdateCommissionStatus(ctx context.Context, id, status string) error
	ListMaturedPendingCommissions(ctx context.Context, before time.Time) ([]AffiliateCommission, error)

	GetOrCreateLedgerAccount(ctx context.Context, accountCode, accountType, currency string, affiliateID *string) (*LedgerAccount, error)
	GetAffiliateBalances(ctx context.Context, affiliateID string) (pendingEscrowCents, payableCents, lifetimePaidCents int64, err error)
	PostJournalEntry(ctx context.Context, journal *LedgerJournal, entries []LedgerEntry) error

	CreatePayoutBatch(ctx context.Context, batch *PayoutBatch) error
	GetPayoutBatchByID(ctx context.Context, id string) (*PayoutBatch, error)
	ListPayoutsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]PayoutBatch, error)
	ListPendingPayouts(ctx context.Context, limit int) ([]PayoutBatch, error)
	UpdatePayoutBatch(ctx context.Context, batch *PayoutBatch) error

	PublishOutboxEvent(ctx context.Context, event events.Envelope) error

	GetUserReferralReward(ctx context.Context, userID string) (*UserReferralReward, error)
	UpsertUserReferralReward(ctx context.Context, reward *UserReferralReward) error
}

// MemoryRepository provides in-memory thread-safe storage for unit testing.
type MemoryRepository struct {
	mu           sync.RWMutex
	seq          uint64
	affiliates   map[string]*Affiliate // id -> aff
	affByUser    map[string]string     // userID -> id
	affByCode    map[string]string     // code -> id
	campaigns    map[string]*AffiliateCampaign
	clicks       map[string]*ReferralClick
	attributions map[string]*ReferralAttribution // referredUserID -> attr
	rules        map[string]*CommissionRule      // tier -> rule
	commissions  map[string]*AffiliateCommission // id -> comm
	commByTx     map[string]string               // txID -> commID
	accounts     map[string]*LedgerAccount       // accountCode -> account
	accountsByID map[string]*LedgerAccount       // accountID -> account
	journals     map[string]*LedgerJournal       // id -> journal
	entries      []LedgerEntry
	payouts      map[string]*PayoutBatch // id -> payout
	userRewards  map[string]*UserReferralReward // userID -> reward
	outboxEvents []events.Envelope
}

func NewMemoryRepository() *MemoryRepository {
	m := &MemoryRepository{
		affiliates:   make(map[string]*Affiliate),
		affByUser:    make(map[string]string),
		affByCode:    make(map[string]string),
		campaigns:    make(map[string]*AffiliateCampaign),
		clicks:       make(map[string]*ReferralClick),
		attributions: make(map[string]*ReferralAttribution),
		rules:        make(map[string]*CommissionRule),
		commissions:  make(map[string]*AffiliateCommission),
		commByTx:     make(map[string]string),
		accounts:     make(map[string]*LedgerAccount),
		accountsByID: make(map[string]*LedgerAccount),
		journals:     make(map[string]*LedgerJournal),
		payouts:      make(map[string]*PayoutBatch),
		userRewards:  make(map[string]*UserReferralReward),
	}

	// Seed default commission rules
	now := time.Now().UTC()
	m.rules[TierStandard] = &CommissionRule{
		ID: "rule_std", Name: "Standard RevShare (25%)", AffiliateTier: TierStandard,
		Model: ModelRevsharePercent, CPAAmountCents: 0, RevshareBps: 2500,
		RecurringEnabled: true, MaxRecurringMonths: 12, EscrowHoldDays: 30, CreatedAt: now,
	}
	m.rules[TierVIP] = &CommissionRule{
		ID: "rule_vip", Name: "VIP Hybrid ($15 CPA + 30% RevShare)", AffiliateTier: TierVIP,
		Model: ModelHybrid, CPAAmountCents: 1500, RevshareBps: 3000,
		RecurringEnabled: true, MaxRecurringMonths: 24, EscrowHoldDays: 14, CreatedAt: now,
	}
	m.rules[TierCPAOnly] = &CommissionRule{
		ID: "rule_cpa", Name: "CPA Bounty ($35 Fixed)", AffiliateTier: TierCPAOnly,
		Model: ModelCPAFixed, CPAAmountCents: 3500, RevshareBps: 0,
		RecurringEnabled: false, MaxRecurringMonths: 0, EscrowHoldDays: 30, CreatedAt: now,
	}

	return m
}

func (m *MemoryRepository) CreateAffiliate(ctx context.Context, aff *Affiliate) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.affByUser[aff.UserID]; exists {
		return ErrAffiliateAlreadyExists
	}
	if aff.ID == "" {
		m.seq++
		aff.ID = fmt.Sprintf("aff_%d_%d", time.Now().UnixNano(), m.seq)
	}
	now := time.Now().UTC()
	aff.CreatedAt = now
	aff.UpdatedAt = now

	cp := *aff
	m.affiliates[aff.ID] = &cp
	m.affByUser[aff.UserID] = aff.ID
	m.affByCode[strings.ToUpper(aff.PartnerCode)] = aff.ID
	return nil
}

func (m *MemoryRepository) GetAffiliateByID(ctx context.Context, id string) (*Affiliate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	aff, ok := m.affiliates[id]
	if !ok {
		return nil, ErrAffiliateNotFound
	}
	cp := *aff
	return &cp, nil
}

func (m *MemoryRepository) GetAffiliateByUserID(ctx context.Context, userID string) (*Affiliate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.affByUser[userID]
	if !ok {
		return nil, ErrAffiliateNotFound
	}
	cp := *m.affiliates[id]
	return &cp, nil
}

func (m *MemoryRepository) GetAffiliateByPartnerCode(ctx context.Context, code string) (*Affiliate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.affByCode[strings.ToUpper(strings.TrimSpace(code))]
	if !ok {
		return nil, ErrAffiliateNotFound
	}
	cp := *m.affiliates[id]
	return &cp, nil
}

func (m *MemoryRepository) UpdateAffiliateStatus(ctx context.Context, id, status, tier string, taxFormVerified *bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	aff, ok := m.affiliates[id]
	if !ok {
		return ErrAffiliateNotFound
	}
	if status != "" {
		aff.Status = status
	}
	if tier != "" {
		aff.Tier = tier
	}
	if taxFormVerified != nil {
		aff.TaxFormVerified = *taxFormVerified
	}
	aff.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) UpdateAffiliatePayoutSettings(ctx context.Context, id string, req UpdateAffiliatePayoutSettingsRequest) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	aff, ok := m.affiliates[id]
	if !ok {
		return ErrAffiliateNotFound
	}
	if req.PayoutMethod != "" {
		aff.PayoutMethod = req.PayoutMethod
	}
	if req.StripeConnectID != "" {
		aff.StripeConnectAccountID = &req.StripeConnectID
	}
	if req.CryptoWalletAddress != "" {
		aff.CryptoWalletAddress = &req.CryptoWalletAddress
	}
	if req.CryptoAsset != "" {
		aff.CryptoAsset = req.CryptoAsset
	}
	if req.CryptoNetwork != "" {
		aff.CryptoNetwork = req.CryptoNetwork
	}
	if req.MinimumPayoutCents > 0 {
		aff.MinimumPayoutCents = req.MinimumPayoutCents
	}
	aff.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) ListAffiliates(ctx context.Context, limit int) ([]Affiliate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []Affiliate
	for _, a := range m.affiliates {
		list = append(list, *a)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) CreateCampaign(ctx context.Context, camp *AffiliateCampaign) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if camp.ID == "" {
		camp.ID = fmt.Sprintf("camp_%d", time.Now().UnixNano())
	}
	now := time.Now().UTC()
	camp.CreatedAt = now
	camp.UpdatedAt = now

	key := fmt.Sprintf("%s:%s", camp.AffiliateID, strings.ToLower(camp.CampaignSlug))
	cp := *camp
	m.campaigns[key] = &cp
	return nil
}

func (m *MemoryRepository) GetCampaignBySlug(ctx context.Context, affiliateID, slug string) (*AffiliateCampaign, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := fmt.Sprintf("%s:%s", affiliateID, strings.ToLower(slug))
	camp, ok := m.campaigns[key]
	if !ok {
		return nil, ErrCampaignNotFound
	}
	cp := *camp
	return &cp, nil
}

func (m *MemoryRepository) ListCampaigns(ctx context.Context, affiliateID string) ([]AffiliateCampaign, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []AffiliateCampaign
	for _, c := range m.campaigns {
		if c.AffiliateID == affiliateID {
			list = append(list, *c)
		}
	}
	return list, nil
}

func (m *MemoryRepository) RecordClick(ctx context.Context, click *ReferralClick) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if click.ID == "" {
		m.seq++
		click.ID = fmt.Sprintf("clk_%d_%d", time.Now().UnixNano(), m.seq)
	}
	if click.ClickedAt.IsZero() {
		click.ClickedAt = time.Now().UTC()
	}
	cp := *click
	m.clicks[click.ClickToken] = &cp
	return nil
}

func (m *MemoryRepository) GetClickByToken(ctx context.Context, token string) (*ReferralClick, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	click, ok := m.clicks[token]
	if !ok {
		return nil, nil
	}
	cp := *click
	return &cp, nil
}

func (m *MemoryRepository) IncrementCampaignClick(ctx context.Context, affiliateID, slug string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%s:%s", affiliateID, strings.ToLower(slug))
	if camp, ok := m.campaigns[key]; ok {
		camp.ClicksCount++
	}
	return nil
}

func (m *MemoryRepository) IncrementCampaignConversion(ctx context.Context, affiliateID, slug string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := fmt.Sprintf("%s:%s", affiliateID, strings.ToLower(slug))
	if camp, ok := m.campaigns[key]; ok {
		camp.ConversionsCount++
	}
	return nil
}

func (m *MemoryRepository) CreateAttribution(ctx context.Context, attr *ReferralAttribution) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if attr.ID == "" {
		m.seq++
		attr.ID = fmt.Sprintf("attr_%d_%d", time.Now().UnixNano(), m.seq)
	}
	if attr.AttributedAt.IsZero() {
		attr.AttributedAt = time.Now().UTC()
	}
	cp := *attr
	m.attributions[attr.ReferredUserID] = &cp
	return nil
}

func (m *MemoryRepository) GetAttributionByReferredUser(ctx context.Context, userID string) (*ReferralAttribution, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	attr, ok := m.attributions[userID]
	if !ok {
		return nil, nil
	}
	cp := *attr
	return &cp, nil
}

func (m *MemoryRepository) ListAttributionsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]ReferralAttribution, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []ReferralAttribution
	for _, a := range m.attributions {
		if a.AffiliateID == affiliateID {
			list = append(list, *a)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].AttributedAt.After(list[j].AttributedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) GetCommissionRuleByTier(ctx context.Context, tier string) (*CommissionRule, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	rule, ok := m.rules[tier]
	if !ok {
		rule, ok = m.rules[TierStandard]
	}
	if !ok {
		return nil, ErrCommissionRuleNotFound
	}
	cp := *rule
	return &cp, nil
}

func (m *MemoryRepository) ListCommissionRules(ctx context.Context) ([]CommissionRule, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []CommissionRule
	for _, r := range m.rules {
		list = append(list, *r)
	}
	return list, nil
}

func (m *MemoryRepository) UpsertCommissionRule(ctx context.Context, rule *CommissionRule) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if rule.ID == "" {
		rule.ID = fmt.Sprintf("rule_%d", time.Now().UnixNano())
	}
	rule.CreatedAt = time.Now().UTC()
	cp := *rule
	m.rules[rule.AffiliateTier] = &cp
	return nil
}

func (m *MemoryRepository) CreateCommission(ctx context.Context, comm *AffiliateCommission) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.commByTx[comm.TransactionID]; exists {
		return ErrDuplicateCommission
	}

	if comm.ID == "" {
		comm.ID = fmt.Sprintf("comm_%d", time.Now().UnixNano())
	}
	now := time.Now().UTC()
	comm.CreatedAt = now
	comm.UpdatedAt = now

	cp := *comm
	m.commissions[comm.ID] = &cp
	m.commByTx[comm.TransactionID] = comm.ID
	return nil
}

func (m *MemoryRepository) GetCommissionByTransactionID(ctx context.Context, transactionID string) (*AffiliateCommission, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	id, ok := m.commByTx[transactionID]
	if !ok {
		return nil, nil
	}
	cp := *m.commissions[id]
	return &cp, nil
}

func (m *MemoryRepository) ListCommissionsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]AffiliateCommission, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []AffiliateCommission
	for _, c := range m.commissions {
		if c.AffiliateID == affiliateID {
			list = append(list, *c)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) UpdateCommissionStatus(ctx context.Context, id, status string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	c, ok := m.commissions[id]
	if !ok {
		return errors.New("commission not found")
	}
	c.Status = status
	c.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) ListMaturedPendingCommissions(ctx context.Context, before time.Time) ([]AffiliateCommission, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []AffiliateCommission
	for _, c := range m.commissions {
		if c.Status == CommissionPendingClearance && (c.MaturesAt.Before(before) || c.MaturesAt.Equal(before)) {
			list = append(list, *c)
		}
	}
	return list, nil
}

func (m *MemoryRepository) GetOrCreateLedgerAccount(ctx context.Context, accountCode, accountType, currency string, affiliateID *string) (*LedgerAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if acc, ok := m.accounts[accountCode]; ok {
		cp := *acc
		return &cp, nil
	}

	m.seq++
	now := time.Now().UTC()
	acc := &LedgerAccount{
		ID:           fmt.Sprintf("acc_%d_%d", now.UnixNano(), m.seq),
		AccountCode:  accountCode,
		AccountType:  accountType,
		AffiliateID:  affiliateID,
		Currency:     currency,
		BalanceCents: 0,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	m.accounts[accountCode] = acc
	m.accountsByID[acc.ID] = acc
	cp := *acc
	return &cp, nil
}

func (m *MemoryRepository) GetAffiliateBalances(ctx context.Context, affiliateID string) (int64, int64, int64, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	escrowCode := fmt.Sprintf("2100_PENDING_ESCROW_%s", affiliateID)
	payableCode := fmt.Sprintf("2200_PAYABLE_AVAILABLE_%s", affiliateID)

	var pendingEscrow, payable int64
	if acc, ok := m.accounts[escrowCode]; ok {
		pendingEscrow = acc.BalanceCents
	}
	if acc, ok := m.accounts[payableCode]; ok {
		payable = acc.BalanceCents
	}

	var lifetimePaid int64
	for _, p := range m.payouts {
		if p.AffiliateID == affiliateID && p.Status == PayoutPaid {
			lifetimePaid += p.AmountCents
		}
	}

	return pendingEscrow, payable, lifetimePaid, nil
}

func (m *MemoryRepository) PostJournalEntry(ctx context.Context, journal *LedgerJournal, entries []LedgerEntry) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var totalDebit, totalCredit int64
	for _, e := range entries {
		if e.AmountCents <= 0 {
			return errors.New("ledger entry amount must be strictly positive")
		}
		switch e.Direction {
		case EntryDebit:
			totalDebit += e.AmountCents
		case EntryCredit:
			totalCredit += e.AmountCents
		default:
			return errors.New("invalid entry direction")
		}
	}

	if totalDebit != totalCredit {
		return fmt.Errorf("%w: debit=%d credit=%d", ErrLedgerUnbalanced, totalDebit, totalCredit)
	}

	if journal.ID == "" {
		m.seq++
		journal.ID = fmt.Sprintf("jnl_%d_%d", time.Now().UnixNano(), m.seq)
	}
	if journal.PostedAt.IsZero() {
		journal.PostedAt = time.Now().UTC()
	}

	cpJ := *journal
	m.journals[journal.ID] = &cpJ

	for _, e := range entries {
		acc, ok := m.accountsByID[e.AccountID]
		if !ok {
			acc, ok = m.accounts[e.AccountID]
		}
		if !ok || acc == nil {
			return fmt.Errorf("ledger account %s not found", e.AccountID)
		}

		// Double-entry balance calculation:
		// ASSET & EXPENSE: debit increases (+), credit decreases (-)
		// LIABILITY & REVENUE: credit increases (+), debit decreases (-)
		switch acc.AccountType {
		case AccountTypeAsset, AccountTypeExpense:
			if e.Direction == EntryDebit {
				acc.BalanceCents += e.AmountCents
			} else {
				acc.BalanceCents -= e.AmountCents
			}
		case AccountTypeLiability, AccountTypeRevenue:
			if e.Direction == EntryCredit {
				acc.BalanceCents += e.AmountCents
			} else {
				acc.BalanceCents -= e.AmountCents
			}
		}
		acc.UpdatedAt = time.Now().UTC()

		e.JournalID = journal.ID
		if e.ID == "" {
			m.seq++
			e.ID = fmt.Sprintf("ent_%d_%d", time.Now().UnixNano(), m.seq)
		}
		e.CreatedAt = time.Now().UTC()
		m.entries = append(m.entries, e)
	}

	return nil
}

func (m *MemoryRepository) CreatePayoutBatch(ctx context.Context, batch *PayoutBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if batch.ID == "" {
		batch.ID = fmt.Sprintf("payout_%d", time.Now().UnixNano())
	}
	batch.CreatedAt = time.Now().UTC()
	cp := *batch
	m.payouts[batch.ID] = &cp
	return nil
}

func (m *MemoryRepository) GetPayoutBatchByID(ctx context.Context, id string) (*PayoutBatch, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	p, ok := m.payouts[id]
	if !ok {
		return nil, ErrPayoutBatchNotFound
	}
	cp := *p
	return &cp, nil
}

func (m *MemoryRepository) ListPayoutsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]PayoutBatch, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []PayoutBatch
	for _, p := range m.payouts {
		if p.AffiliateID == affiliateID {
			list = append(list, *p)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) ListPendingPayouts(ctx context.Context, limit int) ([]PayoutBatch, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []PayoutBatch
	for _, p := range m.payouts {
		if p.Status == PayoutPendingApproval {
			list = append(list, *p)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.Before(list[j].CreatedAt)
	})
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

func (m *MemoryRepository) UpdatePayoutBatch(ctx context.Context, batch *PayoutBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	p, ok := m.payouts[batch.ID]
	if !ok {
		return ErrPayoutBatchNotFound
	}
	p.Status = batch.Status
	p.ExternalPayoutID = batch.ExternalPayoutID
	p.FailureReason = batch.FailureReason
	p.JournalID = batch.JournalID
	p.ProcessedAt = batch.ProcessedAt
	return nil
}

func (m *MemoryRepository) PublishOutboxEvent(ctx context.Context, event events.Envelope) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.outboxEvents = append(m.outboxEvents, event)
	return nil
}

func (m *MemoryRepository) GetUserReferralReward(_ context.Context, userID string) (*UserReferralReward, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.userRewards[userID]
	if !ok {
		return nil, nil
	}
	cpy := *r
	return &cpy, nil
}

func (m *MemoryRepository) UpsertUserReferralReward(_ context.Context, reward *UserReferralReward) error {
	if reward == nil || reward.UserID == "" {
		return errors.New("reward and userID are required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if reward.ID == "" {
		m.seq++
		reward.ID = fmt.Sprintf("rew_%d_%d", time.Now().UnixNano(), m.seq)
	}
	now := time.Now().UTC()
	if reward.CreatedAt.IsZero() {
		reward.CreatedAt = now
	}
	reward.UpdatedAt = now
	cpy := *reward
	m.userRewards[reward.UserID] = &cpy
	return nil
}

// PostgresRepository implements Repository using PostgreSQL.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) CreateAffiliate(ctx context.Context, aff *Affiliate) error {
	query := `
		INSERT INTO affiliates (
			user_id, partner_code, status, tier, payout_currency, stripe_connect_account_id,
			tax_form_verified, terms_accepted_at, terms_version, payout_method,
			crypto_wallet_address, crypto_asset, crypto_network, minimum_payout_cents
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING id, created_at, updated_at
	`
	return p.pool.QueryRow(
		ctx, query,
		aff.UserID, aff.PartnerCode, aff.Status, aff.Tier, aff.PayoutCurrency, aff.StripeConnectAccountID,
		aff.TaxFormVerified, aff.TermsAcceptedAt, aff.TermsVersion, aff.PayoutMethod,
		aff.CryptoWalletAddress, aff.CryptoAsset, aff.CryptoNetwork, aff.MinimumPayoutCents,
	).Scan(&aff.ID, &aff.CreatedAt, &aff.UpdatedAt)
}

func (p *PostgresRepository) GetAffiliateByID(ctx context.Context, id string) (*Affiliate, error) {
	query := `
		SELECT id, user_id, partner_code, status, tier, payout_currency, stripe_connect_account_id,
		       tax_form_verified, terms_accepted_at, terms_version, payout_method,
		       crypto_wallet_address, crypto_asset, crypto_network, minimum_payout_cents,
		       created_at, updated_at
		FROM affiliates
		WHERE id = $1
	`
	var a Affiliate
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&a.ID, &a.UserID, &a.PartnerCode, &a.Status, &a.Tier, &a.PayoutCurrency, &a.StripeConnectAccountID,
		&a.TaxFormVerified, &a.TermsAcceptedAt, &a.TermsVersion, &a.PayoutMethod,
		&a.CryptoWalletAddress, &a.CryptoAsset, &a.CryptoNetwork, &a.MinimumPayoutCents,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAffiliateNotFound
		}
		return nil, err
	}
	return &a, nil
}

func (p *PostgresRepository) GetAffiliateByUserID(ctx context.Context, userID string) (*Affiliate, error) {
	query := `
		SELECT id, user_id, partner_code, status, tier, payout_currency, stripe_connect_account_id,
		       tax_form_verified, terms_accepted_at, terms_version, payout_method,
		       crypto_wallet_address, crypto_asset, crypto_network, minimum_payout_cents,
		       created_at, updated_at
		FROM affiliates
		WHERE user_id = $1
	`
	var a Affiliate
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&a.ID, &a.UserID, &a.PartnerCode, &a.Status, &a.Tier, &a.PayoutCurrency, &a.StripeConnectAccountID,
		&a.TaxFormVerified, &a.TermsAcceptedAt, &a.TermsVersion, &a.PayoutMethod,
		&a.CryptoWalletAddress, &a.CryptoAsset, &a.CryptoNetwork, &a.MinimumPayoutCents,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAffiliateNotFound
		}
		return nil, err
	}
	return &a, nil
}

func (p *PostgresRepository) GetAffiliateByPartnerCode(ctx context.Context, code string) (*Affiliate, error) {
	query := `
		SELECT id, user_id, partner_code, status, tier, payout_currency, stripe_connect_account_id,
		       tax_form_verified, terms_accepted_at, terms_version, payout_method,
		       crypto_wallet_address, crypto_asset, crypto_network, minimum_payout_cents,
		       created_at, updated_at
		FROM affiliates
		WHERE UPPER(partner_code) = UPPER($1)
	`
	var a Affiliate
	err := p.pool.QueryRow(ctx, query, code).Scan(
		&a.ID, &a.UserID, &a.PartnerCode, &a.Status, &a.Tier, &a.PayoutCurrency, &a.StripeConnectAccountID,
		&a.TaxFormVerified, &a.TermsAcceptedAt, &a.TermsVersion, &a.PayoutMethod,
		&a.CryptoWalletAddress, &a.CryptoAsset, &a.CryptoNetwork, &a.MinimumPayoutCents,
		&a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAffiliateNotFound
		}
		return nil, err
	}
	return &a, nil
}

func (p *PostgresRepository) UpdateAffiliateStatus(ctx context.Context, id, status, tier string, taxFormVerified *bool) error {
	query := `
		UPDATE affiliates
		SET status = COALESCE(NULLIF($2, ''), status),
		    tier = COALESCE(NULLIF($3, ''), tier),
		    tax_form_verified = COALESCE($4, tax_form_verified),
		    updated_at = NOW()
		WHERE id = $1
	`
	_, err := p.pool.Exec(ctx, query, id, status, tier, taxFormVerified)
	return err
}

func (p *PostgresRepository) UpdateAffiliatePayoutSettings(ctx context.Context, id string, req UpdateAffiliatePayoutSettingsRequest) error {
	query := `
		UPDATE affiliates
		SET payout_method = COALESCE(NULLIF($2, ''), payout_method),
		    stripe_connect_account_id = COALESCE(NULLIF($3, ''), stripe_connect_account_id),
		    crypto_wallet_address = COALESCE(NULLIF($4, ''), crypto_wallet_address),
		    crypto_asset = COALESCE(NULLIF($5, ''), crypto_asset),
		    crypto_network = COALESCE(NULLIF($6, ''), crypto_network),
		    minimum_payout_cents = CASE WHEN $7 > 0 THEN $7 ELSE minimum_payout_cents END,
		    updated_at = NOW()
		WHERE id = $1
	`
	_, err := p.pool.Exec(ctx, query, id, req.PayoutMethod, req.StripeConnectID, req.CryptoWalletAddress, req.CryptoAsset, req.CryptoNetwork, req.MinimumPayoutCents)
	return err
}

func (p *PostgresRepository) ListAffiliates(ctx context.Context, limit int) ([]Affiliate, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT id, user_id, partner_code, status, tier, payout_currency, stripe_connect_account_id,
		       tax_form_verified, terms_accepted_at, terms_version, payout_method,
		       crypto_wallet_address, crypto_asset, crypto_network, minimum_payout_cents,
		       created_at, updated_at
		FROM affiliates
		ORDER BY created_at DESC
		LIMIT $1
	`
	rows, err := p.pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Affiliate
	for rows.Next() {
		var a Affiliate
		if err := rows.Scan(
			&a.ID, &a.UserID, &a.PartnerCode, &a.Status, &a.Tier, &a.PayoutCurrency, &a.StripeConnectAccountID,
			&a.TaxFormVerified, &a.TermsAcceptedAt, &a.TermsVersion, &a.PayoutMethod,
			&a.CryptoWalletAddress, &a.CryptoAsset, &a.CryptoNetwork, &a.MinimumPayoutCents,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, nil
}

func (p *PostgresRepository) CreateCampaign(ctx context.Context, camp *AffiliateCampaign) error {
	query := `
		INSERT INTO affiliate_campaigns (affiliate_id, campaign_slug, name, destination_url)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at, updated_at
	`
	return p.pool.QueryRow(ctx, query, camp.AffiliateID, camp.CampaignSlug, camp.Name, camp.DestinationURL).Scan(&camp.ID, &camp.CreatedAt, &camp.UpdatedAt)
}

func (p *PostgresRepository) GetCampaignBySlug(ctx context.Context, affiliateID, slug string) (*AffiliateCampaign, error) {
	query := `
		SELECT id, affiliate_id, campaign_slug, name, destination_url, clicks_count, conversions_count, is_active, created_at, updated_at
		FROM affiliate_campaigns
		WHERE affiliate_id = $1 AND campaign_slug = $2
	`
	var c AffiliateCampaign
	err := p.pool.QueryRow(ctx, query, affiliateID, slug).Scan(
		&c.ID, &c.AffiliateID, &c.CampaignSlug, &c.Name, &c.DestinationURL, &c.ClicksCount, &c.ConversionsCount, &c.IsActive, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCampaignNotFound
		}
		return nil, err
	}
	return &c, nil
}

func (p *PostgresRepository) ListCampaigns(ctx context.Context, affiliateID string) ([]AffiliateCampaign, error) {
	query := `
		SELECT id, affiliate_id, campaign_slug, name, destination_url, clicks_count, conversions_count, is_active, created_at, updated_at
		FROM affiliate_campaigns
		WHERE affiliate_id = $1
		ORDER BY created_at DESC
	`
	rows, err := p.pool.Query(ctx, query, affiliateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []AffiliateCampaign
	for rows.Next() {
		var c AffiliateCampaign
		if err := rows.Scan(&c.ID, &c.AffiliateID, &c.CampaignSlug, &c.Name, &c.DestinationURL, &c.ClicksCount, &c.ConversionsCount, &c.IsActive, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, nil
}

func (p *PostgresRepository) RecordClick(ctx context.Context, click *ReferralClick) error {
	query := `
		INSERT INTO referral_clicks (affiliate_id, partner_code, campaign_slug, click_token, ip_hash, user_agent_hash, landing_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, clicked_at
	`
	return p.pool.QueryRow(ctx, query, click.AffiliateID, click.PartnerCode, click.CampaignSlug, click.ClickToken, click.IPHash, click.UserAgentHash, click.LandingURL).Scan(&click.ID, &click.ClickedAt)
}

func (p *PostgresRepository) GetClickByToken(ctx context.Context, token string) (*ReferralClick, error) {
	query := `
		SELECT id, affiliate_id, partner_code, campaign_slug, click_token, ip_hash, user_agent_hash, landing_url, clicked_at
		FROM referral_clicks
		WHERE click_token = $1
	`
	var c ReferralClick
	err := p.pool.QueryRow(ctx, query, token).Scan(
		&c.ID, &c.AffiliateID, &c.PartnerCode, &c.CampaignSlug, &c.ClickToken,
		&c.IPHash, &c.UserAgentHash, &c.LandingURL, &c.ClickedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func (p *PostgresRepository) IncrementCampaignClick(ctx context.Context, affiliateID, slug string) error {
	query := `
		UPDATE affiliate_campaigns
		SET clicks_count = clicks_count + 1, updated_at = NOW()
		WHERE affiliate_id = $1 AND campaign_slug = $2
	`
	_, err := p.pool.Exec(ctx, query, affiliateID, slug)
	return err
}

func (p *PostgresRepository) IncrementCampaignConversion(ctx context.Context, affiliateID, slug string) error {
	query := `
		UPDATE affiliate_campaigns
		SET conversions_count = conversions_count + 1, updated_at = NOW()
		WHERE affiliate_id = $1 AND campaign_slug = $2
	`
	_, err := p.pool.Exec(ctx, query, affiliateID, slug)
	return err
}

func (p *PostgresRepository) CreateAttribution(ctx context.Context, attr *ReferralAttribution) error {
	query := `
		INSERT INTO referral_attributions (referred_user_id, affiliate_id, partner_code, sub_campaign)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (referred_user_id) DO NOTHING
		RETURNING id, attributed_at
	`
	return p.pool.QueryRow(ctx, query, attr.ReferredUserID, attr.AffiliateID, attr.PartnerCode, attr.SubCampaign).Scan(&attr.ID, &attr.AttributedAt)
}

func (p *PostgresRepository) GetAttributionByReferredUser(ctx context.Context, userID string) (*ReferralAttribution, error) {
	query := `
		SELECT id, referred_user_id, affiliate_id, partner_code, sub_campaign, attributed_at
		FROM referral_attributions
		WHERE referred_user_id = $1
	`
	var a ReferralAttribution
	err := p.pool.QueryRow(ctx, query, userID).Scan(&a.ID, &a.ReferredUserID, &a.AffiliateID, &a.PartnerCode, &a.SubCampaign, &a.AttributedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}

func (p *PostgresRepository) ListAttributionsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]ReferralAttribution, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT id, referred_user_id, affiliate_id, partner_code, sub_campaign, attributed_at
		FROM referral_attributions
		WHERE affiliate_id = $1
		ORDER BY attributed_at DESC
		LIMIT $2
	`
	rows, err := p.pool.Query(ctx, query, affiliateID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ReferralAttribution
	for rows.Next() {
		var a ReferralAttribution
		if err := rows.Scan(&a.ID, &a.ReferredUserID, &a.AffiliateID, &a.PartnerCode, &a.SubCampaign, &a.AttributedAt); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, nil
}

func (p *PostgresRepository) GetCommissionRuleByTier(ctx context.Context, tier string) (*CommissionRule, error) {
	query := `
		SELECT id, name, affiliate_tier, model, cpa_amount_cents, revshare_bps, recurring_enabled, max_recurring_months, escrow_hold_days, created_at
		FROM commission_rules
		WHERE affiliate_tier = $1
	`
	var r CommissionRule
	err := p.pool.QueryRow(ctx, query, tier).Scan(
		&r.ID, &r.Name, &r.AffiliateTier, &r.Model, &r.CPAAmountCents, &r.RevshareBps, &r.RecurringEnabled, &r.MaxRecurringMonths, &r.EscrowHoldDays, &r.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Fallback to STANDARD tier
			err = p.pool.QueryRow(ctx, query, TierStandard).Scan(
				&r.ID, &r.Name, &r.AffiliateTier, &r.Model, &r.CPAAmountCents, &r.RevshareBps, &r.RecurringEnabled, &r.MaxRecurringMonths, &r.EscrowHoldDays, &r.CreatedAt,
			)
			if err != nil {
				return nil, ErrCommissionRuleNotFound
			}
			return &r, nil
		}
		return nil, err
	}
	return &r, nil
}

func (p *PostgresRepository) ListCommissionRules(ctx context.Context) ([]CommissionRule, error) {
	query := `
		SELECT id, name, affiliate_tier, model, cpa_amount_cents, revshare_bps, recurring_enabled, max_recurring_months, escrow_hold_days, created_at
		FROM commission_rules
		ORDER BY created_at ASC
	`
	rows, err := p.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []CommissionRule
	for rows.Next() {
		var r CommissionRule
		if err := rows.Scan(&r.ID, &r.Name, &r.AffiliateTier, &r.Model, &r.CPAAmountCents, &r.RevshareBps, &r.RecurringEnabled, &r.MaxRecurringMonths, &r.EscrowHoldDays, &r.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	return list, nil
}

func (p *PostgresRepository) UpsertCommissionRule(ctx context.Context, rule *CommissionRule) error {
	query := `
		INSERT INTO commission_rules (name, affiliate_tier, model, cpa_amount_cents, revshare_bps, recurring_enabled, max_recurring_months, escrow_hold_days)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (affiliate_tier)
		DO UPDATE SET
			name = EXCLUDED.name,
			model = EXCLUDED.model,
			cpa_amount_cents = EXCLUDED.cpa_amount_cents,
			revshare_bps = EXCLUDED.revshare_bps,
			recurring_enabled = EXCLUDED.recurring_enabled,
			max_recurring_months = EXCLUDED.max_recurring_months,
			escrow_hold_days = EXCLUDED.escrow_hold_days
		RETURNING id, created_at
	`
	return p.pool.QueryRow(
		ctx, query,
		rule.Name, rule.AffiliateTier, rule.Model, rule.CPAAmountCents, rule.RevshareBps, rule.RecurringEnabled, rule.MaxRecurringMonths, rule.EscrowHoldDays,
	).Scan(&rule.ID, &rule.CreatedAt)
}

func (p *PostgresRepository) CreateCommission(ctx context.Context, comm *AffiliateCommission) error {
	query := `
		INSERT INTO affiliate_commissions (
			affiliate_id, transaction_id, referred_user_id, rule_snapshot, gross_amount_cents,
			commission_amount_cents, currency, billing_cycle_index, status, matures_at, journal_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (affiliate_id, transaction_id) DO NOTHING
		RETURNING id, created_at, updated_at
	`
	snapJSON, _ := json.Marshal(comm.RuleSnapshot)
	err := p.pool.QueryRow(
		ctx, query,
		comm.AffiliateID, comm.TransactionID, comm.ReferredUserID, snapJSON, comm.GrossAmountCents,
		comm.CommissionAmountCents, comm.Currency, comm.BillingCycleIndex, comm.Status, comm.MaturesAt, comm.JournalID,
	).Scan(&comm.ID, &comm.CreatedAt, &comm.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDuplicateCommission
		}
		return err
	}
	return nil
}

func (p *PostgresRepository) GetCommissionByTransactionID(ctx context.Context, transactionID string) (*AffiliateCommission, error) {
	query := `
		SELECT id, affiliate_id, transaction_id, referred_user_id, rule_snapshot, gross_amount_cents,
		       commission_amount_cents, currency, billing_cycle_index, status, matures_at, journal_id, created_at, updated_at
		FROM affiliate_commissions
		WHERE transaction_id = $1
		LIMIT 1
	`
	var c AffiliateCommission
	var snapJSON []byte
	err := p.pool.QueryRow(ctx, query, transactionID).Scan(
		&c.ID, &c.AffiliateID, &c.TransactionID, &c.ReferredUserID, &snapJSON, &c.GrossAmountCents,
		&c.CommissionAmountCents, &c.Currency, &c.BillingCycleIndex, &c.Status, &c.MaturesAt, &c.JournalID, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	_ = json.Unmarshal(snapJSON, &c.RuleSnapshot)
	return &c, nil
}

func (p *PostgresRepository) ListCommissionsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]AffiliateCommission, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT id, affiliate_id, transaction_id, referred_user_id, rule_snapshot, gross_amount_cents,
		       commission_amount_cents, currency, billing_cycle_index, status, matures_at, journal_id, created_at, updated_at
		FROM affiliate_commissions
		WHERE affiliate_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`
	rows, err := p.pool.Query(ctx, query, affiliateID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []AffiliateCommission
	for rows.Next() {
		var c AffiliateCommission
		var snapJSON []byte
		if err := rows.Scan(
			&c.ID, &c.AffiliateID, &c.TransactionID, &c.ReferredUserID, &snapJSON, &c.GrossAmountCents,
			&c.CommissionAmountCents, &c.Currency, &c.BillingCycleIndex, &c.Status, &c.MaturesAt, &c.JournalID, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(snapJSON, &c.RuleSnapshot)
		list = append(list, c)
	}
	return list, nil
}

func (p *PostgresRepository) UpdateCommissionStatus(ctx context.Context, id, status string) error {
	query := `UPDATE affiliate_commissions SET status = $2, updated_at = NOW() WHERE id = $1`
	_, err := p.pool.Exec(ctx, query, id, status)
	return err
}

func (p *PostgresRepository) ListMaturedPendingCommissions(ctx context.Context, before time.Time) ([]AffiliateCommission, error) {
	query := `
		SELECT id, affiliate_id, transaction_id, referred_user_id, rule_snapshot, gross_amount_cents,
		       commission_amount_cents, currency, billing_cycle_index, status, matures_at, journal_id, created_at, updated_at
		FROM affiliate_commissions
		WHERE status = 'PENDING_CLEARANCE' AND matures_at <= $1
		ORDER BY matures_at ASC
	`
	rows, err := p.pool.Query(ctx, query, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []AffiliateCommission
	for rows.Next() {
		var c AffiliateCommission
		var snapJSON []byte
		if err := rows.Scan(
			&c.ID, &c.AffiliateID, &c.TransactionID, &c.ReferredUserID, &snapJSON, &c.GrossAmountCents,
			&c.CommissionAmountCents, &c.Currency, &c.BillingCycleIndex, &c.Status, &c.MaturesAt, &c.JournalID, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(snapJSON, &c.RuleSnapshot)
		list = append(list, c)
	}
	return list, nil
}

func (p *PostgresRepository) GetOrCreateLedgerAccount(ctx context.Context, accountCode, accountType, currency string, affiliateID *string) (*LedgerAccount, error) {
	query := `
		INSERT INTO ledger_accounts (account_code, account_type, currency, affiliate_id, balance_cents)
		VALUES ($1, $2, $3, $4, 0)
		ON CONFLICT (account_code) DO NOTHING
	`
	_, _ = p.pool.Exec(ctx, query, accountCode, accountType, currency, affiliateID)

	selectQuery := `
		SELECT id, account_code, account_type, affiliate_id, currency, balance_cents, created_at, updated_at
		FROM ledger_accounts
		WHERE account_code = $1
	`
	var a LedgerAccount
	err := p.pool.QueryRow(ctx, selectQuery, accountCode).Scan(
		&a.ID, &a.AccountCode, &a.AccountType, &a.AffiliateID, &a.Currency, &a.BalanceCents, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (p *PostgresRepository) GetAffiliateBalances(ctx context.Context, affiliateID string) (int64, int64, int64, error) {
	escrowCode := fmt.Sprintf("2100_PENDING_ESCROW_%s", affiliateID)
	payableCode := fmt.Sprintf("2200_PAYABLE_AVAILABLE_%s", affiliateID)

	var pendingEscrow, payable int64
	_ = p.pool.QueryRow(ctx, `SELECT balance_cents FROM ledger_accounts WHERE account_code = $1`, escrowCode).Scan(&pendingEscrow)
	_ = p.pool.QueryRow(ctx, `SELECT balance_cents FROM ledger_accounts WHERE account_code = $1`, payableCode).Scan(&payable)

	var lifetimePaid int64
	_ = p.pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_cents), 0) FROM payout_batches WHERE affiliate_id = $1 AND status = 'PAID'`, affiliateID).Scan(&lifetimePaid)

	return pendingEscrow, payable, lifetimePaid, nil
}

func (p *PostgresRepository) PostJournalEntry(ctx context.Context, journal *LedgerJournal, entries []LedgerEntry) error {
	var totalDebit, totalCredit int64
	for _, e := range entries {
		if e.AmountCents <= 0 {
			return errors.New("ledger entry amount must be strictly positive")
		}
		switch e.Direction {
		case EntryDebit:
			totalDebit += e.AmountCents
		case EntryCredit:
			totalCredit += e.AmountCents
		default:
			return errors.New("invalid entry direction")
		}
	}

	if totalDebit != totalCredit {
		return fmt.Errorf("%w: debit=%d credit=%d", ErrLedgerUnbalanced, totalDebit, totalCredit)
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	insertJournal := `
		INSERT INTO ledger_journals (reference_type, reference_id, description, currency)
		VALUES ($1, $2, $3, $4)
		RETURNING id, posted_at
	`
	if err := tx.QueryRow(ctx, insertJournal, journal.ReferenceType, journal.ReferenceID, journal.Description, journal.Currency).Scan(&journal.ID, &journal.PostedAt); err != nil {
		return err
	}

	for _, e := range entries {
		var accType string
		err := tx.QueryRow(ctx, `SELECT account_type FROM ledger_accounts WHERE id = $1 FOR UPDATE`, e.AccountID).Scan(&accType)
		if err != nil {
			return fmt.Errorf("failed to fetch ledger account %s: %w", e.AccountID, err)
		}

		// Update balance according to account type
		var balanceDelta int64
		switch accType {
		case AccountTypeAsset, AccountTypeExpense:
			if e.Direction == EntryDebit {
				balanceDelta = e.AmountCents
			} else {
				balanceDelta = -e.AmountCents
			}
		case AccountTypeLiability, AccountTypeRevenue:
			if e.Direction == EntryCredit {
				balanceDelta = e.AmountCents
			} else {
				balanceDelta = -e.AmountCents
			}
		}

		updateAcc := `UPDATE ledger_accounts SET balance_cents = balance_cents + $2, updated_at = NOW() WHERE id = $1`
		if _, err := tx.Exec(ctx, updateAcc, e.AccountID, balanceDelta); err != nil {
			return err
		}

		insertEntry := `
			INSERT INTO ledger_entries (journal_id, account_id, direction, amount_cents)
			VALUES ($1, $2, $3, $4)
			RETURNING id
		`
		if _, err := tx.Exec(ctx, insertEntry, journal.ID, e.AccountID, e.Direction, e.AmountCents); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (p *PostgresRepository) CreatePayoutBatch(ctx context.Context, batch *PayoutBatch) error {
	query := `
		INSERT INTO payout_batches (
			affiliate_id, amount_cents, currency, payout_method, destination_reference,
			crypto_asset, crypto_network, status, external_payout_id, failure_reason, journal_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at
	`
	return p.pool.QueryRow(
		ctx, query,
		batch.AffiliateID, batch.AmountCents, batch.Currency, batch.PayoutMethod, batch.DestinationReference,
		batch.CryptoAsset, batch.CryptoNetwork, batch.Status, batch.ExternalPayoutID, batch.FailureReason, batch.JournalID,
	).Scan(&batch.ID, &batch.CreatedAt)
}

func (p *PostgresRepository) GetPayoutBatchByID(ctx context.Context, id string) (*PayoutBatch, error) {
	query := `
		SELECT id, affiliate_id, amount_cents, currency, payout_method, destination_reference,
		       crypto_asset, crypto_network, status, external_payout_id, failure_reason, journal_id, created_at, processed_at
		FROM payout_batches
		WHERE id = $1
	`
	var b PayoutBatch
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&b.ID, &b.AffiliateID, &b.AmountCents, &b.Currency, &b.PayoutMethod, &b.DestinationReference,
		&b.CryptoAsset, &b.CryptoNetwork, &b.Status, &b.ExternalPayoutID, &b.FailureReason, &b.JournalID, &b.CreatedAt, &b.ProcessedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPayoutBatchNotFound
		}
		return nil, err
	}
	return &b, nil
}

func (p *PostgresRepository) ListPayoutsByAffiliate(ctx context.Context, affiliateID string, limit int) ([]PayoutBatch, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT id, affiliate_id, amount_cents, currency, payout_method, destination_reference,
		       crypto_asset, crypto_network, status, external_payout_id, failure_reason, journal_id, created_at, processed_at
		FROM payout_batches
		WHERE affiliate_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`
	rows, err := p.pool.Query(ctx, query, affiliateID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []PayoutBatch
	for rows.Next() {
		var b PayoutBatch
		if err := rows.Scan(
			&b.ID, &b.AffiliateID, &b.AmountCents, &b.Currency, &b.PayoutMethod, &b.DestinationReference,
			&b.CryptoAsset, &b.CryptoNetwork, &b.Status, &b.ExternalPayoutID, &b.FailureReason, &b.JournalID, &b.CreatedAt, &b.ProcessedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, nil
}

func (p *PostgresRepository) ListPendingPayouts(ctx context.Context, limit int) ([]PayoutBatch, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `
		SELECT id, affiliate_id, amount_cents, currency, payout_method, destination_reference,
		       crypto_asset, crypto_network, status, external_payout_id, failure_reason, journal_id, created_at, processed_at
		FROM payout_batches
		WHERE status = 'PENDING_APPROVAL'
		ORDER BY created_at ASC
		LIMIT $1
	`
	rows, err := p.pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []PayoutBatch
	for rows.Next() {
		var b PayoutBatch
		if err := rows.Scan(
			&b.ID, &b.AffiliateID, &b.AmountCents, &b.Currency, &b.PayoutMethod, &b.DestinationReference,
			&b.CryptoAsset, &b.CryptoNetwork, &b.Status, &b.ExternalPayoutID, &b.FailureReason, &b.JournalID, &b.CreatedAt, &b.ProcessedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, b)
	}
	return list, nil
}

func (p *PostgresRepository) UpdatePayoutBatch(ctx context.Context, batch *PayoutBatch) error {
	query := `
		UPDATE payout_batches
		SET status = $2, external_payout_id = $3, failure_reason = $4, journal_id = $5, processed_at = $6
		WHERE id = $1
	`
	_, err := p.pool.Exec(ctx, query, batch.ID, batch.Status, batch.ExternalPayoutID, batch.FailureReason, batch.JournalID, batch.ProcessedAt)
	return err
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

func (p *PostgresRepository) GetUserReferralReward(ctx context.Context, userID string) (*UserReferralReward, error) {
	query := `
		SELECT id, user_id, partner_code, verified_count, reward_tier, reward_status, activated_at, expires_at, created_at, updated_at
		FROM user_referral_rewards
		WHERE user_id = $1
		LIMIT 1
	`
	var r UserReferralReward
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&r.ID, &r.UserID, &r.PartnerCode, &r.VerifiedCount, &r.RewardTier, &r.RewardStatus,
		&r.ActivatedAt, &r.ExpiresAt, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func (p *PostgresRepository) UpsertUserReferralReward(ctx context.Context, reward *UserReferralReward) error {
	query := `
		INSERT INTO user_referral_rewards (
			id, user_id, partner_code, verified_count, reward_tier, reward_status, activated_at, expires_at, created_at, updated_at
		)
		VALUES (COALESCE(NULLIF($1, '')::UUID, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			partner_code = EXCLUDED.partner_code,
			verified_count = EXCLUDED.verified_count,
			reward_tier = EXCLUDED.reward_tier,
			reward_status = EXCLUDED.reward_status,
			activated_at = EXCLUDED.activated_at,
			expires_at = EXCLUDED.expires_at,
			updated_at = NOW()
		RETURNING id, created_at, updated_at
	`
	return p.pool.QueryRow(
		ctx, query,
		reward.ID, reward.UserID, reward.PartnerCode, reward.VerifiedCount, reward.RewardTier, reward.RewardStatus,
		reward.ActivatedAt, reward.ExpiresAt,
	).Scan(&reward.ID, &reward.CreatedAt, &reward.UpdatedAt)
}
