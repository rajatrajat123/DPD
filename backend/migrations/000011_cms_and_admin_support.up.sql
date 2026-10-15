-- 000011_cms_and_admin_support.up.sql
-- Migration 000011: Content Management System (CMS), media assets, audit trail & admin support indices

CREATE TABLE IF NOT EXISTS cms_content_items (
    id VARCHAR(128) PRIMARY KEY,
    content_type VARCHAR(64) NOT NULL,
    slug VARCHAR(256) NOT NULL,
    title VARCHAR(256) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
    published_version_id VARCHAR(128),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_content_items_slug ON cms_content_items (slug);
CREATE INDEX IF NOT EXISTS idx_cms_content_items_status ON cms_content_items (status);

CREATE TABLE IF NOT EXISTS cms_content_versions (
    id VARCHAR(128) PRIMARY KEY,
    content_item_id VARCHAR(128) NOT NULL REFERENCES cms_content_items(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    headline TEXT NOT NULL,
    subheading TEXT NOT NULL DEFAULT '',
    body_markdown TEXT NOT NULL DEFAULT '',
    cta_label VARCHAR(128) NOT NULL DEFAULT '',
    cta_url VARCHAR(512) NOT NULL DEFAULT '',
    image_url VARCHAR(1024) NOT NULL DEFAULT '',
    image_alt VARCHAR(512) NOT NULL DEFAULT '',
    seo_meta_title VARCHAR(256) NOT NULL DEFAULT '',
    seo_meta_description TEXT NOT NULL DEFAULT '',
    seo_canonical_url VARCHAR(512) NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}',
    author_id VARCHAR(128) NOT NULL,
    author_email VARCHAR(256) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cms_content_version UNIQUE (content_item_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_cms_versions_item ON cms_content_versions (content_item_id, version_number DESC);

CREATE TABLE IF NOT EXISTS cms_media_assets (
    id VARCHAR(128) PRIMARY KEY,
    filename VARCHAR(512) NOT NULL,
    content_type VARCHAR(128) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    storage_path VARCHAR(1024) NOT NULL,
    public_url VARCHAR(1024) NOT NULL,
    alt_text VARCHAR(512) NOT NULL DEFAULT '',
    uploader_id VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_media_created ON cms_media_assets (created_at DESC);

CREATE TABLE IF NOT EXISTS cms_audit_trail (
    id VARCHAR(128) PRIMARY KEY,
    content_item_id VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    actor_email VARCHAR(256) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cms_audit_item ON cms_audit_trail (content_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cms_audit_actor ON cms_audit_trail (actor_id, created_at DESC);

-- Seed Initial Editorial CMS Records
INSERT INTO cms_content_items (id, content_type, slug, title, status, published_version_id, published_at, created_at, updated_at)
VALUES 
('homepage.hero', 'PAGE_SECTION', '/', 'Homepage Hero Banner & Value Proposition', 'PUBLISHED', 'ver_seed_hero_v1', NOW(), NOW(), NOW()),
('nav.primary', 'PAGE_SECTION', '/navigation/primary', 'Global Primary Navigation & Links', 'PUBLISHED', 'ver_seed_nav_v1', NOW(), NOW(), NOW()),
('intent.gay-dating', 'CATEGORY_LANDING', '/gay-dating', 'Gay Dating Intent & Matchmaking Sanctuary', 'PUBLISHED', 'ver_seed_gay_v1', NOW(), NOW(), NOW()),
('intent.lesbian-dating', 'CATEGORY_LANDING', '/lesbian-dating', 'Lesbian Dating Community & Verified Connections', 'PUBLISHED', 'ver_seed_lesbian_v1', NOW(), NOW(), NOW()),
('intent.bisexual-dating', 'CATEGORY_LANDING', '/bisexual-dating', 'Bisexual & Pansexual Inclusive Matchmaking', 'PUBLISHED', 'ver_seed_bi_v1', NOW(), NOW(), NOW()),
('intent.queer-dating', 'CATEGORY_LANDING', '/queer-dating', 'Queer & Trans Intentional Dating Sanctuary', 'PUBLISHED', 'ver_seed_queer_v1', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO cms_content_versions (id, content_item_id, version_number, headline, subheading, body_markdown, cta_label, cta_url, image_url, image_alt, seo_meta_title, seo_meta_description, seo_canonical_url, metadata, author_id, author_email, created_at)
VALUES
('ver_seed_hero_v1', 'homepage.hero', 1, 'Where Intentional LGBTQ+ Connections Begin', 'A refined, verified sanctuary crafted for genuine chemistry, safety, and authentic queer intimacy.', 'Every profile on Aura undergoes mandatory photo verification and zero-compromise safety protections.', 'Apply for Membership', '/auth/register', 'https://images.unsplash.com/photo-1517841905240-472988babdf9', 'Two happy couples laughing together at a luxury private evening dinner event', 'Aura | Premium LGBTQ+ Dating & Intentional Matchmaking Sanctuary', 'Aura is the world''s premier verified dating community designed specifically for intentional LGBTQ+ relationships.', 'https://www.auradating.com/', '{"order": 1}', 'system_seed', 'editorial@auradating.com', NOW()),
('ver_seed_nav_v1', 'nav.primary', 1, 'Primary Navigation Ordering', 'Header navigation links for consumer discovery and landing funnels', 'Manages link ordering, visibility, and category taxonomy.', 'Explore Stories', '/about', '', 'Navigation Icon', 'Aura Navigation', 'Aura global website navigation', 'https://www.auradating.com/', '{"links":[{"label":"Gay Dating","href":"/gay-dating"},{"label":"Lesbian Dating","href":"/lesbian-dating"},{"label":"Bisexual Dating","href":"/bisexual-dating"},{"label":"Queer Dating","href":"/queer-dating"},{"label":"Safety & Verification","href":"/safety"}]}', 'system_seed', 'editorial@auradating.com', NOW()),
('ver_seed_gay_v1', 'intent.gay-dating', 1, 'Intentional Gay Dating, Reimagined for Genuine Depth', 'Step away from fleeting interactions. Aura connects gay men seeking real emotional depth, shared values, and authentic partnership in a verified, discrete sanctuary.', 'Experience verified profiles, respectful dialogue, and tailored discovery algorithms.', 'Join Verified Gay Singles', '/auth/register', 'https://images.unsplash.com/photo-1522071820081-009f0129c71c', 'Two gay men smiling warmly at an art exhibition opening', 'Gay Dating | Intentional Matches for Gay Men | Aura', 'Join Aura for intentional gay dating. Verified profiles, privacy-preserving filters, and an elevated queer sanctuary.', 'https://www.auradating.com/gay-dating', '{"category": "GAY_MEN"}', 'system_seed', 'editorial@auradating.com', NOW()),
('ver_seed_lesbian_v1', 'intent.lesbian-dating', 1, 'Authentic Lesbian Dating in an Exclusive, Safe Space', 'A private community crafted for lesbian, queer, and sapphic women seeking meaningful companionship, emotional intimacy, and long-term partnership.', 'Zero catfishing, zero harassment, and 100% photo-verified authentic queer women.', 'Meet Queer & Lesbian Singles', '/auth/register', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb', 'Two lesbian women smiling over coffee in a sunny courtyard', 'Lesbian Dating | Meaningful Sapphic Connections | Aura', 'Connect with verified lesbian and sapphic singles on Aura. Intentional matchmaking and uncompromising safety.', 'https://www.auradating.com/lesbian-dating', '{"category": "LESBIAN_WOMEN"}', 'system_seed', 'editorial@auradating.com', NOW()),
('ver_seed_bi_v1', 'intent.bisexual-dating', 1, 'Bisexual & Pansexual Dating Without Erasure or Fetishization', 'Finally, a luxury dating home where your whole identity is honored and welcomed with reverence, curiosity, and pride.', 'Discover singles of all orientations who celebrate diverse relational journeys and identities.', 'Discover Your Sanctuary', '/auth/register', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7', 'Two people laughing on a private rooftop garden terrace', 'Bisexual Dating | Affirming Inclusive Connections | Aura', 'Aura offers a safe, affirming dating sanctuary for bisexual and pansexual singles looking for authentic intimacy.', 'https://www.auradating.com/bisexual-dating', '{"category": "BISEXUAL_PANSEXUAL"}', 'system_seed', 'editorial@auradating.com', NOW()),
('ver_seed_queer_v1', 'intent.queer-dating', 1, 'Queer & Trans Intimacy Built on Reverence and Care', 'A radical sanctuary where gender expansiveness and authentic queer expression are held with absolute safety, discretion, and celebration.', 'Designed from the foundation up by and for trans, nonbinary, and expansive queer folks.', 'Join the Queer Sanctuary', '/auth/register', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2', 'A diverse group of queer and trans friends celebrating together outdoors', 'Queer & Trans Dating | Affirming Sanctuary | Aura', 'Aura is an intentional, photo-verified dating home for queer, trans, and nonbinary individuals seeking authentic romance.', 'https://www.auradating.com/queer-dating', '{"category": "QUEER_EXPANSIVE"}', 'system_seed', 'editorial@auradating.com', NOW())
ON CONFLICT (id) DO NOTHING;
