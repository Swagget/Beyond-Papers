import { Link } from 'react-router-dom';
import type { WorkSummary } from '@shared/types';
import { KindBadge, PublicationStatusBadge, ResultBadge, TierBadge } from './Badges';

export default function WorkCard({ work, extra }: { work: WorkSummary; extra?: React.ReactNode }) {
  const authors = work.authors.map((a) => a.name).join(', ');
  return (
    <article className="card">
      <h3 className="card-title">
        <Link to={`/works/${work.id}`}>{work.title}</Link>
      </h3>
      {authors ? <p className="card-authors">{authors}</p> : null}
      {work.abstract ? <p className="card-abstract">{work.abstract}</p> : null}
      <div className="card-badges">
        <TierBadge tier={work.tier} license={work.license} />
        <KindBadge kind={work.kind} />
        <PublicationStatusBadge status={work.publication_status} />
        <ResultBadge nature={work.result_nature} />
      </div>
      <footer className="card-meta">
        <span>{work.publication_year ?? work.created_at.slice(0, 10)}</span>
        <span className="card-meta-sep">·</span>
        <span>{work.source === 'native' ? 'contributed' : `via ${work.source}`}</span>
        {work.site_name ? (
          <>
            <span className="card-meta-sep">·</span>
            <span>{work.site_name}</span>
          </>
        ) : null}
        {work.doi ? (
          <>
            <span className="card-meta-sep">·</span>
            <span className="muted">doi:{work.doi}</span>
          </>
        ) : null}
        {extra}
      </footer>
    </article>
  );
}
