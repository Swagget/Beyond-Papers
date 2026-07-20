// Home / discovery feed (§12: Home + search merged). Reads filters from the
// URL so Header's search box, browser back/forward, and shared links all
// stay in sync with what's displayed.

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ResultNature, SearchResponse, Tier, WorkKind } from '@shared/types';
import { api, ApiRequestError } from '../api';
import WorkCard from '../components/WorkCard';
import RankingExplain from '../components/RankingExplain';

const LIMIT = 20;

const KIND_OPTIONS: Array<{ value: WorkKind | ''; label: string }> = [
  { value: '', label: 'All kinds' },
  { value: 'paper', label: 'Paper' },
  { value: 'review', label: 'Review' },
  { value: 'replication', label: 'Replication' },
  { value: 'concept', label: 'Concept' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'code', label: 'Code' },
];

const RESULT_NATURE_OPTIONS: Array<{ value: ResultNature | ''; label: string }> = [
  { value: '', label: 'All results' },
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'null', label: 'Null' },
  { value: 'inconclusive', label: 'Inconclusive' },
];

const TIER_OPTIONS: Array<{ value: Tier | ''; label: string }> = [
  { value: '', label: 'All tiers' },
  { value: 'A', label: 'Tier A' },
  { value: 'B', label: 'Tier B' },
  { value: 'C', label: 'Tier C' },
];

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Best match' },
  { value: 'newest', label: 'Newest first' },
  { value: 'year', label: 'Publication year' },
];

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const kind = searchParams.get('kind') ?? '';
  const resultNature = searchParams.get('result_nature') ?? '';
  const tier = searchParams.get('tier') ?? '';
  const sort = searchParams.get('sort') ?? '';
  const offset = Math.max(0, Number(searchParams.get('offset') ?? '0') || 0);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (kind) params.set('kind', kind);
    if (resultNature) params.set('result_nature', resultNature);
    if (tier) params.set('tier', tier);
    if (sort) params.set('sort', sort);
    params.set('limit', String(LIMIT));
    params.set('offset', String(offset));

    api
      .get<SearchResponse>(`/api/search?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiRequestError ? err.message : 'Something went wrong loading results.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [q, kind, resultNature, tier, sort, offset]);

  const updateFilter = (key: 'kind' | 'result_nature' | 'tier' | 'sort', value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('offset'); // filter changes restart pagination
    setSearchParams(next);
  };

  const goToOffset = (nextOffset: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextOffset > 0) next.set('offset', String(nextOffset));
    else next.delete('offset');
    setSearchParams(next);
  };

  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  return (
    <div className="stack gap-6">
      {!q ? (
        <section className="stack gap-3">
          <p>
            Beyond Papers is a nonprofit, graph-structured research platform where papers, reviews,
            replications, and negative or null results connect as typed, verifiable edges instead of
            sitting as isolated PDFs.
          </p>
          <div className="row gap-2 flex-wrap">
            <Link to="/works/new" className="btn btn-primary btn-sm">
              Submit a work
            </Link>
            <Link to="/import" className="btn btn-ghost btn-sm">
              Import by DOI / arXiv
            </Link>
            <Link to="/about" className="btn btn-ghost btn-sm">
              About Beyond Papers
            </Link>
          </div>
        </section>
      ) : null}

      <div className="row flex-wrap gap-4" role="group" aria-label="Refine results">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="filter-kind">Kind</label>
          <select id="filter-kind" value={kind} onChange={(e) => updateFilter('kind', e.target.value)}>
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="filter-result-nature">Result</label>
          <select
            id="filter-result-nature"
            value={resultNature}
            onChange={(e) => updateFilter('result_nature', e.target.value)}
          >
            {RESULT_NATURE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="filter-tier">License tier</label>
          <select id="filter-tier" value={tier} onChange={(e) => updateFilter('tier', e.target.value)}>
            {TIER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="filter-sort">Sort by</label>
          <select id="filter-sort" value={sort} onChange={(e) => updateFilter('sort', e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="stack gap-4" aria-busy="true" aria-label="Loading results">
          {[0, 1, 2].map((i) => (
            <div className="card" key={i}>
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-text" />
              <div className="skeleton skeleton-text" style={{ width: '80%' }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="empty-state">
          <p className="empty-state-title">Couldn't load results</p>
          <p className="empty-state-body">{error}</p>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No works found</p>
          <p className="empty-state-body">
            {q || kind || resultNature || tier
              ? 'Try a different search term or clear the filters.'
              : 'Nothing has been published yet — be the first to submit or import a work.'}
          </p>
        </div>
      ) : (
        <>
          <div className="stack gap-4">
            {data.items.map((item) => (
              <div key={item.work.id} className="stack gap-2">
                <WorkCard work={item.work} />
                <RankingExplain score={item.score} components={item.score_components} weights={data.weights} />
              </div>
            ))}
          </div>
          <nav className="row justify-between" aria-label="Search result pages">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!hasPrev}
              onClick={() => goToOffset(Math.max(0, offset - LIMIT))}
            >
              ← Previous
            </button>
            <span className="muted small">
              {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!hasNext}
              onClick={() => goToOffset(offset + LIMIT)}
            >
              Next →
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
