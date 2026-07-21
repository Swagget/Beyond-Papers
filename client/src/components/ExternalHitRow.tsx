// One external (OpenAlex) search result with an import action. Used by the
// field-graph focus search and the home search page. Hits already in the
// corpus (or just imported) flip to an "open existing" action instead —
// a callback when the host page wants custom behavior (e.g. add to focus),
// otherwise a plain link to the work.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExternalSearchHit, ImportResult } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';

interface Props {
  hit: ExternalSearchHit;
  withConnections: boolean;
  onImported?: (result: ImportResult) => void;
  /** When set, existing/imported hits show a button calling this instead of a work link. */
  onOpenExisting?: (workId: number, title: string) => void;
  existingActionLabel?: string;
  className?: string;
}

export default function ExternalHitRow({
  hit,
  withConnections,
  onImported,
  onOpenExisting,
  existingActionLabel = 'Open',
  className,
}: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);

  const existingId = imported?.work.id ?? hit.existing_work_id;
  const existingTitle = imported?.work.title ?? hit.title;

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>('/api/import/openalex', {
        openalex_id: hit.openalex_id,
        with_connections: withConnections,
      });
      setImported(res);
      onImported?.(res);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className ? `external-hit ${className}` : 'external-hit'}>
      <div className="external-hit-main">
        <span className="external-hit-title">{hit.title}</span>
        <span className="muted small">
          {hit.publication_year ? `${hit.publication_year} · ` : ''}
          {hit.authors.length > 0 ? `${hit.authors.join(', ')} · ` : ''}
          cited by {hit.cited_by_count.toLocaleString()}
        </span>
        {imported?.neighborhood ? (
          <span className="small" style={{ color: 'var(--color-success)' }}>
            Imported — {imported.neighborhood.imported} new connection
            {imported.neighborhood.imported === 1 ? '' : 's'}, {imported.neighborhood.linked_existing} already
            known, {imported.neighborhood.edges_created} edges
          </span>
        ) : null}
        {error ? (
          <span className="small" style={{ color: 'var(--color-danger)' }}>
            {error}
          </span>
        ) : null}
      </div>
      {existingId != null ? (
        onOpenExisting ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onOpenExisting(existingId, existingTitle)}
          >
            {existingActionLabel}
          </button>
        ) : (
          <Link className="btn btn-ghost btn-sm" to={`/works/${existingId}`}>
            {imported ? 'View →' : 'In corpus →'}
          </Link>
        )
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !user}
          title={!user ? 'Log in to import' : undefined}
          onClick={doImport}
        >
          {busy ? (withConnections ? 'Importing + connections…' : 'Importing…') : 'Import'}
        </button>
      )}
    </div>
  );
}
