// Graph-native navigation (§8.2). Cytoscape canvas centered on :id, with
// depth/direction/edge-type/AI-inclusion controls and a legend documenting
// the solid = confirmed / dashed = AI-suggested visual language (§4.2).
// Without an :id (route /graph) it renders the field-wide overview instead:
// the most-connected works in the corpus and every edge among them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import cytoscape from 'cytoscape';
import type { EdgeType, GraphDirection, GraphEdge, GraphResponse } from '@shared/types';
import { EDGE_TYPES } from '@shared/types';
import { api, ApiRequestError } from '../api';
import { AiBadge, EdgeTypeBadge, EdgeStatusBadge, ConfidencePct } from '../components/Badges';

// Hard-coded from client/src/styles/tokens.css — cytoscape cannot read CSS
// custom properties, so these hex values must be kept in sync by hand.
const EDGE_COLOR_HEX: Record<EdgeType, string> = {
  cites: '#726c5c',
  supports: '#2f7d4f',
  refutes: '#ac432e',
  replicates: '#1f8a78',
  fails_to_replicate: '#8a3624',
  extends: '#3d76b0',
  uses_method_of: '#2a8f9e',
  provides_data_for: '#1c7686',
  corrects: '#b8721f',
  supersedes: '#97590f',
  reviews: '#756f89',
  comments_on: '#5c6672',
};

const TIER_BORDER_HEX: Record<string, string> = {
  A: '#726c5c', // --color-tier-a
  B: '#a6740a', // --color-tier-b
  C: '#2f7d4f', // --color-tier-c
};

const COLOR_SURFACE = '#ffffff'; // --color-surface (paper white)
const COLOR_RESULT_NEUTRAL_BG = '#e9eff5'; // --color-result-neutral-bg (slate-blue tint)
const COLOR_INK = '#201e19'; // --color-ink
const COLOR_ACCENT = '#2b4d78'; // --color-accent (root node ring)
const COLOR_AI = '#6d3fc4'; // --color-ai
const COLOR_AI_BORDER = '#9a6fdb'; // --color-ai-border
const COLOR_BORDER_STRONG = '#c9c1a9'; // --color-border-strong (default edge fallback)

function truncateTitle(title: string): string {
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

export default function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const isOverview = !id;
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const [depth, setDepth] = useState<1 | 2 | 3>(2);
  const [direction, setDirection] = useState<GraphDirection>('both');
  const [selectedTypes, setSelectedTypes] = useState<Set<EdgeType>>(new Set(EDGE_TYPES));
  const [includeAi, setIncludeAi] = useState(false);

  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  const typesKey = useMemo(() => Array.from(selectedTypes).sort().join(','), [selectedTypes]);

  useEffect(() => {
    if (selectedTypes.size === 0) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (!isOverview) {
      params.set('depth', String(depth));
      params.set('direction', direction);
    }
    params.set('include_ai', String(includeAi));
    if (selectedTypes.size < EDGE_TYPES.length) {
      params.set('types', typesKey);
    }
    api
      .get<GraphResponse>(`/api/graph${isOverview ? '' : `/${id}`}?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setSelectedEdge(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(err instanceof ApiRequestError ? err.message : 'Failed to load graph.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, depth, direction, includeAi, typesKey]);

  // Build/destroy the cytoscape instance whenever the fetched data changes.
  useEffect(() => {
    if (!containerRef.current || !data) return;

    const nodes = data.nodes.map((n) => ({
      data: {
        id: String(n.id),
        label: truncateTitle(n.title),
        tier: n.tier,
        resultNature: n.result_nature,
        isRoot: n.id === data.root_id ? 'true' : 'false',
      },
    }));
    const edges = data.edges.map((e) => ({
      data: {
        id: `e${e.id}`,
        source: String(e.source_work_id),
        target: String(e.target_work_id),
        type: e.type,
        isAiSuggested: e.origin === 'ai' && e.status === 'suggested' ? 'true' : 'false',
      },
    }));

    const typeSelectors = EDGE_TYPES.map((t) => ({
      selector: `edge[type = "${t}"]`,
      style: { 'line-color': EDGE_COLOR_HEX[t], 'target-arrow-color': EDGE_COLOR_HEX[t] },
    }));

    const cy = cytoscape({
      container: containerRef.current,
      elements: { nodes, edges },
      style: [
        {
          selector: 'node',
          style: {
            'background-color': COLOR_SURFACE,
            'border-width': 2,
            'border-color': COLOR_BORDER_STRONG,
            label: 'data(label)',
            'font-size': 11,
            color: COLOR_INK,
            'text-wrap': 'wrap',
            'text-max-width': '100px',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            width: 28,
            height: 28,
          },
        },
        { selector: 'node[tier = "A"]', style: { 'border-color': TIER_BORDER_HEX.A } },
        { selector: 'node[tier = "B"]', style: { 'border-color': TIER_BORDER_HEX.B } },
        { selector: 'node[tier = "C"]', style: { 'border-color': TIER_BORDER_HEX.C } },
        {
          selector:
            'node[resultNature = "negative"], node[resultNature = "null"], node[resultNature = "inconclusive"]',
          style: { 'background-color': COLOR_RESULT_NEUTRAL_BG },
        },
        {
          selector: 'node[isRoot = "true"]',
          style: { 'border-width': 4, 'border-color': COLOR_ACCENT },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 1,
            'line-color': COLOR_BORDER_STRONG,
            'target-arrow-color': COLOR_BORDER_STRONG,
          },
        },
        ...typeSelectors,
        {
          // AI-suggested edges always render dashed + violet, regardless of type (§4.2).
          selector: 'edge[isAiSuggested = "true"]',
          style: {
            'line-style': 'dashed',
            'line-color': COLOR_AI,
            'target-arrow-color': COLOR_AI_BORDER,
          },
        },
      ],
      layout: { name: 'cose', animate: false },
    });

    cy.on('tap', 'node', (evt) => {
      navigate(`/works/${evt.target.id()}`);
    });
    cy.on('tap', 'edge', (evt) => {
      const edgeId = Number(String(evt.target.id()).slice(1));
      const edge = data.edges.find((e) => e.id === edgeId) ?? null;
      setSelectedEdge(edge);
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelectedEdge(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data, navigate]);

  const toggleType = (t: EdgeType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const rootNode = data?.nodes.find((n) => n.id === data.root_id) ?? null;
  const nodeTitleById = useMemo(() => {
    const map = new Map<number, string>();
    data?.nodes.forEach((n) => map.set(n.id, n.title));
    return map;
  }, [data]);

  return (
    <div className="stack gap-5">
      <h1>{isOverview ? 'Field graph' : rootNode ? `Graph: ${rootNode.title}` : 'Work graph'}</h1>
      {isOverview ? (
        <p className="muted">
          The whole uploaded corpus at a glance — the most-connected works and every typed edge among them.
          Click a node to open the work.
        </p>
      ) : null}

      <div className="flex gap-5 items-start flex-wrap">
        <aside style={{ width: '15rem', flexShrink: 0 }} className="stack gap-4">
          <fieldset>
            <legend>{isOverview ? 'Filters' : 'Traversal'}</legend>
            {isOverview ? null : (
            <>
            <div className="field">
              <label htmlFor="graph-depth">Depth</label>
              <select
                id="graph-depth"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value) as 1 | 2 | 3)}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="graph-direction">Direction</label>
              <select
                id="graph-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as GraphDirection)}
              >
                <option value="both">Both</option>
                <option value="ancestors">Ancestors</option>
                <option value="descendants">Descendants</option>
              </select>
            </div>
            </>
            )}
            <div className="field">
              <span id="graph-edge-types-label">Edge types</span>
              <div className="stack gap-1" role="group" aria-labelledby="graph-edge-types-label">
                {EDGE_TYPES.map((t) => (
                  <label key={t} className="row gap-2 small">
                    <input
                      type="checkbox"
                      checked={selectedTypes.has(t)}
                      onChange={() => toggleType(t)}
                    />
                    {t.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="row gap-2">
                <input
                  type="checkbox"
                  checked={includeAi}
                  onChange={(e) => setIncludeAi(e.target.checked)}
                />
                <span className="row gap-1 items-center">
                  Show <AiBadge label="AI-suggested (unconfirmed)" />
                </span>
              </label>
              <p className="field-hint">
                Off by default — authoritative traversal excludes unconfirmed AI suggestions (§4.2).
              </p>
            </div>
          </fieldset>
        </aside>

        <div className="stack gap-3" style={{ flex: '1 1 32rem', minWidth: 0 }}>
          {data?.truncated ? (
            <div className="toast toast-warning" role="status" style={{ position: 'static' }}>
              <span className="toast-message">
                This graph was truncated at the node/edge cap — not every connection is shown.
              </span>
            </div>
          ) : null}

          {loading ? (
            <div className="stack gap-2">
              <div className="skeleton" style={{ height: '70vh', width: '100%' }} />
            </div>
          ) : error ? (
            <div className="empty-state">
              <p className="empty-state-title">Couldn't load graph</p>
              <p className="empty-state-body">{error}</p>
            </div>
          ) : selectedTypes.size === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No edge types selected</p>
              <p className="empty-state-body">Select at least one edge type to see connections.</p>
            </div>
          ) : data && data.nodes.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">{isOverview ? 'No works yet' : 'No connections found'}</p>
              <p className="empty-state-body">
                {isOverview
                  ? 'Nothing has been uploaded or imported yet — the graph will fill in as works arrive.'
                  : 'This work has no connections matching the current filters.'}
              </p>
            </div>
          ) : (
            <div
              ref={containerRef}
              role="img"
              aria-label="Graph visualization of this work's connections"
              style={{
                width: '100%',
                height: '70vh',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
              }}
            />
          )}

          {selectedEdge ? (
            <div className="edge-item edge-item-human" style={{ borderLeftStyle: 'solid' }}>
              <div className="edge-item-main">
                <EdgeTypeBadge type={selectedEdge.type} />
                {selectedEdge.origin === 'ai' ? <AiBadge /> : null}
                <EdgeStatusBadge status={selectedEdge.status} />
                <ConfidencePct confidence={selectedEdge.confidence} />
              </div>
              <div className="edge-item-meta">
                <Link to={`/works/${selectedEdge.source_work_id}`}>
                  {nodeTitleById.get(selectedEdge.source_work_id) ?? `Work #${selectedEdge.source_work_id}`}
                </Link>
                <span>→</span>
                <Link to={`/works/${selectedEdge.target_work_id}`}>
                  {nodeTitleById.get(selectedEdge.target_work_id) ?? `Work #${selectedEdge.target_work_id}`}
                </Link>
              </div>
            </div>
          ) : null}
        </div>

        <div className="graph-legend" style={{ width: '15rem', flexShrink: 0 }}>
          <h4 className="graph-legend-title">Legend</h4>
          <ul className="graph-legend-list">
            {EDGE_TYPES.map((t) => (
              <li key={t} className="graph-legend-item">
                <span className={`graph-legend-swatch graph-legend-swatch-solid edge-${t}`} />
                {t.replace(/_/g, ' ')}
              </li>
            ))}
            <li className="graph-legend-item graph-legend-item-ai">
              <span className="graph-legend-swatch graph-legend-swatch-dashed" />
              AI-suggested, unconfirmed
            </li>
          </ul>
          <p className="field-hint">
            Solid = human-verified / confirmed. Dashed = <AiBadge label="AI-suggested" />, unconfirmed.
          </p>
        </div>
      </div>
    </div>
  );
}
