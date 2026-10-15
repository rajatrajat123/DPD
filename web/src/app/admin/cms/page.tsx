'use client';

import React, { useEffect, useState } from 'react';

interface ContentItem {
  id: string;
  content_type: string;
  slug: string;
  title: string;
  status: string;
  published_version_id?: string;
  published_at?: string;
  updated_at: string;
}

interface ContentVersion {
  id: string;
  content_item_id: string;
  version_number: number;
  headline: string;
  subheading: string;
  body_markdown: string;
  cta_label: string;
  cta_url: string;
  image_url: string;
  image_alt: string;
  seo_meta_title: string;
  seo_meta_description: string;
  seo_canonical_url: string;
  metadata?: Record<string, any>;
  author_email: string;
  created_at: string;
}

interface ContentItemDetail {
  item: ContentItem;
  current_version: ContentVersion;
  published_version?: ContentVersion;
  versions: ContentVersion[];
}

interface CMSAuditRecord {
  id: string;
  content_item_id: string;
  action: string;
  actor_email: string;
  details?: Record<string, any>;
  created_at: string;
}

export default function CMSAdminPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [selectedID, setSelectedID] = useState<string>('homepage.hero');
  const [detail, setDetail] = useState<ContentItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'history' | 'audit'>('editor');
  const [auditLogs, setAuditLogs] = useState<CMSAuditRecord[]>([]);

  // Form State
  const [headline, setHeadline] = useState('');
  const [subheading, setSubheading] = useState('');
  const [bodyMarkdown, setBodyMarkdown] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageAlt, setImageAlt] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [seoCanonical, setSeoCanonical] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  // Load Content Items list
  useEffect(() => {
    async function fetchItems() {
      try {
        const res = await fetch('/api/admin/cms/content');
        if (res.ok) {
          const data = await res.json();
          if (data.items && Array.isArray(data.items)) {
            setItems(data.items);
          }
        }
      } catch (err) {
        console.error('Failed to load CMS content items:', err);
      }
    }
    fetchItems();
  }, []);

  // Load Detail when selectedID changes
  useEffect(() => {
    async function fetchDetail() {
      setLoading(true);
      setStatusMessage(null);
      try {
        const res = await fetch(`/api/admin/cms/content/${encodeURIComponent(selectedID)}`);
        if (res.ok) {
          const data = await res.json();
          setDetail(data);

          const ver = data.current_version;
          if (ver) {
            setHeadline(ver.headline || '');
            setSubheading(ver.subheading || '');
            setBodyMarkdown(ver.body_markdown || '');
            setCtaLabel(ver.cta_label || '');
            setCtaUrl(ver.cta_url || '');
            setImageUrl(ver.image_url || '');
            setImageAlt(ver.image_alt || '');
            setSeoTitle(ver.seo_meta_title || '');
            setSeoDescription(ver.seo_meta_description || '');
            setSeoCanonical(ver.seo_canonical_url || '');
          }
        }
      } catch (err) {
        console.error('Failed to load content item detail:', err);
      } finally {
        setLoading(false);
      }
    }

    if (selectedID) {
      fetchDetail();
    }
  }, [selectedID]);

  // Load Audit Trail
  const loadAuditTrail = async () => {
    try {
      const res = await fetch('/api/admin/cms/audit');
      if (res.ok) {
        const data = await res.json();
        if (data.records && Array.isArray(data.records)) {
          setAuditLogs(data.records);
        }
      }
    } catch (err) {
      console.error('Failed to load CMS audit trail:', err);
    }
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage(null);

    const payload = {
      headline,
      subheading,
      body_markdown: bodyMarkdown,
      cta_label: ctaLabel,
      cta_url: ctaUrl,
      image_url: imageUrl,
      image_alt: imageAlt,
      seo_meta_title: seoTitle,
      seo_meta_description: seoDescription,
      seo_canonical_url: seoCanonical,
    };

    try {
      const res = await fetch(`/api/admin/cms/content/${encodeURIComponent(selectedID)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to save draft');
      }

      setDetail(data);
      setStatusMessage({ type: 'success', text: `Draft saved successfully (Version #${data.current_version.version_number}).` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Draft save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!detail?.current_version) return;
    setPublishing(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/admin/cms/content/${encodeURIComponent(selectedID)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_id: detail.current_version.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to publish version');
      }

      setDetail(data);
      setStatusMessage({ type: 'success', text: `Version #${data.current_version.version_number} is now LIVE in production!` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Publish failed' });
    } finally {
      setPublishing(false);
    }
  };

  const handleRevert = async (versionNumber: number) => {
    if (!confirm(`Are you sure you want to revert to Version #${versionNumber}? This will create a new draft cloned from Version #${versionNumber}.`)) {
      return;
    }

    setSaving(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/admin/cms/content/${encodeURIComponent(selectedID)}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_number: versionNumber }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Failed to revert version');
      }

      setDetail(data);
      const ver = data.current_version;
      setHeadline(ver.headline || '');
      setSubheading(ver.subheading || '');
      setBodyMarkdown(ver.body_markdown || '');
      setCtaLabel(ver.cta_label || '');
      setCtaUrl(ver.cta_url || '');
      setImageUrl(ver.image_url || '');
      setImageAlt(ver.image_alt || '');
      setSeoTitle(ver.seo_meta_title || '');
      setSeoDescription(ver.seo_meta_description || '');
      setSeoCanonical(ver.seo_canonical_url || '');

      setStatusMessage({ type: 'success', text: `Successfully reverted to Version #${versionNumber}. New draft ready for review.` });
      setActiveTab('editor');
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Revert failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    setStatusMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('alt_text', imageAlt || file.name);

    try {
      const res = await fetch('/api/admin/cms/media', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Media upload failed');
      }

      setImageUrl(data.asset.public_url);
      setStatusMessage({ type: 'success', text: `Asset ${data.asset.filename} uploaded with EXIF stripped and saved.` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Image upload failed' });
    } finally {
      setUploadingImage(false);
    }
  };

  const hasUnpublishedChanges =
    detail?.item.status === 'DRAFT' ||
    (detail?.published_version && detail?.current_version?.id !== detail?.published_version?.id);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* CMS Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-[#161922] via-[#1A1D28] to-[#161922] border border-[#262a36]">
        <div>
          <div className="text-xs uppercase tracking-widest text-[#C3A15B] font-bold mb-1">
            Content & Marketing Management System (CMS)
          </div>
          <h1 className="text-2xl font-serif text-white font-medium">
            Editorial Copydesk & Landing Page CMS
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Database-backed content editing for homepage hero banners, navigation ordering, dating category copy, and SEO metadata.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {hasUnpublishedChanges && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              ● Unpublished Draft Changes
            </span>
          )}
          {detail?.item.status === 'PUBLISHED' && !hasUnpublishedChanges && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              ● Published Live
            </span>
          )}
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-4 rounded-xl text-xs font-medium border ${
            statusMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Main CMS Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar: Content Sections List */}
        <div className="lg:col-span-1 space-y-3">
          <div className="text-xs uppercase tracking-wider text-neutral-400 font-bold px-1">
            Managed Content Items
          </div>
          <div className="bg-[#14161F] border border-[#262a36] rounded-2xl p-2 divide-y divide-[#202533]">
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedID(item.id)}
                className={`w-full text-left p-3 rounded-xl text-xs transition ${
                  selectedID === item.id
                    ? 'bg-[#C3A15B]/15 text-[#E3C77D] font-semibold border border-[#C3A15B]/30'
                    : 'text-neutral-300 hover:bg-[#1A1D28] hover:text-white'
                }`}
              >
                <div className="font-medium truncate">{item.title}</div>
                <div className="flex items-center justify-between text-[10px] text-neutral-400 mt-1">
                  <span className="font-mono text-neutral-400">{item.slug}</span>
                  <span
                    className={`font-semibold uppercase ${
                      item.status === 'PUBLISHED' ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="p-4 rounded-xl bg-[#14161F] border border-[#262a36] text-[11px] text-neutral-400 leading-relaxed">
            <span className="text-[#C3A15B] font-semibold">Governance Guarantee:</span> Changes are saved as isolated drafts in PostgreSQL. Live production copy is updated only upon explicit &quot;Publish Live&quot; action.
          </div>
        </div>

        {/* Right Main Column: Editor & Tabs */}
        <div className="lg:col-span-3 space-y-4">
          {/* Workspace Tabs */}
          <div className="flex items-center gap-2 border-b border-[#262a36] pb-3">
            <button
              onClick={() => setActiveTab('editor')}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
                activeTab === 'editor'
                  ? 'bg-[#C3A15B] text-[#0d0f12] font-semibold'
                  : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
              }`}
            >
              Draft Editor
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
                activeTab === 'history'
                  ? 'bg-[#C3A15B] text-[#0d0f12] font-semibold'
                  : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
              }`}
            >
              Version History ({detail?.versions?.length || 0})
            </button>
            <button
              onClick={() => {
                setActiveTab('audit');
                loadAuditTrail();
              }}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
                activeTab === 'audit'
                  ? 'bg-[#C3A15B] text-[#0d0f12] font-semibold'
                  : 'text-neutral-400 hover:text-white hover:bg-[#1A1D28]'
              }`}
            >
              CMS Audit Log
            </button>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs text-neutral-400 bg-[#14161F] rounded-2xl border border-[#262a36]">
              Loading content item details...
            </div>
          ) : activeTab === 'editor' ? (
            <form onSubmit={handleSaveDraft} className="space-y-6">
              {/* Core Copy Fields */}
              <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36] space-y-4">
                <div className="border-b border-[#262a36] pb-3 flex items-center justify-between">
                  <h3 className="text-sm font-serif text-white font-medium">Headlines & Editorial Copy</h3>
                  <span className="text-[10px] text-neutral-400 font-mono">ID: {selectedID}</span>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                    Primary Headline
                  </label>
                  <input
                    type="text"
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                    Subheading / Tagline
                  </label>
                  <input
                    type="text"
                    value={subheading}
                    onChange={(e) => setSubheading(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                    Body Markdown / Story Copy
                  </label>
                  <textarea
                    rows={4}
                    value={bodyMarkdown}
                    onChange={(e) => setBodyMarkdown(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-xs font-mono focus:outline-none focus:border-[#C3A15B]"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                      Call to Action Label
                    </label>
                    <input
                      type="text"
                      value={ctaLabel}
                      onChange={(e) => setCtaLabel(e.target.value)}
                      placeholder="e.g. Apply for Membership"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                      Call to Action Target URL
                    </label>
                    <input
                      type="text"
                      value={ctaUrl}
                      onChange={(e) => setCtaUrl(e.target.value)}
                      placeholder="e.g. /auth/register"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                    />
                  </div>
                </div>
              </div>

              {/* Marketing Media & Image Upload */}
              <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36] space-y-4">
                <div className="border-b border-[#262a36] pb-3 flex items-center justify-between">
                  <h3 className="text-sm font-serif text-white font-medium">Hero Image & Marketing Media</h3>
                  <span className="text-[10px] text-emerald-400">EXIF Stripping Pipeline Active</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                  <div className="md:col-span-2 space-y-4">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                        Image Public URL
                      </label>
                      <input
                        type="text"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="https://... or /uploads/marketing/..."
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                        Image Alt Text (Accessibility & SEO)
                      </label>
                      <input
                        type="text"
                        value={imageAlt}
                        onChange={(e) => setImageAlt(e.target.value)}
                        placeholder="Descriptive alt text for screen readers"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                        Upload New Marketing Asset
                      </label>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleFileUpload}
                        disabled={uploadingImage}
                        className="text-xs text-neutral-400 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#C3A15B] file:text-[#0d0f12] hover:file:brightness-105 cursor-pointer"
                      />
                      {uploadingImage && <span className="text-xs text-[#C3A15B] ml-2">Processing & stripping EXIF...</span>}
                    </div>
                  </div>

                  {/* Thumbnail Preview */}
                  <div className="p-3 bg-[#0B0D12] border border-[#262a36] rounded-xl text-center">
                    <div className="text-[10px] uppercase text-neutral-400 font-bold mb-2">Live Asset Preview</div>
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={imageAlt || 'Preview'}
                        className="w-full h-32 object-cover rounded-lg border border-neutral-800"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23222" width="100" height="100"/><text fill="%23888" x="50%" y="50%" text-anchor="middle">No Image</text></svg>';
                        }}
                      />
                    ) : (
                      <div className="w-full h-32 flex items-center justify-center text-neutral-600 text-xs border border-dashed border-neutral-800 rounded-lg">
                        No image set
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SEO Metadata Fields */}
              <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36] space-y-4">
                <div className="border-b border-[#262a36] pb-3 flex items-center justify-between">
                  <h3 className="text-sm font-serif text-white font-medium">Search Engine Optimization (SEO)</h3>
                  <span className="text-[10px] text-[#C3A15B]">Zero Regressions Guard</span>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                    Meta Title Tag
                  </label>
                  <input
                    type="text"
                    value={seoTitle}
                    onChange={(e) => setSeoTitle(e.target.value)}
                    placeholder="Page Title | Aura LGBTQ+ Dating"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                    Meta Description
                  </label>
                  <textarea
                    rows={2}
                    value={seoDescription}
                    onChange={(e) => setSeoDescription(e.target.value)}
                    placeholder="Concise 150-160 character description for search snippets"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-xs focus:outline-none focus:border-[#C3A15B]"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 font-medium mb-1">
                    Canonical URL
                  </label>
                  <input
                    type="text"
                    value={seoCanonical}
                    onChange={(e) => setSeoCanonical(e.target.value)}
                    placeholder="https://www.auradating.com/..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B0D12] border border-neutral-700 text-white text-sm focus:outline-none focus:border-[#C3A15B]"
                  />
                </div>
              </div>

              {/* Workflow Action Bar */}
              <div className="flex items-center justify-between p-4 rounded-2xl bg-[#14161F] border border-[#262a36]">
                <div className="text-xs text-neutral-400">
                  Current Draft: <span className="font-mono text-white">v{detail?.current_version?.version_number || 1}</span> by{' '}
                  <span className="text-neutral-300">{detail?.current_version?.author_email || 'editorial'}</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={saving || publishing}
                    className="px-5 py-2.5 rounded-xl text-xs font-medium bg-[#202533] text-white border border-[#2d3345] hover:border-neutral-500 transition disabled:opacity-50"
                  >
                    {saving ? 'Saving Draft...' : 'Save Draft'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={saving || publishing}
                    className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-[#C3A15B] to-[#E3C77D] text-[#0d0f12] hover:brightness-105 transition shadow-lg shadow-[#C3A15B]/15 disabled:opacity-50"
                  >
                    {publishing ? 'Publishing Live...' : 'Publish Live to Production'}
                  </button>
                </div>
              </div>
            </form>
          ) : activeTab === 'history' ? (
            <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36] space-y-4">
              <div className="border-b border-[#262a36] pb-3">
                <h3 className="text-sm font-serif text-white font-medium">Immutable Version Ledger</h3>
                <p className="text-xs text-neutral-400">All historical snapshots with 1-click safe rollback</p>
              </div>

              <div className="space-y-3">
                {detail?.versions?.map((ver) => {
                  const isCurrent = ver.id === detail.current_version.id;
                  const isPublished = ver.id === detail.published_version?.id;

                  return (
                    <div
                      key={ver.id}
                      className="p-4 rounded-xl bg-[#0B0D12] border border-[#262a36] flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-[#C3A15B]">
                            Version #{ver.version_number}
                          </span>
                          {isPublished && (
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              Currently Live
                            </span>
                          )}
                          {isCurrent && !isPublished && (
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              Current Draft
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white font-medium">{ver.headline}</div>
                        <div className="text-[11px] text-neutral-400">
                          Authored by <span className="text-neutral-300">{ver.author_email}</span> on{' '}
                          {new Date(ver.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleRevert(ver.version_number)}
                            className="px-4 py-2 rounded-xl text-xs font-medium bg-[#1F2330] text-neutral-200 border border-[#2b3142] hover:text-white hover:border-[#C3A15B] transition"
                          >
                            Revert to This Version
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-[#14161F] border border-[#262a36] space-y-4">
              <div className="border-b border-[#262a36] pb-3">
                <h3 className="text-sm font-serif text-white font-medium">CMS Audit Trail</h3>
                <p className="text-xs text-neutral-400">Chronological history of editorial and publishing events</p>
              </div>

              {auditLogs.length === 0 ? (
                <div className="text-xs text-neutral-400 py-6 text-center">No audit records recorded yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#262a36] text-neutral-400 uppercase text-[10px] font-mono">
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Item ID</th>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-3">Editor</th>
                        <th className="py-2.5 px-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#202533]">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-[#181c27] transition">
                          <td className="py-2.5 px-3 font-mono text-neutral-400">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-neutral-300">{log.content_item_id}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#C3A15B]/15 text-[#E3C77D] border border-[#C3A15B]/30">
                              {log.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-neutral-300">{log.actor_email}</td>
                          <td className="py-2.5 px-3 font-mono text-neutral-400 text-[10px] max-w-[200px] truncate">
                            {JSON.stringify(log.details || {})}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
