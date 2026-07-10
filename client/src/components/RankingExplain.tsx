// Transparent, non-engagement ranking breakdown (§8.3). Every search result
// carries its score components + the weight constants used, so "why this
// ranking?" is always answerable without trusting a black box.

import type { ScoreComponents } from '@shared/types';

const SIGNAL_LABEL: Record<keyof ScoreComponents, string> = {
  relevance: 'Topical relevance',
  rigor: 'Replication & support rigor',
  review_count: 'Review endorsement',
  recency: 'Recency',
};

const SIGNAL_ORDER: (keyof ScoreComponents)[] = ['relevance', 'rigor', 'review_count', 'recency'];

function fmt(n: number): string {
  return n.toFixed(2);
}

export default function RankingExplain({
  score,
  components,
  weights,
}: {
  score: number;
  components: ScoreComponents;
  weights: ScoreComponents;
}) {
  return (
    <details className="ranking-explain">
      <summary className="ranking-explain-toggle">
        Why this ranking? <span className="ranking-explain-score">{fmt(score)}</span>
      </summary>
      <table className="table ranking-explain-table">
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">Weight</th>
            <th scope="col">Value</th>
            <th scope="col">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {SIGNAL_ORDER.map((key) => {
            const weight = weights[key];
            const value = components[key];
            const contribution = weight * value;
            return (
              <tr key={key}>
                <td>{SIGNAL_LABEL[key]}</td>
                <td>{fmt(weight)}</td>
                <td>{fmt(value)}</td>
                <td>{fmt(contribution)}</td>
              </tr>
            );
          })}
          <tr>
            <td>
              <strong>Total</strong>
            </td>
            <td />
            <td />
            <td>
              <strong>{fmt(score)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  );
}
