import { Link } from 'react-router-dom';
import { TierBadge } from '../components/Badges';

export default function GovernancePage() {
  return (
    <div className="container article-body">
      <h1>Governance & Legal</h1>

      <h2>Nonprofit, community-governed foundation</h2>
      <p>
        Beyond Papers is structured as a nonprofit foundation (following the Wikimedia and arXiv
        models). The foundation hosts and maintains the infrastructure, but <em>does not control the
        research content</em>, which is governed by the community.
      </p>

      <p>There are no ads. No corporate owner. No selling of user data. No single entity's commercial
        interests override the platform's mission.</p>

      <p>
        The platform is built on the <strong>Principles of Open Scholarly Infrastructure (POSI)</strong>,
        which commit us to:
      </p>
      <ul>
        <li>
          <strong>Open source code:</strong> The server and client code is publicly available under an
          OSI-approved license (currently AGPL-3.0), so anyone can audit, fork, or run their own
          instance.
        </li>
        <li>
          <strong>Open data:</strong> The research graph—all works, edges, reviews, sub-units—is
          exported and available in open, interoperable formats. You own your contribution.
        </li>
        <li>
          <strong>Portability:</strong> You can export your work and the graph relationships at any
          time in standard formats (JSON, BibTeX, RIS), so you are never locked in. If the platform
          closes, your research is portable to another system or your own archive.
        </li>
        <li>
          <strong>Community governance:</strong> Major decisions—what licenses we support, how AI is
          used, what features to build—are made transparently with input from researchers, not by a
          closed board.
        </li>
      </ul>

      <h2>Funding: five layers, none gate research</h2>
      <p>
        Research access and the graph itself are <em>never</em> paywalled, regardless of funding source.
        The platform is funded through multiple, complementary channels designed so no single source
        dominates:
      </p>

      <h3>Community donations + supporter status</h3>
      <p>
        Small, recurring gifts from researchers and supporters (following Wikimedia's model, with an
        average around $11 per donation). Supporters can opt into optional recognition, cosmetic badges,
        and power-user conveniences like higher API rate limits or priority support—but <em>never access
        to research</em>, which remains free for all.
      </p>

      <h3>Institutional membership</h3>
      <p>
        Universities, libraries, research institutions, and labs contribute annually (following arXiv's
        model). This is the most stable revenue base for shared scholarly infrastructure because it aligns
        with institutions' interest in their research being discoverable and connected.
      </p>

      <h3>Grants and philanthropy</h3>
      <p>
        Foundation funding for the build and early growth phases. This is necessary but not sufficient
        alone—it is a capital source, not an operating model. We target foundations focused on open
        science infrastructure and research transparency.
      </p>

      <h3>Endowment</h3>
      <p>
        A permanent fund for long-term security and independence (following Wikimedia's perpetuity
        model). This ensures the platform survives downturns and remains independent of any particular
        grant cycle or donor.
      </p>

      <h3>Value-added commercial services</h3>
      <p>
        High-volume, high-reliability API and bulk data access for commercial reusers (search engines,
        AI firms training on research data, analytics companies). <em>Revenue from services, not from
        research itself.</em> Heavy commercial users subsidize free access for everyone else. This aligns
        incentives: we want to make the platform more useful (better API, better data quality), which
        makes it more valuable to commercial partners, which funds the nonprofit.
      </p>

      <p>
        Note: Commercial services currently exclude <TierBadge tier="A" /> and{' '}
        <TierBadge tier="B" /> content with NC (NonCommercial) or ND (No Derivatives) restrictions,
        to respect license terms. This is subject to future legal review.
      </p>

      <h2>Data portability and no lock-in</h2>
      <p>
        You own your work. At any time, you can export:
      </p>
      <ul>
        <li>
          <strong>Your authored works:</strong> In LaTeX, PDF, standard JSON metadata (Crossref schema),
          or BibTeX. These are the formats journals accept, so you can move your work anywhere.
        </li>
        <li>
          <strong>The graph relationships:</strong> All edges involving your work (who cites you, who
          refutes you, what replicates what), exported as RDF, JSON-LD, or CSVs you can load into
          another platform or archive.
        </li>
        <li>
          <strong>Your profile and contributions:</strong> All reviews you wrote, sub-units you
          contributed, comments you made, with cryptographic hashes so you can prove these came from
          you, even outside this platform.
        </li>
      </ul>

      <p>
        The corpus itself (all works, all edges) is released under open licenses <TierBadge tier="C" />{' '}
        works remain under their original licenses; <TierBadge tier="A" /> / <TierBadge tier="B" />{' '}
        metadata is released under <code>CC0</code> (public domain equivalent). Platform-generated
        derivatives (AI summaries, sub-unit decompositions) are <code>CC-BY-SA 4.0</code>, so they
        flow freely into downstream tools and datasets.
      </p>

      <p>
        <strong>No vendor lock-in.</strong> If you want to host a mirror, fork the code, or migrate
        to another system that reads the same formats, you can. The open data export and open source
        code ensure portability.
      </p>

      <h2>Legal compliance</h2>

      <h3>Copyright and licensing</h3>
      <p>
        Every work and every version is tagged with its license. The platform enforces license terms:
      </p>
      <ul>
        <li>
          Tier A (metadata-only, universal) includes works under any license or even proprietary
          agreements.
        </li>
        <li>Tier B (full hosting, no transformation) requires CC-BY-ND or equivalent.</li>
        <li>
          Tier C (full hosting, subunits, AI transformation) requires CC-BY, CC-BY-SA, CC0, public
          domain, or author contribution.
        </li>
      </ul>

      <p>
        Platform-generated outputs are published under <code>CC-BY-SA 4.0</code> specifically (version
        4.0 for one-way compatibility with GPLv3 and cleanest multi-license blending). Whenever the
        platform combines sources into a single output (e.g., an AI summary pulling from multiple
        cited works), it checks that all sources are compatible and only outputs if they are.
      </p>

      <h3>Data protection and privacy</h3>
      <p>
        User accounts, profile data, and private contributions are protected under applicable data
        protection law (GDPR in EU, CCPA/CPRA in California, etc.). You can request a copy of your
        personal data, and you can request deletion (though public contributions may remain in
        historical archives, with your name removed if you choose).
      </p>

      <p>
        The platform does not sell data to third parties. Usage analytics and aggregate statistics
        (e.g., "researchers in field X cite field Y" trends) may be published to help understand the
        research landscape, but never with personally-identifying information.
      </p>

      <h3>AI-generated content</h3>
      <p>
        AI-generated summaries, glossaries, and edge suggestions are published with their model/version
        provenance so readers know what model created them. If you flag AI output as inaccurate, your
        flag is logged and contributes to the model's public accuracy track record. AI content is
        never presented as authoritative without human confirmation.
      </p>

      <p>
        <strong>This is not legal advice.</strong> We have obtained counsel on copyright, licensing
        (especially CC-BY-SA multi-version blending), and data protection. Before large-scale content
        ingestion or commercial service launch, we obtain updated legal review to ensure compliance
        with current law and best practices.
      </p>

      <h2>Transparency and accountability</h2>
      <p>
        The platform publishes its decisions and policies:
      </p>
      <ul>
        <li>
          <strong>Content moderation log:</strong> Decisions to remove or downweight content (spam,
          fabrication, plagiarism, abuse) are logged with reasoning and attributed to the moderator.
        </li>
        <li>
          <strong><Link to="/ai/track-record">AI accuracy track record</Link>:</strong> Every flagged
          AI output and its resolution (upheld, dismissed, corrected) is public, so you can see which
          models and which features are trustworthy.
        </li>
        <li>
          <strong>API and infrastructure status:</strong> Uptime, performance, and planned maintenance
          are published so users can plan.
        </li>
      </ul>

      <p>
        The governance of the platform—bylaws, board composition, community input process—is documented
        and available. We do not hide how decisions are made.
      </p>
    </div>
  );
}
