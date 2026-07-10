// Frozen-snapshot resolver (§1.3). content_hash is not globally unique — a
// revert legitimately reproduces an old hash byte-for-byte — so the API
// returns a list of matches; we render the most recent as the primary read.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { LicenseId, Tier, WorkVersion } from '@shared/types';
import { licenseToTier } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { TierBadge } from '../components/Badges';

interface VersionMatchWork {
  id: number;
  title: string;
  tier: Tier;
  license: LicenseId;
}

interface VersionMatch {
  version: WorkVersion;
  work: VersionMatchWork;
}

interface VersionResolveResponse {
  matches: VersionMatch[];
}

export default function VersionPage() {
  const { hash } = useParams<{ hash: string }>();

  const [data, setData] = useState<VersionResolveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<VersionResolveResponse>(`/api/versions/${hash}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiRequestError ? err.message : 'Failed to resolve this version hash.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  if (loading) {
    return (
      <div className="stack gap-3">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-text" />
        <div className="skeleton skeleton-text" style={{ width: '80%' }} />
        <div className="skeleton skeleton-text" style={{ width: '60%' }} />
      </div>
    );
  }

  if (error || !data || data.matches.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Snapshot not found</p>
        <p className="empty-state-body">{error ?? `No version matches content hash ${hash ?? ''}.`}</p>
      </div>
    );
  }

  const primary = data.matches[0];
  const content = primary.version.content;
  const fullHash = primary.version.content_hash;

  return (
    <div className="stack gap-6">
      <div
        className="card"
        style={{ borderLeftWidth: 'var(--border-width-thick)', borderLeftStyle: 'solid', borderLeftColor: 'var(--color-accent)' }}
      >
        <p>
          <strong>Frozen snapshot</strong> — content-addressed <code>{fullHash.slice(0, 16)}…</code>; this
          exact content is permanently citable.
        </p>
      </div>

      {data.matches.length > 1 ? (
        <div className="stack gap-2">
          <p className="muted small">
            This hash matches {data.matches.length} versions (e.g. a revert can reproduce an earlier
            version's content byte-for-byte):
          </p>
          <ul className="stack gap-1">
            {data.matches.map((m) => (
              <li key={m.version.id}>
                <Link to={`/works/${m.work.id}`}>{m.work.title}</Link> — v{m.version.version_number}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="row gap-3 items-center flex-wrap">
        <Link to={`/works/${primary.work.id}`} className="btn btn-sm btn-ghost">
          View the live work
        </Link>
        <TierBadge tier={primary.work.tier} license={primary.work.license} />
      </div>

      <article className="article-body">
        <h1>{content.title}</h1>
        <p className="muted small">
          v{primary.version.version_number} · {primary.version.created_at.slice(0, 10)} ·{' '}
          <TierBadge tier={licenseToTier(primary.version.license)} license={primary.version.license} />
        </p>

        {content.abstract ? (
          <section>
            <h2>Abstract</h2>
            <p>{content.abstract}</p>
          </section>
        ) : null}

        {content.sections.map((s) => (
          <section key={`${s.order}-${s.heading}`}>
            <h2>{s.heading}</h2>
            <p>{s.body}</p>
          </section>
        ))}

        {content.references.length > 0 ? (
          <section>
            <h2>References</h2>
            <ol className="stack gap-2">
              {content.references.map((r) => (
                <li key={r.label}>
                  <span className="muted small">{r.label}</span> {r.raw}
                  {r.work_id ? (
                    <>
                      {' '}
                      · <Link to={`/works/${r.work_id}`}>view on Beyond Papers</Link>
                    </>
                  ) : null}
                  {r.url ? (
                    <>
                      {' '}
                      · <a href={r.url}>{r.url}</a>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </article>
    </div>
  );
}
