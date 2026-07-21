// Route: /import — POST /api/import/{doi,arxiv,openalex}. See docs/ARCHITECTURE.md §10, §13.9.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ImportResult, LicenseId, PublicationStatus, UrlPreviewResponse } from '@shared/types';
import { LICENSE_IDS, PUBLICATION_STATUSES } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import WorkCard from '../components/WorkCard';

type TabId = 'doi' | 'arxiv' | 'openalex' | 'url';

const TABS: { id: TabId; label: string }[] = [
  { id: 'doi', label: 'DOI' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'openalex', label: 'OpenAlex' },
  { id: 'url', label: 'Web / Blog' },
];

// Two-step URL import: fetch a preview (server does one polite page fetch), then let
// the user review/correct every field before saving. A blocked or failed fetch just
// means an empty form — the work can still be created with the link saved.
function UrlImportTab() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<UrlPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Editable form fields, pre-filled from the preview when extraction succeeds.
  const [title, setTitle] = useState('');
  const [authorsText, setAuthorsText] = useState('');
  const [year, setYear] = useState('');
  const [siteName, setSiteName] = useState('');
  const [abstract, setAbstract] = useState('');
  const [license, setLicense] = useState<LicenseId>('unknown');
  const [status, setStatus] = useState<PublicationStatus>('informal');

  async function fetchPreview(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setResult(null);
    try {
      const res = await api.post<UrlPreviewResponse>('/api/import/url/preview', { url: url.trim() });
      setPreview(res);
      const x = res.extracted;
      setTitle(x?.title ?? '');
      setAuthorsText((x?.authors ?? []).join('\n'));
      setYear(x?.publication_year ? String(x.publication_year) : '');
      setSiteName(x?.site_name ?? '');
      setAbstract(x?.abstract ?? '');
      setLicense(x?.license ?? 'unknown');
      setStatus('informal');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaveBusy(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>('/api/import/url', {
        url: (preview?.url ?? url).trim(),
        title: title.trim(),
        authors: authorsText.split(/\n|,/).map((a) => a.trim()).filter(Boolean),
        publication_year: year.trim() ? Number(year.trim()) : null,
        site_name: siteName.trim() || null,
        abstract: abstract.trim() || null,
        license,
        publication_status: status,
        doi: preview?.extracted?.doi ?? null,
        arxiv_id: preview?.extracted?.arxiv_id ?? null,
      });
      setResult(res);
      setPreview(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Import failed.');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div role="tabpanel" id="panel-url" aria-labelledby="tab-url" className="stack">
      <form className="row" onSubmit={fetchPreview}>
        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
          <label htmlFor="import-url">Page URL</label>
          <input
            id="import-url"
            type="url"
            placeholder="https://transformer-circuits.pub/2025/attribution-graphs/biology.html"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Fetching…' : 'Fetch'}
        </button>
      </form>
      <p className="field-hint">
        The page is fetched once, politely — robots.txt is respected and access refusals are honored. If the
        site declines, you can still fill in the details by hand; the link is saved either way.
      </p>

      {error ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {error}
        </p>
      ) : null}

      {preview?.existing_work_id ? (
        <div className="empty-state">
          <p className="empty-state-title">Already in the corpus</p>
          <p className="empty-state-body">
            This page matches an existing work —{' '}
            <Link to={`/works/${preview.existing_work_id}`}>open it</Link> instead of importing again.
          </p>
        </div>
      ) : preview ? (
        <form className="stack" onSubmit={save}>
          {preview.fetch_status !== 'ok' ? (
            <p className="field-hint" role="status">
              {preview.message ?? 'The page could not be fetched.'} Fill in the details manually — the link
              will still be saved.
            </p>
          ) : (
            <p className="field-hint" role="status">
              Metadata extracted — review and correct anything before saving.
            </p>
          )}
          <div className="field">
            <label htmlFor="url-title">Title</label>
            <input id="url-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="url-authors">Authors (one per line, or comma-separated)</label>
            <textarea
              id="url-authors"
              rows={3}
              value={authorsText}
              onChange={(e) => setAuthorsText(e.target.value)}
            />
          </div>
          <div className="row">
            <div className="field" style={{ width: '8rem' }}>
              <label htmlFor="url-year">Year</label>
              <input id="url-year" type="number" min={1500} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="url-site">Site name</label>
              <input id="url-site" type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="url-abstract">Abstract / description</label>
            <textarea id="url-abstract" rows={4} value={abstract} onChange={(e) => setAbstract(e.target.value)} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="url-license">License</label>
              <select id="url-license" value={license} onChange={(e) => setLicense(e.target.value as LicenseId)}>
                {LICENSE_IDS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="url-status">Publication status</label>
              <select
                id="url-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as PublicationStatus)}
              >
                {PUBLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {preview.extracted?.doi || preview.extracted?.arxiv_id ? (
            <p className="field-hint">
              This page declares {preview.extracted.doi ? `DOI ${preview.extracted.doi}` : `arXiv ${preview.extracted.arxiv_id}`} —
              consider importing via the {preview.extracted.doi ? 'DOI' : 'arXiv'} tab instead for authoritative
              metadata. Saving here keeps the id attached for dedup.
            </p>
          ) : null}
          <div>
            <button type="submit" className="btn btn-primary" disabled={saveBusy || !title.trim()}>
              {saveBusy ? 'Saving…' : 'Save to corpus'}
            </button>
          </div>
        </form>
      ) : null}

      {result ? <ImportResultCard result={result} /> : null}
    </div>
  );
}

function ImportResultCard({ result }: { result: ImportResult }) {
  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      {!result.created ? (
        <p className="field-hint">This work already existed — deduped onto the existing node.</p>
      ) : null}
      <WorkCard work={result.work} />
    </div>
  );
}

export default function ImportPage() {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('doi');

  // DOI tab state
  const [doi, setDoi] = useState('');
  const [doiBusy, setDoiBusy] = useState(false);
  const [doiError, setDoiError] = useState<string | null>(null);
  const [doiResult, setDoiResult] = useState<ImportResult | null>(null);

  // arXiv tab state
  const [arxivId, setArxivId] = useState('');
  const [arxivBusy, setArxivBusy] = useState(false);
  const [arxivError, setArxivError] = useState<string | null>(null);
  const [arxivResult, setArxivResult] = useState<ImportResult | null>(null);

  // OpenAlex tab state
  const [openAlexMode, setOpenAlexMode] = useState<'single' | 'batch'>('single');
  const [openAlexId, setOpenAlexId] = useState('');
  const [openAlexQuery, setOpenAlexQuery] = useState('');
  const [openAlexLimit, setOpenAlexLimit] = useState(20);
  const [openAlexBusy, setOpenAlexBusy] = useState(false);
  const [openAlexError, setOpenAlexError] = useState<string | null>(null);
  const [openAlexResult, setOpenAlexResult] = useState<ImportResult | null>(null);
  const [openAlexBatchResults, setOpenAlexBatchResults] = useState<ImportResult[] | null>(null);

  if (authLoading) {
    return (
      <div className="stack">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Log in to import</p>
        <p className="empty-state-body">Importing works requires an account so contributions stay attributable.</p>
        <Link to="/login" className="btn btn-primary btn-sm">
          Log in
        </Link>
      </div>
    );
  }

  async function submitDoi(e: FormEvent) {
    e.preventDefault();
    if (!doi.trim()) return;
    setDoiBusy(true);
    setDoiError(null);
    setDoiResult(null);
    try {
      const res = await api.post<ImportResult>('/api/import/doi', { doi: doi.trim() });
      setDoiResult(res);
    } catch (err) {
      setDoiError(err instanceof ApiRequestError ? err.message : 'Import failed.');
    } finally {
      setDoiBusy(false);
    }
  }

  async function submitArxiv(e: FormEvent) {
    e.preventDefault();
    if (!arxivId.trim()) return;
    setArxivBusy(true);
    setArxivError(null);
    setArxivResult(null);
    try {
      const res = await api.post<ImportResult>('/api/import/arxiv', { arxiv_id: arxivId.trim() });
      setArxivResult(res);
    } catch (err) {
      setArxivError(err instanceof ApiRequestError ? err.message : 'Import failed.');
    } finally {
      setArxivBusy(false);
    }
  }

  async function submitOpenAlexSingle(e: FormEvent) {
    e.preventDefault();
    if (!openAlexId.trim()) return;
    setOpenAlexBusy(true);
    setOpenAlexError(null);
    setOpenAlexResult(null);
    try {
      const res = await api.post<ImportResult>('/api/import/openalex', { openalex_id: openAlexId.trim() });
      setOpenAlexResult(res);
    } catch (err) {
      setOpenAlexError(err instanceof ApiRequestError ? err.message : 'Import failed.');
    } finally {
      setOpenAlexBusy(false);
    }
  }

  async function submitOpenAlexBatch(e: FormEvent) {
    e.preventDefault();
    if (!openAlexQuery.trim()) return;
    setOpenAlexBusy(true);
    setOpenAlexError(null);
    setOpenAlexBatchResults(null);
    try {
      const limit = Math.min(50, Math.max(1, openAlexLimit || 1));
      const res = await api.post<{ items: ImportResult[] }>('/api/import/openalex', {
        query: openAlexQuery.trim(),
        limit,
      });
      setOpenAlexBatchResults(res.items);
    } catch (err) {
      setOpenAlexError(err instanceof ApiRequestError ? err.message : 'Import failed.');
    } finally {
      setOpenAlexBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div className="stack" style={{ flex: '2 1 28rem' }}>
        <div>
          <h1>Import</h1>
          <p className="muted">Bring in a work from an external identifier. License decides what the platform can host — not the venue (§3.1).</p>
        </div>

        <div className="tabs" role="tablist" aria-label="Import source">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              className={activeTab === tab.id ? 'tab tab-active' : 'tab'}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'doi' ? (
          <div role="tabpanel" id="panel-doi" aria-labelledby="tab-doi" className="stack">
            <form className="row" onSubmit={submitDoi}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="import-doi">DOI</label>
                <input
                  id="import-doi"
                  type="text"
                  placeholder="10.1234/example"
                  value={doi}
                  onChange={(e) => setDoi(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={doiBusy}>
                {doiBusy ? 'Importing…' : 'Import'}
              </button>
            </form>
            {doiError ? (
              <p role="alert" style={{ color: 'var(--color-danger)' }}>
                {doiError}
              </p>
            ) : null}
            {doiResult ? <ImportResultCard result={doiResult} /> : null}
          </div>
        ) : null}

        {activeTab === 'arxiv' ? (
          <div role="tabpanel" id="panel-arxiv" aria-labelledby="tab-arxiv" className="stack">
            <form className="row" onSubmit={submitArxiv}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="import-arxiv">arXiv ID</label>
                <input
                  id="import-arxiv"
                  type="text"
                  placeholder="2301.12345"
                  value={arxivId}
                  onChange={(e) => setArxivId(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={arxivBusy}>
                {arxivBusy ? 'Importing…' : 'Import'}
              </button>
            </form>
            {arxivError ? (
              <p role="alert" style={{ color: 'var(--color-danger)' }}>
                {arxivError}
              </p>
            ) : null}
            {arxivResult ? <ImportResultCard result={arxivResult} /> : null}
          </div>
        ) : null}

        {activeTab === 'openalex' ? (
          <div role="tabpanel" id="panel-openalex" aria-labelledby="tab-openalex" className="stack">
            <div className="row" role="radiogroup" aria-label="OpenAlex import mode">
              <label className="row" style={{ gap: 'var(--space-1)' }}>
                <input
                  type="radio"
                  name="openalex-mode"
                  checked={openAlexMode === 'single'}
                  onChange={() => setOpenAlexMode('single')}
                />
                Import by ID
              </label>
              <label className="row" style={{ gap: 'var(--space-1)' }}>
                <input
                  type="radio"
                  name="openalex-mode"
                  checked={openAlexMode === 'batch'}
                  onChange={() => setOpenAlexMode('batch')}
                />
                Search &amp; import many
              </label>
            </div>

            {openAlexMode === 'single' ? (
              <form className="row" onSubmit={submitOpenAlexSingle}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <label htmlFor="import-openalex-id">OpenAlex work ID</label>
                  <input
                    id="import-openalex-id"
                    type="text"
                    placeholder="W2741809807"
                    value={openAlexId}
                    onChange={(e) => setOpenAlexId(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={openAlexBusy}>
                  {openAlexBusy ? 'Importing…' : 'Import'}
                </button>
              </form>
            ) : (
              <form className="stack" onSubmit={submitOpenAlexBatch}>
                <div className="row">
                  <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                    <label htmlFor="import-openalex-query">Search query</label>
                    <input
                      id="import-openalex-query"
                      type="text"
                      placeholder="sparse attention long context"
                      value={openAlexQuery}
                      onChange={(e) => setOpenAlexQuery(e.target.value)}
                    />
                  </div>
                  <div className="field" style={{ width: '8rem', marginBottom: 0 }}>
                    <label htmlFor="import-openalex-limit">Limit (≤ 50)</label>
                    <input
                      id="import-openalex-limit"
                      type="number"
                      min={1}
                      max={50}
                      value={openAlexLimit}
                      onChange={(e) => setOpenAlexLimit(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <button type="submit" className="btn btn-primary" disabled={openAlexBusy}>
                    {openAlexBusy ? 'Importing…' : 'Search & import'}
                  </button>
                </div>
              </form>
            )}

            {openAlexError ? (
              <p role="alert" style={{ color: 'var(--color-danger)' }}>
                {openAlexError}
              </p>
            ) : null}
            {openAlexMode === 'single' && openAlexResult ? <ImportResultCard result={openAlexResult} /> : null}
            {openAlexMode === 'batch' && openAlexBatchResults ? (
              openAlexBatchResults.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-title">No results</p>
                  <p className="empty-state-body">That query didn't match anything on OpenAlex.</p>
                </div>
              ) : (
                <div className="stack">
                  {openAlexBatchResults.map((r) => (
                    <ImportResultCard key={r.work.id} result={r} />
                  ))}
                </div>
              )
            ) : null}
          </div>
        ) : null}

        {activeTab === 'url' ? <UrlImportTab /> : null}
      </div>

      <aside className="card" style={{ flex: '1 1 16rem' }}>
        <h4>The three-tier license model</h4>
        <p className="small" style={{ marginTop: 'var(--space-2)' }}>
          <span className="badge badge-tier-a">Tier A</span> Metadata + abstract only, universal — every work
          lands here at minimum.
        </p>
        <p className="small" style={{ marginTop: 'var(--space-2)' }}>
          <span className="badge badge-tier-b">Tier B</span> Hosted in full, unchanged (ND licenses) — no
          decomposition, no AI transformation.
        </p>
        <p className="small" style={{ marginTop: 'var(--space-2)' }}>
          <span className="badge badge-tier-c">Tier C</span> Fully transformable (CC-BY, CC-BY-SA, CC0) —
          sub-units and AI features unlock.
        </p>
        <p className="field-hint" style={{ marginTop: 'var(--space-3)' }}>
          The license decides the tier, not the venue or an "open access" flag (§3.1). NonCommercial (NC)
          licenses are excluded from hosting and transformation for now and always land as Tier A (§3.2).
        </p>
      </aside>
    </div>
  );
}
