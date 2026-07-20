// Graph-native navigation (§8.2). Cytoscape canvas centered on :id, with
// depth/direction/edge-type/AI-inclusion controls and a legend documenting
// the solid = confirmed / dashed = AI-suggested visual language (§4.2).
// Without an :id (route /graph) it renders the field-wide overview instead:
// the most-connected works in the corpus and every edge among them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import cytoscape from 'cytoscape';
import type {
  EdgeType,
  GraphDirection,
  GraphEdge,
  GraphNode,
  GraphResponse,
  SearchResponse,
} from '@shared/types';
import { EDGE_TYPES } from '@shared/types';
import { api, ApiRequestError } from '../api';
import {
  AiBadge,
  EdgeTypeBadge,
  EdgeStatusBadge,
  ConfidencePct,
  KindBadge,
  ResultBadge,
  TierBadge,
} from '../components/Badges';

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
  return title.length > 48 ? `${title.slice(0, 48)}…` : title;
}

// Connected-Papers-style size encoding: diameter grows with the square root of
// the node's corpus-wide connection count, so hubs stand out without dwarfing leaves.
function nodeSize(degree: number): number {
  return Math.min(64, 22 + Math.sqrt(Math.max(0, degree)) * 7);
}

// Degree above which a node keeps its label when zoomed out (top quartile).
// Small graphs keep every label at every zoom level.
function labelThreshold(degrees: number[]): number {
  if (degrees.length <= 25) return -Infinity;
  const sorted = [...degrees].sort((a, b) => b - a);
  return sorted[Math.floor(sorted.length * 0.25)];
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

  // Focus mode (overview only): show just these works + their neighborhood.
  // Lives in the URL so focused views are shareable and survive reloads.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusKey = isOverview ? (searchParams.get('focus') ?? '') : '';
  const focusIds = useMemo(
    () =>
      focusKey
        ? Array.from(
            new Set(focusKey.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)),
          )
        : [],
    [focusKey],
  );
  const rawFocusDepth = Number(searchParams.get('fdepth') ?? '1');
  const focusDepth = Number.isInteger(rawFocusDepth) && rawFocusDepth >= 0 && rawFocusDepth <= 3 ? rawFocusDepth : 1;

  const [focusQuery, setFocusQuery] = useState('');
  const [focusResults, setFocusResults] = useState<Array<{ id: number; title: string; year: number | null }> | null>(
    null,
  );
  // Titles for chips of works not yet present in the fetched graph data.
  const focusTitleCache = useRef(new Map<number, string>());

  const updateFocus = (ids: number[], nextDepth: number) => {
    const next = new URLSearchParams(searchParams);
    if (ids.length > 0) {
      next.set('focus', ids.join(','));
      next.set('fdepth', String(nextDepth));
    } else {
      next.delete('focus');
      next.delete('fdepth');
    }
    setSearchParams(next);
  };
  const addFocus = (workId: number, title: string) => {
    focusTitleCache.current.set(workId, title);
    if (!focusIds.includes(workId)) updateFocus([...focusIds, workId], focusDepth);
    setFocusQuery('');
    setFocusResults(null);
  };
  const removeFocus = (workId: number) => {
    updateFocus(focusIds.filter((f) => f !== workId), focusDepth);
  };

  // Debounced typeahead against /api/search for the focus list.
  useEffect(() => {
    if (!isOverview) return;
    const q = focusQuery.trim();
    if (q.length < 2) {
      setFocusResults(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&limit=8`)
        .then((res) =>
          setFocusResults(
            res.items.map((i) => ({ id: i.work.id, title: i.work.title, year: i.work.publication_year })),
          ),
        )
        .catch(() => setFocusResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [focusQuery, isOverview]);

  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; title: string } | null>(null);

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
    } else if (focusIds.length > 0) {
      params.set('focus', focusIds.join(','));
      params.set('depth', String(focusDepth));
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
        setSelectedNode(null);
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
  }, [id, depth, direction, includeAi, typesKey, focusKey, focusDepth]);

  // Build/destroy the cytoscape instance whenever the fetched data changes.
  useEffect(() => {
    if (!containerRef.current || !data) return;

    // Focused works get the same accent ring as a traversal root.
    const focusSet = new Set(focusIds);
    const nodes = data.nodes.map((n) => ({
      data: {
        id: String(n.id),
        label: truncateTitle(n.title),
        fullTitle: n.title,
        tier: n.tier,
        resultNature: n.result_nature,
        isRoot: n.id === data.root_id || focusSet.has(n.id) ? 'true' : 'false',
        degree: n.degree,
        size: nodeSize(n.degree),
      },
    }));
    const minLabelDegree = labelThreshold(data.nodes.map((n) => n.degree));
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
            'font-size': 12,
            color: COLOR_INK,
            'text-wrap': 'wrap',
            'text-max-width': '120px',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            // Halo behind labels so text stays readable over crossing edges.
            'text-background-color': COLOR_SURFACE,
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-background-shape': 'roundrectangle',
            width: 'data(size)',
            height: 'data(size)',
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
        // Hover focus: dim everything outside the hovered node's neighborhood.
        { selector: '.dimmed', style: { opacity: 0.15 } },
        { selector: 'node.hovered', style: { 'border-width': 3 } },
        { selector: 'edge.hl', style: { width: 3 } },
        {
          selector: 'node.selected-node',
          style: { 'border-width': 4, 'border-color': COLOR_ACCENT },
        },
        {
          selector: 'node.label-hidden',
          style: { 'text-opacity': 0, 'text-background-opacity': 0 },
        },
      ],
      layout: { name: 'cose', animate: false },
    });

    // Zoomed out, only hub labels stay — declutters dense graphs; zooming in reveals the rest.
    const applyLabelVisibility = () => {
      const revealAll = cy.zoom() >= 0.65;
      cy.nodes().forEach((node) => {
        const hide =
          !revealAll && node.data('isRoot') !== 'true' && (node.data('degree') as number) < minLabelDegree;
        node.toggleClass('label-hidden', hide);
      });
    };
    cy.on('zoom', applyLabelVisibility);
    applyLabelVisibility();

    cy.on('tap', 'node', (evt) => {
      const nid = Number(evt.target.id());
      setSelectedNode(data.nodes.find((n) => n.id === nid) ?? null);
      setSelectedEdge(null);
      cy.nodes().removeClass('selected-node');
      evt.target.addClass('selected-node');
    });
    cy.on('dbltap', 'node', (evt) => {
      navigate(`/works/${evt.target.id()}`);
    });
    cy.on('tap', 'edge', (evt) => {
      const edgeId = Number(String(evt.target.id()).slice(1));
      const edge = data.edges.find((e) => e.id === edgeId) ?? null;
      setSelectedEdge(edge);
      setSelectedNode(null);
      cy.nodes().removeClass('selected-node');
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedEdge(null);
        setSelectedNode(null);
        cy.nodes().removeClass('selected-node');
      }
    });

    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const hood = node.closedNeighborhood();
      cy.elements().difference(hood).addClass('dimmed');
      hood.edges().addClass('hl');
      node.addClass('hovered');
      const pos = node.renderedPosition();
      setHoverTip({
        x: pos.x,
        y: pos.y - (node.renderedHeight() as number) / 2 - 8,
        title: node.data('fullTitle') as string,
      });
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    cy.on('mouseout', 'node', (evt) => {
      cy.elements().removeClass('dimmed hl');
      evt.target.removeClass('hovered');
      setHoverTip(null);
      if (containerRef.current) containerRef.current.style.cursor = '';
    });
    cy.on('pan zoom drag', () => setHoverTip(null));

    // Leaving the canvas quickly can skip cytoscape's node mouseout — reset hover state.
    const container = containerRef.current;
    const clearHover = () => {
      cy.elements().removeClass('dimmed hl');
      cy.nodes().removeClass('hovered');
      setHoverTip(null);
      if (container) container.style.cursor = '';
    };
    container.addEventListener('mouseleave', clearHover);

    cyRef.current = cy;
    return () => {
      container.removeEventListener('mouseleave', clearHover);
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, navigate, focusKey]);

  const toggleType = (t: EdgeType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };
  const fitGraph = () => {
    cyRef.current?.fit(undefined, 30);
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
          {focusIds.length > 0
            ? 'Focused view — the papers you picked plus their surrounding connections. Bigger nodes have more connections. Click a node to preview it; double-click to open the work.'
            : 'The whole uploaded corpus at a glance — the most-connected works and every typed edge among them. Bigger nodes have more connections. Click a node to preview it; double-click to open the work.'}
        </p>
      ) : null}

      <div className="flex gap-5 items-start flex-wrap">
        <aside style={{ width: '15rem', flexShrink: 0 }} className="stack gap-4">
          {isOverview ? (
            <fieldset>
              <legend>Focus</legend>
              <div className="field">
                <label htmlFor="focus-search">Add paper</label>
                <input
                  id="focus-search"
                  type="search"
                  placeholder="Search works…"
                  value={focusQuery}
                  onChange={(e) => setFocusQuery(e.target.value)}
                  autoComplete="off"
                />
                {focusResults ? (
                  <ul className="focus-search-results">
                    {focusResults.length === 0 ? (
                      <li className="focus-search-empty muted small">No matches</li>
                    ) : (
                      focusResults.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            className="focus-search-result"
                            disabled={focusIds.includes(r.id)}
                            onClick={() => addFocus(r.id, r.title)}
                          >
                            {r.title}
                            {r.year ? <span className="muted"> ({r.year})</span> : null}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </div>
              {focusIds.length > 0 ? (
                <>
                  <ul className="focus-list">
                    {focusIds.map((fid) => (
                      <li key={fid} className="focus-list-item">
                        <span className="focus-list-title">
                          {nodeTitleById.get(fid) ?? focusTitleCache.current.get(fid) ?? `Work #${fid}`}
                        </span>
                        <button
                          type="button"
                          className="focus-list-remove"
                          aria-label="Remove from focus"
                          title="Remove from focus"
                          onClick={() => removeFocus(fid)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="field">
                    <label htmlFor="focus-depth">Connections</label>
                    <select
                      id="focus-depth"
                      value={focusDepth}
                      onChange={(e) => updateFocus(focusIds, Number(e.target.value))}
                    >
                      <option value={0}>Selected papers only</option>
                      <option value={1}>1 step away</option>
                      <option value={2}>2 steps away</option>
                      <option value={3}>3 steps away</option>
                    </select>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateFocus([], 1)}>
                    Clear focus
                  </button>
                </>
              ) : (
                <p className="field-hint">
                  Search and add papers to see only those works and their connections. Focused papers get a
                  navy ring.
                </p>
              )}
            </fieldset>
          ) : null}
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
              <p className="empty-state-title">
                {isOverview ? (focusIds.length > 0 ? 'No focused works found' : 'No works yet') : 'No connections found'}
              </p>
              <p className="empty-state-body">
                {isOverview
                  ? focusIds.length > 0
                    ? 'None of the focused papers exist anymore — clear the focus list to see the field overview.'
                    : 'Nothing has been uploaded or imported yet — the graph will fill in as works arrive.'
                  : 'This work has no connections matching the current filters.'}
              </p>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
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
              <div className="graph-controls">
                <button type="button" onClick={() => zoomBy(1.3)} aria-label="Zoom in" title="Zoom in">
                  +
                </button>
                <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out" title="Zoom out">
                  −
                </button>
                <button type="button" onClick={fitGraph} aria-label="Fit graph to view" title="Fit to view">
                  ⛶
                </button>
              </div>
              {hoverTip ? (
                <div className="graph-node-tooltip" style={{ left: hoverTip.x, top: hoverTip.y }}>
                  {hoverTip.title}
                </div>
              ) : null}
            </div>
          )}

          {selectedNode ? (
            <div className="graph-node-panel">
              <div className="row gap-2 items-center flex-wrap">
                <KindBadge kind={selectedNode.kind} />
                <TierBadge tier={selectedNode.tier} />
                <ResultBadge nature={selectedNode.result_nature} />
              </div>
              <h3 className="graph-node-panel-title">
                <Link to={`/works/${selectedNode.id}`}>{selectedNode.title}</Link>
              </h3>
              <p className="muted small" style={{ margin: 0 }}>
                {selectedNode.publication_year ? `${selectedNode.publication_year} · ` : ''}
                {selectedNode.degree} connection{selectedNode.degree === 1 ? '' : 's'}
              </p>
              <div className="row gap-2">
                <Link className="btn btn-primary btn-sm" to={`/works/${selectedNode.id}`}>
                  Open work
                </Link>
                {selectedNode.id !== data?.root_id ? (
                  <Link className="btn btn-ghost btn-sm" to={`/works/${selectedNode.id}/graph`}>
                    Center graph here
                  </Link>
                ) : null}
                {isOverview && !focusIds.includes(selectedNode.id) ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => addFocus(selectedNode.id, selectedNode.title)}
                  >
                    Add to focus
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

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
          <p className="field-hint">
            Node size reflects how many connections a work has across the corpus.
          </p>
        </div>
      </div>
    </div>
  );
}
