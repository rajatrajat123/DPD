package identity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUserNotFound          = errors.New("user not found")
	ErrUserAlreadyExists     = errors.New("user with this email or phone already exists")
	ErrSessionNotFound       = errors.New("session not found")
	ErrProfileNotFound       = errors.New("profile not found")
	ErrPreferencesNotFound   = errors.New("preferences not found")
	ErrVerificationNotFound  = errors.New("verification record not found")
	ErrPasswordResetNotFound = errors.New("password reset token not found")
	ErrOAuthIdentityNotFound = errors.New("oauth identity not found")
)

type Repository interface {
	CreateUser(ctx context.Context, u *User) error
	GetUserByID(ctx context.Context, id string) (*User, error)
	GetUserByEmail(ctx context.Context, email string) (*User, error)
	GetUserByPhone(ctx context.Context, phone string) (*User, error)
	UpdateUser(ctx context.Context, u *User) error
	UpdateUserStatus(ctx context.Context, id string, status UserStatus) error
	UpdateUserRole(ctx context.Context, id string, role UserRole) error
	ListUsers(ctx context.Context, roleFilter, statusFilter, search string, limit, offset int) ([]*User, int, error)

	CreateSession(ctx context.Context, s *UserSession) error
	GetSessionByTokenHash(ctx context.Context, tokenHash []byte) (*UserSession, error)
	RevokeSession(ctx context.Context, sessionID string) error
	RevokeSessionFamily(ctx context.Context, familyID string) error
	RevokeAllUserSessions(ctx context.Context, userID string) error

	CreateVerification(ctx context.Context, v *AccountVerification) error
	GetLatestVerification(ctx context.Context, userID, channel string) (*AccountVerification, error)
	MarkVerificationVerified(ctx context.Context, id string) error
	IncrementVerificationAttempts(ctx context.Context, id string) error

	CreatePasswordReset(ctx context.Context, r *PasswordReset) error
	GetPasswordResetByHash(ctx context.Context, tokenHash string) (*PasswordReset, error)
	MarkPasswordResetUsed(ctx context.Context, id string) error

	UpsertProfile(ctx context.Context, p *Profile) error
	GetProfile(ctx context.Context, userID string) (*Profile, error)

	UpsertLocation(ctx context.Context, loc *ProfileLocation) error
	GetLocation(ctx context.Context, userID string) (*ProfileLocation, error)

	UpsertPreferences(ctx context.Context, pref *DatingPreferences) error
	GetPreferences(ctx context.Context, userID string) (*DatingPreferences, error)

	CreateOAuthIdentity(ctx context.Context, ident *OAuthIdentity) error
	GetOAuthIdentity(ctx context.Context, provider, providerSubject string) (*OAuthIdentity, error)
	GetOAuthIdentityByEmail(ctx context.Context, provider, email string) (*OAuthIdentity, error)
	UpdateOAuthIdentityLastLogin(ctx context.Context, id string) error
	ListOAuthIdentitiesForUser(ctx context.Context, userID string) ([]*OAuthIdentity, error)
}

// MemoryRepository provides a concurrent, in-memory implementation of Repository.
type MemoryRepository struct {
	mu              sync.RWMutex
	usersByID       map[string]*User
	usersByEmail    map[string]*User
	usersByPhone    map[string]*User
	sessions        map[string]*UserSession
	verifications   map[string]*AccountVerification
	verifSeq        map[string]int64
	seqCounter      int64
	resets          map[string]*PasswordReset
	profiles        map[string]*Profile
	locations       map[string]*ProfileLocation
	preferences     map[string]*DatingPreferences
	oauthIdentities map[string]*OAuthIdentity
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		usersByID:       make(map[string]*User),
		usersByEmail:    make(map[string]*User),
		usersByPhone:    make(map[string]*User),
		sessions:        make(map[string]*UserSession),
		verifications:   make(map[string]*AccountVerification),
		verifSeq:        make(map[string]int64),
		resets:          make(map[string]*PasswordReset),
		profiles:        make(map[string]*Profile),
		locations:       make(map[string]*ProfileLocation),
		preferences:     make(map[string]*DatingPreferences),
		oauthIdentities: make(map[string]*OAuthIdentity),
	}
}

func (m *MemoryRepository) CreateUser(_ context.Context, u *User) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	normEmail := strings.ToLower(strings.TrimSpace(u.Email))
	if _, exists := m.usersByEmail[normEmail]; exists {
		return ErrUserAlreadyExists
	}
	if u.PhoneE164 != nil && *u.PhoneE164 != "" {
		if _, exists := m.usersByPhone[*u.PhoneE164]; exists {
			return ErrUserAlreadyExists
		}
	}

	cloned := *u
	cloned.Email = normEmail
	if cloned.CreatedAt.IsZero() {
		cloned.CreatedAt = time.Now().UTC()
	}
	cloned.UpdatedAt = cloned.CreatedAt

	m.usersByID[cloned.ID] = &cloned
	m.usersByEmail[normEmail] = &cloned
	if cloned.PhoneE164 != nil && *cloned.PhoneE164 != "" {
		m.usersByPhone[*cloned.PhoneE164] = &cloned
	}
	return nil
}

func (m *MemoryRepository) GetUserByID(_ context.Context, id string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, ok := m.usersByID[id]
	if !ok {
		return nil, ErrUserNotFound
	}
	cloned := *u
	return &cloned, nil
}

func (m *MemoryRepository) ListAllUsers() []*User {
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make([]*User, 0, len(m.usersByID))
	for _, u := range m.usersByID {
		cloned := *u
		res = append(res, &cloned)
	}
	return res
}

func (m *MemoryRepository) GetUserByEmail(_ context.Context, email string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	norm := strings.ToLower(strings.TrimSpace(email))
	u, ok := m.usersByEmail[norm]
	if !ok {
		return nil, ErrUserNotFound
	}
	cloned := *u
	return &cloned, nil
}

func (m *MemoryRepository) GetUserByPhone(_ context.Context, phone string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, ok := m.usersByPhone[strings.TrimSpace(phone)]
	if !ok {
		return nil, ErrUserNotFound
	}
	cloned := *u
	return &cloned, nil
}

func (m *MemoryRepository) UpdateUser(_ context.Context, u *User) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.usersByID[u.ID]
	if !ok {
		return ErrUserNotFound
	}

	cloned := *u
	cloned.UpdatedAt = time.Now().UTC()
	m.usersByID[u.ID] = &cloned
	m.usersByEmail[strings.ToLower(cloned.Email)] = &cloned
	if existing.PhoneE164 != nil && *existing.PhoneE164 != "" {
		delete(m.usersByPhone, *existing.PhoneE164)
	}
	if cloned.PhoneE164 != nil && *cloned.PhoneE164 != "" {
		m.usersByPhone[*cloned.PhoneE164] = &cloned
	}
	return nil
}

func (m *MemoryRepository) UpdateUserStatus(_ context.Context, id string, status UserStatus) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.usersByID[id]
	if !ok {
		return ErrUserNotFound
	}
	existing.Status = status
	existing.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) UpdateUserRole(_ context.Context, id string, role UserRole) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.usersByID[id]
	if !ok {
		return ErrUserNotFound
	}
	existing.Role = role
	existing.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) ListUsers(_ context.Context, roleFilter, statusFilter, search string, limit, offset int) ([]*User, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var matched []*User
	searchLower := strings.ToLower(strings.TrimSpace(search))

	for _, u := range m.usersByID {
		if roleFilter != "" && string(u.Role) != roleFilter {
			continue
		}
		if statusFilter != "" && string(u.Status) != statusFilter {
			continue
		}
		if searchLower != "" {
			if !strings.Contains(strings.ToLower(u.Email), searchLower) && !strings.Contains(strings.ToLower(u.ID), searchLower) {
				continue
			}
		}
		cpy := *u
		matched = append(matched, &cpy)
	}

	total := len(matched)
	if offset >= total {
		return []*User{}, total, nil
	}
	end := offset + limit
	if limit <= 0 || end > total {
		end = total
	}
	return matched[offset:end], total, nil
}

func (m *MemoryRepository) CreateSession(_ context.Context, s *UserSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *s
	if cloned.CreatedAt.IsZero() {
		cloned.CreatedAt = time.Now().UTC()
	}
	m.sessions[string(cloned.RefreshTokenHash)] = &cloned
	return nil
}

func (m *MemoryRepository) GetSessionByTokenHash(_ context.Context, tokenHash []byte) (*UserSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, ok := m.sessions[string(tokenHash)]
	if !ok {
		return nil, ErrSessionNotFound
	}
	cloned := *s
	return &cloned, nil
}

func (m *MemoryRepository) RevokeSession(_ context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for _, s := range m.sessions {
		if s.ID == sessionID {
			s.RevokedAt = &now
			return nil
		}
	}
	return ErrSessionNotFound
}

func (m *MemoryRepository) RevokeSessionFamily(_ context.Context, familyID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for _, s := range m.sessions {
		if s.FamilyID == familyID || s.UserID == familyID {
			s.RevokedAt = &now
		}
	}
	return nil
}

func (m *MemoryRepository) RevokeAllUserSessions(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for _, s := range m.sessions {
		if s.UserID == userID {
			s.RevokedAt = &now
		}
	}
	return nil
}

func (m *MemoryRepository) CreateVerification(_ context.Context, v *AccountVerification) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *v
	if cloned.CreatedAt.IsZero() {
		cloned.CreatedAt = time.Now().UTC()
	}
	m.seqCounter++
	m.verifSeq[cloned.ID] = m.seqCounter
	m.verifications[cloned.ID] = &cloned
	return nil
}

func (m *MemoryRepository) GetLatestVerification(_ context.Context, userID, channel string) (*AccountVerification, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var latest *AccountVerification
	var latestSeq int64
	for _, v := range m.verifications {
		if v.UserID == userID && v.Channel == channel {
			seq := m.verifSeq[v.ID]
			if latest == nil || v.CreatedAt.After(latest.CreatedAt) || (v.CreatedAt.Equal(latest.CreatedAt) && seq > latestSeq) {
				latest = v
				latestSeq = seq
			}
		}
	}
	if latest == nil {
		return nil, ErrVerificationNotFound
	}
	cloned := *latest
	return &cloned, nil
}

func (m *MemoryRepository) MarkVerificationVerified(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, ok := m.verifications[id]
	if !ok {
		return ErrVerificationNotFound
	}
	now := time.Now().UTC()
	v.VerifiedAt = &now
	return nil
}

func (m *MemoryRepository) IncrementVerificationAttempts(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, ok := m.verifications[id]
	if !ok {
		return ErrVerificationNotFound
	}
	v.Attempts++
	return nil
}

func (m *MemoryRepository) CreatePasswordReset(_ context.Context, r *PasswordReset) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *r
	if cloned.CreatedAt.IsZero() {
		cloned.CreatedAt = time.Now().UTC()
	}
	m.resets[cloned.TokenHash] = &cloned
	return nil
}

func (m *MemoryRepository) GetPasswordResetByHash(_ context.Context, tokenHash string) (*PasswordReset, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	r, ok := m.resets[tokenHash]
	if !ok {
		return nil, ErrPasswordResetNotFound
	}
	cloned := *r
	return &cloned, nil
}

func (m *MemoryRepository) MarkPasswordResetUsed(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for _, r := range m.resets {
		if r.ID == id {
			r.UsedAt = &now
			return nil
		}
	}
	return ErrPasswordResetNotFound
}

func (m *MemoryRepository) UpsertProfile(_ context.Context, p *Profile) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *p
	if cloned.CreatedAt.IsZero() {
		cloned.CreatedAt = time.Now().UTC()
	}
	cloned.UpdatedAt = time.Now().UTC()
	m.profiles[cloned.UserID] = &cloned
	return nil
}

func (m *MemoryRepository) GetProfile(_ context.Context, userID string) (*Profile, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	p, ok := m.profiles[userID]
	if !ok {
		return nil, ErrProfileNotFound
	}
	cloned := *p
	return &cloned, nil
}

func (m *MemoryRepository) UpsertLocation(_ context.Context, loc *ProfileLocation) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *loc
	cloned.UpdatedAt = time.Now().UTC()
	m.locations[cloned.UserID] = &cloned
	return nil
}

func (m *MemoryRepository) GetLocation(_ context.Context, userID string) (*ProfileLocation, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	loc, ok := m.locations[userID]
	if !ok {
		return nil, errors.New("location not found")
	}
	cloned := *loc
	return &cloned, nil
}

func (m *MemoryRepository) UpsertPreferences(_ context.Context, pref *DatingPreferences) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	cloned := *pref
	cloned.UpdatedAt = time.Now().UTC()
	m.preferences[cloned.UserID] = &cloned
	return nil
}

func (m *MemoryRepository) GetPreferences(_ context.Context, userID string) (*DatingPreferences, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	pref, ok := m.preferences[userID]
	if !ok {
		return nil, ErrPreferencesNotFound
	}
	cloned := *pref
	return &cloned, nil
}

func (m *MemoryRepository) CreateOAuthIdentity(_ context.Context, ident *OAuthIdentity) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := strings.ToLower(ident.Provider) + ":" + ident.ProviderSubject
	if _, exists := m.oauthIdentities[key]; exists {
		return errors.New("oauth identity already exists")
	}
	cp := *ident
	m.oauthIdentities[key] = &cp
	return nil
}

func (m *MemoryRepository) GetOAuthIdentity(_ context.Context, provider, providerSubject string) (*OAuthIdentity, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key := strings.ToLower(provider) + ":" + providerSubject
	ident, exists := m.oauthIdentities[key]
	if !exists {
		return nil, ErrOAuthIdentityNotFound
	}
	cp := *ident
	return &cp, nil
}

func (m *MemoryRepository) GetOAuthIdentityByEmail(_ context.Context, provider, email string) (*OAuthIdentity, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	normEmail := strings.ToLower(strings.TrimSpace(email))
	normProvider := strings.ToLower(provider)
	for _, ident := range m.oauthIdentities {
		if strings.ToLower(ident.Provider) == normProvider && strings.ToLower(ident.Email) == normEmail {
			cp := *ident
			return &cp, nil
		}
	}
	return nil, ErrOAuthIdentityNotFound
}

func (m *MemoryRepository) UpdateOAuthIdentityLastLogin(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, ident := range m.oauthIdentities {
		if ident.ID == id {
			ident.LastLoginAt = time.Now().UTC()
			return nil
		}
	}
	return ErrOAuthIdentityNotFound
}

func (m *MemoryRepository) ListOAuthIdentitiesForUser(_ context.Context, userID string) ([]*OAuthIdentity, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*OAuthIdentity
	for _, ident := range m.oauthIdentities {
		if ident.UserID == userID {
			cp := *ident
			result = append(result, &cp)
		}
	}
	return result, nil
}

// PostgresRepository implements Repository using live PostgreSQL connection pool.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) CreateUser(ctx context.Context, u *User) error {
	query := `
		INSERT INTO users (id, email, phone_e164, password_hash, status, role, email_verified_at, phone_verified_at, last_active_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`
	_, err := p.pool.Exec(ctx, query,
		u.ID, u.Email, u.PhoneE164, u.PasswordHash, u.Status, u.Role,
		u.EmailVerifiedAt, u.PhoneVerifiedAt, u.LastActiveAt, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil && strings.Contains(err.Error(), "duplicate key") {
		return ErrUserAlreadyExists
	}
	return err
}

func (p *PostgresRepository) GetUserByID(ctx context.Context, id string) (*User, error) {
	query := `
		SELECT id, email, phone_e164, password_hash, status, role, email_verified_at, phone_verified_at, last_active_at, created_at, updated_at
		FROM users WHERE id = $1
	`
	var u User
	err := p.pool.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.Email, &u.PhoneE164, &u.PasswordHash, &u.Status, &u.Role,
		&u.EmailVerifiedAt, &u.PhoneVerifiedAt, &u.LastActiveAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return &u, err
}

func (p *PostgresRepository) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	query := `
		SELECT id, email, phone_e164, password_hash, status, role, email_verified_at, phone_verified_at, last_active_at, created_at, updated_at
		FROM users WHERE email = $1
	`
	var u User
	err := p.pool.QueryRow(ctx, query, strings.ToLower(email)).Scan(
		&u.ID, &u.Email, &u.PhoneE164, &u.PasswordHash, &u.Status, &u.Role,
		&u.EmailVerifiedAt, &u.PhoneVerifiedAt, &u.LastActiveAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return &u, err
}

func (p *PostgresRepository) GetUserByPhone(ctx context.Context, phone string) (*User, error) {
	query := `
		SELECT id, email, phone_e164, password_hash, status, role, email_verified_at, phone_verified_at, last_active_at, created_at, updated_at
		FROM users WHERE phone_e164 = $1
	`
	var u User
	err := p.pool.QueryRow(ctx, query, phone).Scan(
		&u.ID, &u.Email, &u.PhoneE164, &u.PasswordHash, &u.Status, &u.Role,
		&u.EmailVerifiedAt, &u.PhoneVerifiedAt, &u.LastActiveAt, &u.CreatedAt, &u.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return &u, err
}

func (p *PostgresRepository) UpdateUser(ctx context.Context, u *User) error {
	query := `
		UPDATE users SET
			email = $2, phone_e164 = $3, password_hash = $4, status = $5, role = $6,
			email_verified_at = $7, phone_verified_at = $8, last_active_at = $9, updated_at = NOW()
		WHERE id = $1
	`
	cmd, err := p.pool.Exec(ctx, query,
		u.ID, u.Email, u.PhoneE164, u.PasswordHash, u.Status, u.Role,
		u.EmailVerifiedAt, u.PhoneVerifiedAt, u.LastActiveAt,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (p *PostgresRepository) UpdateUserStatus(ctx context.Context, id string, status UserStatus) error {
	query := `UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1`
	cmd, err := p.pool.Exec(ctx, query, id, status)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (p *PostgresRepository) UpdateUserRole(ctx context.Context, id string, role UserRole) error {
	query := `UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1`
	cmd, err := p.pool.Exec(ctx, query, id, role)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (p *PostgresRepository) ListUsers(ctx context.Context, roleFilter, statusFilter, search string, limit, offset int) ([]*User, int, error) {
	whereClauses := []string{"1=1"}
	args := []any{}
	argIdx := 1

	if roleFilter != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("role = $%d", argIdx))
		args = append(args, roleFilter)
		argIdx++
	}
	if statusFilter != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}
	if search != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("(email ILIKE $%d OR id ILIKE $%d)", argIdx, argIdx))
		args = append(args, "%"+search+"%")
		argIdx++
	}

	whereSQL := strings.Join(whereClauses, " AND ")

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM users WHERE %s", whereSQL)
	var total int
	if err := p.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if limit <= 0 {
		limit = 50
	}
	query := fmt.Sprintf("SELECT id, email, phone_e164, password_hash, status, role, email_verified_at, phone_verified_at, last_active_at, created_at, updated_at FROM users WHERE %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d", whereSQL, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := p.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		var u User
		if err := rows.Scan(
			&u.ID, &u.Email, &u.PhoneE164, &u.PasswordHash, &u.Status, &u.Role,
			&u.EmailVerifiedAt, &u.PhoneVerifiedAt, &u.LastActiveAt, &u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, 0, err
		}
		users = append(users, &u)
	}
	return users, total, rows.Err()
}

func (p *PostgresRepository) CreateSession(ctx context.Context, s *UserSession) error {
	query := `
		INSERT INTO user_sessions (id, user_id, family_id, refresh_token_hash, device_fingerprint, user_agent, ip_address, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	var ipVal any
	if s.IPAddress != "" {
		host := s.IPAddress
		if h, _, err := net.SplitHostPort(s.IPAddress); err == nil {
			host = h
		}
		if ip := net.ParseIP(host); ip != nil {
			ipVal = ip.String()
		}
	}

	_, err := p.pool.Exec(ctx, query,
		s.ID, s.UserID, s.FamilyID, s.RefreshTokenHash, s.DeviceFingerprint, s.UserAgent, ipVal, s.ExpiresAt, s.CreatedAt,
	)
	return err
}

func (p *PostgresRepository) GetSessionByTokenHash(ctx context.Context, tokenHash []byte) (*UserSession, error) {
	query := `
		SELECT id, user_id, family_id, refresh_token_hash, device_fingerprint, user_agent, ip_address::text, expires_at, revoked_at, created_at
		FROM user_sessions WHERE refresh_token_hash = $1
	`
	var s UserSession
	var ip *string
	err := p.pool.QueryRow(ctx, query, tokenHash).Scan(
		&s.ID, &s.UserID, &s.FamilyID, &s.RefreshTokenHash, &s.DeviceFingerprint, &s.UserAgent, &ip, &s.ExpiresAt, &s.RevokedAt, &s.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if ip != nil {
		s.IPAddress = *ip
	}
	return &s, err
}

func (p *PostgresRepository) RevokeSession(ctx context.Context, sessionID string) error {
	query := `UPDATE user_sessions SET revoked_at = NOW() WHERE id = $1`
	cmd, err := p.pool.Exec(ctx, query, sessionID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (p *PostgresRepository) RevokeSessionFamily(ctx context.Context, familyID string) error {
	query := `UPDATE user_sessions SET revoked_at = NOW() WHERE (family_id = $1 OR user_id = $1) AND revoked_at IS NULL`
	_, err := p.pool.Exec(ctx, query, familyID)
	return err
}

func (p *PostgresRepository) RevokeAllUserSessions(ctx context.Context, userID string) error {
	query := `UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`
	_, err := p.pool.Exec(ctx, query, userID)
	return err
}

func (p *PostgresRepository) CreateVerification(ctx context.Context, v *AccountVerification) error {
	query := `
		INSERT INTO account_verifications (id, user_id, channel, target, code_hash, attempts, max_attempts, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	_, err := p.pool.Exec(ctx, query,
		v.ID, v.UserID, v.Channel, v.Target, v.CodeHash, v.Attempts, v.MaxAttempts, v.ExpiresAt, v.CreatedAt,
	)
	return err
}

func (p *PostgresRepository) GetLatestVerification(ctx context.Context, userID, channel string) (*AccountVerification, error) {
	query := `
		SELECT id, user_id, channel, target, code_hash, attempts, max_attempts, expires_at, verified_at, created_at
		FROM account_verifications
		WHERE user_id = $1 AND channel = $2
		ORDER BY created_at DESC
		LIMIT 1
	`
	var v AccountVerification
	err := p.pool.QueryRow(ctx, query, userID, channel).Scan(
		&v.ID, &v.UserID, &v.Channel, &v.Target, &v.CodeHash, &v.Attempts, &v.MaxAttempts, &v.ExpiresAt, &v.VerifiedAt, &v.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVerificationNotFound
	}
	return &v, err
}

func (p *PostgresRepository) MarkVerificationVerified(ctx context.Context, id string) error {
	query := `UPDATE account_verifications SET verified_at = NOW() WHERE id = $1`
	cmd, err := p.pool.Exec(ctx, query, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrVerificationNotFound
	}
	return nil
}

func (p *PostgresRepository) IncrementVerificationAttempts(ctx context.Context, id string) error {
	query := `UPDATE account_verifications SET attempts = attempts + 1 WHERE id = $1`
	_, err := p.pool.Exec(ctx, query, id)
	return err
}

func (p *PostgresRepository) CreatePasswordReset(ctx context.Context, r *PasswordReset) error {
	query := `
		INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`
	_, err := p.pool.Exec(ctx, query, r.ID, r.UserID, r.TokenHash, r.ExpiresAt, r.CreatedAt)
	return err
}

func (p *PostgresRepository) GetPasswordResetByHash(ctx context.Context, tokenHash string) (*PasswordReset, error) {
	query := `
		SELECT id, user_id, token_hash, expires_at, used_at, created_at
		FROM password_resets WHERE token_hash = $1
	`
	var r PasswordReset
	err := p.pool.QueryRow(ctx, query, tokenHash).Scan(
		&r.ID, &r.UserID, &r.TokenHash, &r.ExpiresAt, &r.UsedAt, &r.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPasswordResetNotFound
	}
	return &r, err
}

func (p *PostgresRepository) MarkPasswordResetUsed(ctx context.Context, id string) error {
	query := `UPDATE password_resets SET used_at = NOW() WHERE id = $1`
	cmd, err := p.pool.Exec(ctx, query, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrPasswordResetNotFound
	}
	return nil
}

func (p *PostgresRepository) UpsertProfile(ctx context.Context, pr *Profile) error {
	visJSON, err := json.Marshal(pr.VisibilitySettings)
	if err != nil {
		return fmt.Errorf("failed to marshal visibility settings: %w", err)
	}

	if pr.SmokingHabit == "" {
		pr.SmokingHabit = SmokingNonSmoker
	}
	if pr.DrinkingHabit == "" {
		pr.DrinkingHabit = DrinkingSocially
	}
	if pr.Pronouns == nil {
		pr.Pronouns = []string{}
	}
	if pr.GenderIdentities == nil {
		pr.GenderIdentities = []string{}
	}
	if pr.SexualOrientations == nil {
		pr.SexualOrientations = []string{}
	}
	if pr.RelationshipIntents == nil {
		pr.RelationshipIntents = []string{}
	}
	if pr.Languages == nil {
		pr.Languages = []string{}
	}
	if pr.Interests == nil {
		pr.Interests = []string{}
	}

	query := `
		INSERT INTO profiles (
			user_id, display_name, birthdate, bio, pronouns, gender_identities,
			sexual_orientations, relationship_intents, relationship_structure,
			smoking_habit, drinking_habit,
			visibility_settings, is_photo_verified, discrete_mode_enabled,
			incognito_enabled, height_cm, weight_kg, languages, interests, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
		ON CONFLICT (user_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			bio = EXCLUDED.bio,
			pronouns = EXCLUDED.pronouns,
			gender_identities = EXCLUDED.gender_identities,
			sexual_orientations = EXCLUDED.sexual_orientations,
			relationship_intents = EXCLUDED.relationship_intents,
			relationship_structure = EXCLUDED.relationship_structure,
			smoking_habit = EXCLUDED.smoking_habit,
			drinking_habit = EXCLUDED.drinking_habit,
			visibility_settings = EXCLUDED.visibility_settings,
			discrete_mode_enabled = EXCLUDED.discrete_mode_enabled,
			incognito_enabled = EXCLUDED.incognito_enabled,
			height_cm = EXCLUDED.height_cm,
			weight_kg = EXCLUDED.weight_kg,
			languages = EXCLUDED.languages,
			interests = EXCLUDED.interests,
			updated_at = NOW()
	`

	var relStruct any
	if pr.RelationshipStructure != "" {
		relStruct = string(pr.RelationshipStructure)
	}

	_, err = p.pool.Exec(ctx, query,
		pr.UserID, pr.DisplayName, pr.Birthdate, pr.Bio, pr.Pronouns, pr.GenderIdentities,
		pr.SexualOrientations, pr.RelationshipIntents, relStruct,
		pr.SmokingHabit, pr.DrinkingHabit,
		visJSON, pr.IsPhotoVerified, pr.DiscreteModeEnabled,
		pr.IncognitoEnabled, pr.HeightCm, pr.WeightKg, pr.Languages, pr.Interests, pr.CreatedAt, pr.UpdatedAt,
	)
	return err
}

func (p *PostgresRepository) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	query := `
		SELECT user_id, display_name, birthdate, bio, pronouns, gender_identities,
		       sexual_orientations, relationship_intents, relationship_structure,
		       smoking_habit, drinking_habit,
		       visibility_settings, is_photo_verified, discrete_mode_enabled,
		       incognito_enabled, height_cm, weight_kg, languages, interests, created_at, updated_at
		FROM profiles WHERE user_id = $1
	`
	var pr Profile
	var visBytes []byte
	var relStructure *string

	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&pr.UserID, &pr.DisplayName, &pr.Birthdate, &pr.Bio, &pr.Pronouns, &pr.GenderIdentities,
		&pr.SexualOrientations, &pr.RelationshipIntents, &relStructure,
		&pr.SmokingHabit, &pr.DrinkingHabit,
		&visBytes, &pr.IsPhotoVerified, &pr.DiscreteModeEnabled,
		&pr.IncognitoEnabled, &pr.HeightCm, &pr.WeightKg, &pr.Languages, &pr.Interests, &pr.CreatedAt, &pr.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrProfileNotFound
	}
	if err != nil {
		return nil, err
	}
	if relStructure != nil {
		pr.RelationshipStructure = RelationshipStructure(*relStructure)
	}
	if pr.SmokingHabit == "" {
		pr.SmokingHabit = SmokingNonSmoker
	}
	if pr.DrinkingHabit == "" {
		pr.DrinkingHabit = DrinkingSocially
	}
	if len(visBytes) > 0 {
		_ = json.Unmarshal(visBytes, &pr.VisibilitySettings)
	}
	return &pr, nil
}

func (p *PostgresRepository) UpsertLocation(ctx context.Context, loc *ProfileLocation) error {
	query := `
		INSERT INTO profile_locations (user_id, coordinates, city_name, country_code, updated_at)
		VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			coordinates = EXCLUDED.coordinates,
			city_name = EXCLUDED.city_name,
			country_code = EXCLUDED.country_code,
			updated_at = NOW()
	`
	_, err := p.pool.Exec(ctx, query, loc.UserID, loc.Longitude, loc.Latitude, loc.CityName, loc.CountryCode)
	return err
}

func (p *PostgresRepository) GetLocation(ctx context.Context, userID string) (*ProfileLocation, error) {
	query := `
		SELECT user_id, ST_Y(coordinates::geometry) AS lat, ST_X(coordinates::geometry) AS lon, city_name, country_code, updated_at
		FROM profile_locations WHERE user_id = $1
	`
	var loc ProfileLocation
	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&loc.UserID, &loc.Latitude, &loc.Longitude, &loc.CityName, &loc.CountryCode, &loc.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("location not found")
	}
	return &loc, err
}

func (p *PostgresRepository) UpsertPreferences(ctx context.Context, pref *DatingPreferences) error {
	dealbreakersJSON, err := json.Marshal(pref.Dealbreakers)
	if err != nil {
		dealbreakersJSON = []byte("{}")
	}
	notifJSON, err := json.Marshal(pref.NotificationPreferences)
	if err != nil {
		notifJSON = []byte("{}")
	}

	if pref.PreferredGenders == nil {
		pref.PreferredGenders = []string{}
	}
	if pref.PreferredIntents == nil {
		pref.PreferredIntents = []string{}
	}
	if pref.PreferredOrientations == nil {
		pref.PreferredOrientations = []string{}
	}
	if pref.PreferredLanguages == nil {
		pref.PreferredLanguages = []string{}
	}
	if pref.PreferredInterests == nil {
		pref.PreferredInterests = []string{}
	}

	query := `
		INSERT INTO dating_preferences (
			user_id, min_age, max_age, max_distance_km, preferred_genders, preferred_intents, verified_profiles_only,
			dealbreakers, notification_preferences, min_height_cm, max_height_cm, min_weight_kg, max_weight_kg,
			preferred_orientations, preferred_languages, preferred_interests, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			min_age = EXCLUDED.min_age,
			max_age = EXCLUDED.max_age,
			max_distance_km = EXCLUDED.max_distance_km,
			preferred_genders = EXCLUDED.preferred_genders,
			preferred_intents = EXCLUDED.preferred_intents,
			verified_profiles_only = EXCLUDED.verified_profiles_only,
			dealbreakers = EXCLUDED.dealbreakers,
			notification_preferences = EXCLUDED.notification_preferences,
			min_height_cm = EXCLUDED.min_height_cm,
			max_height_cm = EXCLUDED.max_height_cm,
			min_weight_kg = EXCLUDED.min_weight_kg,
			max_weight_kg = EXCLUDED.max_weight_kg,
			preferred_orientations = EXCLUDED.preferred_orientations,
			preferred_languages = EXCLUDED.preferred_languages,
			preferred_interests = EXCLUDED.preferred_interests,
			updated_at = NOW()
	`
	_, err = p.pool.Exec(ctx, query,
		pref.UserID, pref.MinAge, pref.MaxAge, pref.MaxDistanceKm,
		pref.PreferredGenders, pref.PreferredIntents, pref.VerifiedProfilesOnly,
		dealbreakersJSON, notifJSON,
		pref.MinHeightCm, pref.MaxHeightCm, pref.MinWeightKg, pref.MaxWeightKg,
		pref.PreferredOrientations, pref.PreferredLanguages, pref.PreferredInterests,
	)
	return err
}

func (p *PostgresRepository) GetPreferences(ctx context.Context, userID string) (*DatingPreferences, error) {
	query := `
		SELECT user_id, min_age, max_age, max_distance_km, preferred_genders, preferred_intents, verified_profiles_only,
		       dealbreakers, notification_preferences, min_height_cm, max_height_cm, min_weight_kg, max_weight_kg,
		       preferred_orientations, preferred_languages, preferred_interests, updated_at
		FROM dating_preferences WHERE user_id = $1
	`
	var pref DatingPreferences
	var dealbreakersBytes []byte
	var notifBytes []byte

	err := p.pool.QueryRow(ctx, query, userID).Scan(
		&pref.UserID, &pref.MinAge, &pref.MaxAge, &pref.MaxDistanceKm,
		&pref.PreferredGenders, &pref.PreferredIntents, &pref.VerifiedProfilesOnly,
		&dealbreakersBytes, &notifBytes,
		&pref.MinHeightCm, &pref.MaxHeightCm, &pref.MinWeightKg, &pref.MaxWeightKg,
		&pref.PreferredOrientations, &pref.PreferredLanguages, &pref.PreferredInterests,
		&pref.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPreferencesNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(dealbreakersBytes) > 0 {
		_ = json.Unmarshal(dealbreakersBytes, &pref.Dealbreakers)
	}
	if len(notifBytes) > 0 {
		_ = json.Unmarshal(notifBytes, &pref.NotificationPreferences)
	} else {
		pref.NotificationPreferences = DefaultNotificationPreferences()
	}
	return &pref, nil
}

func (p *PostgresRepository) CreateOAuthIdentity(ctx context.Context, ident *OAuthIdentity) error {
	query := `
		INSERT INTO user_oauth_identities (id, user_id, provider, provider_subject, email, email_verified, linked_at, last_login_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := p.pool.Exec(ctx, query,
		ident.ID,
		ident.UserID,
		ident.Provider,
		ident.ProviderSubject,
		ident.Email,
		ident.EmailVerified,
		ident.LinkedAt,
		ident.LastLoginAt,
	)
	return err
}

func (p *PostgresRepository) GetOAuthIdentity(ctx context.Context, provider, providerSubject string) (*OAuthIdentity, error) {
	query := `
		SELECT id, user_id, provider, provider_subject, email, email_verified, linked_at, last_login_at
		FROM user_oauth_identities
		WHERE provider = $1 AND provider_subject = $2
	`
	var ident OAuthIdentity
	err := p.pool.QueryRow(ctx, query, provider, providerSubject).Scan(
		&ident.ID,
		&ident.UserID,
		&ident.Provider,
		&ident.ProviderSubject,
		&ident.Email,
		&ident.EmailVerified,
		&ident.LinkedAt,
		&ident.LastLoginAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOAuthIdentityNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ident, nil
}

func (p *PostgresRepository) GetOAuthIdentityByEmail(ctx context.Context, provider, email string) (*OAuthIdentity, error) {
	query := `
		SELECT id, user_id, provider, provider_subject, email, email_verified, linked_at, last_login_at
		FROM user_oauth_identities
		WHERE provider = $1 AND email = $2
		LIMIT 1
	`
	var ident OAuthIdentity
	err := p.pool.QueryRow(ctx, query, provider, email).Scan(
		&ident.ID,
		&ident.UserID,
		&ident.Provider,
		&ident.ProviderSubject,
		&ident.Email,
		&ident.EmailVerified,
		&ident.LinkedAt,
		&ident.LastLoginAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOAuthIdentityNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ident, nil
}

func (p *PostgresRepository) UpdateOAuthIdentityLastLogin(ctx context.Context, id string) error {
	query := `UPDATE user_oauth_identities SET last_login_at = $1 WHERE id = $2`
	tag, err := p.pool.Exec(ctx, query, time.Now().UTC(), id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrOAuthIdentityNotFound
	}
	return nil
}

func (p *PostgresRepository) ListOAuthIdentitiesForUser(ctx context.Context, userID string) ([]*OAuthIdentity, error) {
	query := `
		SELECT id, user_id, provider, provider_subject, email, email_verified, linked_at, last_login_at
		FROM user_oauth_identities
		WHERE user_id = $1
		ORDER BY linked_at ASC
	`
	rows, err := p.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var idents []*OAuthIdentity
	for rows.Next() {
		var ident OAuthIdentity
		if err := rows.Scan(
			&ident.ID,
			&ident.UserID,
			&ident.Provider,
			&ident.ProviderSubject,
			&ident.Email,
			&ident.EmailVerified,
			&ident.LinkedAt,
			&ident.LastLoginAt,
		); err != nil {
			return nil, err
		}
		idents = append(idents, &ident)
	}
	return idents, rows.Err()
}
