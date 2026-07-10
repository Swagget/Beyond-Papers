// Addressable sub-unit block (§1.2). Renders inline within the article
// column after the work's sections. Tier-gated upstream (only ever
// non-empty when work.tier === 'C') — this component just renders whatever
// it is handed.

import type { Subunit, SubunitType } from '@shared/types';

const TYPE_LABEL: Record<SubunitType, string> = {
  hypothesis: 'Hypothesis',
  method: 'Method',
  result: 'Result',
  dataset: 'Dataset',
  code: 'Code',
  claim: 'Claim',
  figure: 'Figure',
};

interface SubunitBlockProps {
  subunit: Subunit;
  commentCount: number;
}

export default function SubunitBlock({ subunit, commentCount }: SubunitBlockProps) {
  const paragraphs = subunit.content.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const label = TYPE_LABEL[subunit.type];
  const anchorId = `subunit-${subunit.id}`;

  return (
    <div className="subunit" id={anchorId}>
      <div className="subunit-head">
        <span className={`subunit-type-chip subunit-type-${subunit.type}`}>{label}</span>
        <a className="subunit-anchor" href={`#${anchorId}`} aria-label={`Permalink to this ${label.toLowerCase()}`}>
          #
        </a>
      </div>
      {subunit.title ? <h4>{subunit.title}</h4> : null}
      <div className="subunit-body">
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => <p key={i}>{p}</p>)
        ) : (
          <p className="muted">No content.</p>
        )}
      </div>
      <footer className="row gap-3 flex-wrap small muted">
        <a href="#comments">
          {commentCount} comment{commentCount === 1 ? '' : 's'}
        </a>
        <span title={`Cite this sub-unit — content hash (sha256): ${subunit.content_hash}`}>
          hash <code>{subunit.content_hash.slice(0, 12)}</code>
        </span>
      </footer>
    </div>
  );
}
