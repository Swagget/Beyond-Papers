import { Link } from 'react-router-dom';
import { TierBadge, EdgeTypeBadge, ResultBadge, AiBadge } from '../components/Badges';
import type { EdgeType, Tier } from '@shared/types';

export default function AboutPage() {
  const allEdgeTypes: EdgeType[] = [
    'cites', 'supports', 'refutes', 'replicates', 'fails_to_replicate',
    'extends', 'uses_method_of', 'provides_data_for', 'corrects', 'supersedes',
    'reviews', 'comments_on',
  ];

  return (
    <div className="container article-body">
      <h1>About Beyond Papers</h1>

      <h2>What is Beyond Papers?</h2>
      <p>
        Beyond Papers is a living, community-built graph of research. Each work—paper, review, dataset,
        replication, or negative result—is a node in this graph, rendered and citable exactly like a
        conventional research paper. No career penalty for using the platform (§1.1, §11.1): you export
        cleanly to LaTeX, PDF, or standard citation formats, so the platform augments your existing
        publishing workflow rather than replacing it.
      </p>

      <p>
        Unlike a flat citation network, our graph encodes <em>typed connections</em> between works.
        Instead of generic "cites," you can assert that one paper <em>supports</em>, <em>refutes</em>,
        <em>replicates</em>, or <em>extends</em> another—and these connections themselves are
        creditable, versioned nodes subject to open peer review.
      </p>

      <p>
        Negative and null results are first-class citizens. They appear alongside positive findings
        with equal weight and the same citation status—because rigorous science depends on knowing
        what didn't work, not suppressing it.
      </p>

      <h3>Typed connections: the 12 edge types</h3>
      <p>Every connection between works uses one of these controlled vocabulary types:</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
        {allEdgeTypes.map((type) => (
          <EdgeTypeBadge key={type} type={type} />
        ))}
      </div>

      <p style={{ marginTop: '1rem' }}>
        Each edge is directed (source → target), timestamped, attributed to a person or AI system,
        and can be <em>confirmed</em> (human-verified), <em>suggested</em> (waiting for human review),
        or <em>disputed</em> (contested and under discussion). This typed, attributed structure is what
        allows you to navigate by "what refutes this" or "what data does this use" instead of just
        linearly reading citations.
      </p>

      <h3>Negative, null, and inconclusive results</h3>
      <p>
        In conventional publication, negative results are quietly filed away or never submitted. Beyond
        Papers surfaces them as core research artifacts. A node may be marked:
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <ResultBadge nature="negative" />
        <ResultBadge nature="null" />
        <ResultBadge nature="inconclusive" />
      </div>
      <p style={{ marginTop: '1rem' }}>
        These badges appear alongside the work's tier and edge information—no visual demotion, no
        separate "failures" section. A negative result is still a result worth citing and building on.
      </p>

      <h2>How the graph is populated: three-tier license-driven ingestion</h2>
      <p>
        Whether a work can be added and how it can be used depends entirely on its license. We never
        gate on venue or access status—an arXiv paper with an unfriendly default license appears only
        as metadata; a preprint under CC-BY flows into the full transformable tier. Here's how it works:
      </p>

      <h3>Tier A: Universal metadata and links</h3>
      <div style={{ marginTop: '0.5rem' }}>
        <TierBadge tier="A" />
      </div>
      <p>
        Any work—open or closed, on arXiv or in a paywalled journal—can contribute title, authors,
        abstract, citation links, and DOI to the graph. This is legally clean for all works and gives
        the platform universal coverage from day one. Tier A works show up in searches and can be
        referenced, but their full content is never stored or AI-processed.
      </p>

      <h3>Tier B: Host whole, unchanged</h3>
      <div style={{ marginTop: '0.5rem' }}>
        <TierBadge tier="B" />
      </div>
      <p>
        Works under <code>CC-BY-ND</code> (Creative Commons Attribution, No Derivatives) are hosted
        in full and unmodified on the platform. You can read them here, cite them, and download them,
        but no one—including the platform—may split them into sub-units or feed them to AI for
        transformation. They are preserved as-is.
      </p>

      <h3>Tier C: Full rich node, transformable</h3>
      <div style={{ marginTop: '0.5rem' }}>
        <TierBadge tier="C" />
      </div>
      <p>
        Works under <code>CC-BY</code>, <code>CC-BY-SA</code>, <code>CC0</code>, public domain, or
        directly authored by contributors are fully open. They can be:
      </p>
      <ul>
        <li>Decomposed into sub-units (hypotheses, methods, results, datasets, code blocks, claims, figures)</li>
        <li>Processed by the platform's AI layer for summaries, glossaries, and clarifications</li>
        <li>Combined with other open sources for platform-generated outputs</li>
      </ul>

      <p>
        Note: <code>CC-BY-NC</code> (NonCommercial) works are excluded from hosting and transformation
        because their NC clause is incompatible with the platform's own <code>CC-BY-SA 4.0</code> license
        on generated content. This is a deliberate simplification to keep output licensing clean; we
        revisit it as the platform matures.
      </p>

      <p>
        <strong>The license is the gate for every feature.</strong> Sub-unit decomposition and AI
        transformation are not available for Tier A/B. When you import a work, the platform reads
        its stated license, computes the tier server-side, and enforces that tier on all future
        operations. You never bypass this boundary.
      </p>

      <h2>The AI layer, bounded and labeled</h2>
      <p>
        The platform includes AI assistance, but <em>AI suggests; humans decide.</em> Every AI output
        is clearly marked (§4.2 of our architecture), flaggable by readers, and excluded from
        authoritative counts until a human confirms it.
      </p>

      <h3>What AI can do</h3>
      <ul>
        <li>
          <strong>Suggest typed edges:</strong> Given two works, an AI model proposes that one
          "supports" or "refutes" another, with a confidence score. These suggestions show up as{' '}
          <AiBadge /> and are kept visually separate (dashed borders) from human-verified edges (solid borders). They are never included in counts like "N connections" until confirmed.
        </li>
        <li>
          <strong>Summarize and clarify:</strong> For Tier C works, AI can generate plain-language
          summaries, term glossaries, and "explain this to me" answers for sub-units. Tier A/B works
          only get AI assistance on metadata and abstracts, never full text.
        </li>
        <li>
          <strong>Be edited:</strong> AI output is editable by humans, with changes tracked and
          attributed.
        </li>
      </ul>

      <h3>How AI is held accountable</h3>
      <p>
        Every AI-generated surface carries a <AiBadge /> badge or the full AI-panel treatment with
        model/version provenance. Readers can flag AI output as inaccurate, and these flags feed a
        public accuracy track record (see <Link to="/ai/track-record">AI track record</Link>), so over
        time, poor-performing models get less weight. AI content is never cited as authoritative by
        default; if cited, it is marked as machine-generated with provenance.
      </p>

      <p>
        AI edges are created <em>non-authoritative</em> by default and must pass the human promotion
        path (§4.2) to become part of the confirmed graph. Until confirmed, they are a separate,
        visible class of assertion.
      </p>

      <h2>Open contribution: low friction, reviewed afterward</h2>
      <p>
        There is no submission gate. Anyone can propose a new work, connection, sub-unit, comment,
        correction, or replication without permission. The barrier to entry is minimal; quality is
        controlled by open, ongoing review afterward—not a wall at the door (§12.1, §12.2).
      </p>

      <p>
        Contributions split into two modes: <em>authored</em> (your paper, your review, your dataset)
        can only be edited by you or delegated authors; <em>communal</em> (glossary terms, concept
        nodes, collaborative summaries) are openly editable like a wiki. Both modes preserve version
        history and attribution, so nothing disappears and no one can silently overwrite your work.
      </p>

      <h2>Our beachhead: ML and CS research</h2>
      <p>
        We launched for the machine-learning and computer-science communities because the norms were
        already there: arXiv preprints, GitHub repositories, open-review venues, and a culture of
        rapid iteration. This is where the platform's workflow feels most natural—no asking
        researchers to change careers, just tools that match how they already work.
      </p>

      <p>
        Beyond Papers is additive to existing publishing. Use it to gain visibility, connect your
        ideas to related work, invite reviews, and build credit—while your paper is still submitted to
        venues, on arXiv, wherever you would publish anyway. The platform is a supplement that makes
        research discovery and collaboration richer, not a replacement for anything you currently do.
      </p>
    </div>
  );
}
