// Public AI accountability dashboard (§4.5). Every AI output on the
// platform is flaggable; this page is the transparent record of what
// happened to those flags, per feature.

import { useEffect, useState } from 'react';
import type { AccuracyTrackRecord, AiFeature } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { AiBadge } from '../components/Badges';

const FEATURE_LABEL: Record<AiFeature, string> = {
  summary: 'AI summary',
  glossary: 'AI glossary',
  explainer: 'AI explainer (Q&A)',
};

export default function AiTrackRecordPage() {
  const [items, setItems] = useState<AccuracyTrackRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ items: AccuracyTrackRecord[] }>('/api/ai/track-record')
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiRequestError ? err.message : 'Something went wrong loading the track record.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stack gap-6">
      <header className="stack gap-3">
        <div className="row items-center gap-3">
          <h1>AI accuracy track record</h1>
          <AiBadge label="AI outputs" />
        </div>
        <p>
          Every AI-generated summary, glossary, and explainer on Beyond Papers can be flagged by any
          reader. This page is the public accounting of that process: how many flags each AI feature
          has received, and what happened to them. An <strong>upheld</strong> flag means a moderator
          reviewed it and confirmed the AI output was actually inaccurate — it is the closest thing
          this platform has to a scorecard for AI reliability, and it is never hidden.
        </p>
      </header>

      {loading ? (
        <div className="stack gap-3" aria-busy="true" aria-label="Loading track record">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-text" />
          <div className="skeleton skeleton-text" style={{ width: '70%' }} />
        </div>
      ) : error ? (
        <div className="empty-state">
          <p className="empty-state-title">Couldn't load the track record</p>
          <p className="empty-state-body">{error}</p>
        </div>
      ) : !items || items.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state-title">No AI outputs have been flagged yet</p>
          <p className="empty-state-body">
            Once readers flag AI-generated content, per-feature accuracy stats will appear here.
          </p>
        </div>
      ) : (
        <>
          <table className="table">
            <caption className="sr-only">Flags per AI feature, grouped by resolution status</caption>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">Open</th>
                <th scope="col">Upheld</th>
                <th scope="col">Dismissed</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.feature}>
                  <td>{FEATURE_LABEL[row.feature] ?? row.feature}</td>
                  <td>{row.open}</td>
                  <td
                    style={
                      row.upheld > 0
                        ? { color: 'var(--color-danger)', fontWeight: 'var(--font-weight-semibold)' }
                        : undefined
                    }
                  >
                    {row.upheld}
                  </td>
                  <td>{row.dismissed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            "Upheld" flags are confirmed inaccuracies — a moderator agreed the AI output was wrong or
            misleading. "Dismissed" flags were reviewed and found not to indicate an inaccuracy.
            "Open" flags are awaiting moderator review.
          </p>
        </>
      )}
    </div>
  );
}
