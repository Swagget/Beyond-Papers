// Route: /import — POST /api/import/{doi,arxiv,openalex}. See docs/ARCHITECTURE.md §10, §13.9.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ImportResult } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import WorkCard from '../components/WorkCard';

type TabId = 'doi' | 'arxiv' | 'openalex';

const TABS: { id: TabId; label: string }[] = [
  { id: 'doi', label: 'DOI' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'openalex', label: 'OpenAlex' },
];

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
