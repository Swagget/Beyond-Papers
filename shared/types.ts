// Shared types for Beyond Papers — single source of truth for enums and API shapes.
// Server (Node) and client (Vite) both import from here.

// ---------- Enums (string unions; must match server/src/schema.sql CHECK constraints) ----------

export type WorkKind = 'paper' | 'review' | 'replication' | 'concept' | 'dataset' | 'code';

export type ResultNature = 'positive' | 'negative' | 'null' | 'inconclusive' | 'na';

export type EditingMode = 'authored' | 'communal';

export type WorkSource = 'native' | 'openalex' | 'crossref' | 'arxiv' | 'pubmed';

export type License =
  | 'cc-by'
  | 'cc-by-sa'
  | 'cc0'
  | 'public-domain'
  | 'platform-cc-by-sa'
  | 'cc-by-nd'
  | 'arxiv-default'
  | 'cc-by-nc'
  | 'cc-by-nc-sa'
  | 'cc-by-nc-nd'
  | 'closed'
  | 'unknown';

export type Tier = 'A' | 'B' | 'C';

export type SubunitType = 'hypothesis' | 'method' | 'result' | 'dataset' | 'code' | 'claim' | 'figure';

export type EdgeType =
  | 'cites'
  | 'supports'
  | 'refutes'
  | 'replicates'
  | 'fails_to_replicate'
  | 'extends'
  | 'uses_method_of'
  | 'provides_data_for'
  | 'corrects'
  | 'supersedes'
  | 'reviews'
  | 'comments_on';

export const EDGE_TYPES: EdgeType[] = [
  'cites',
  'supports',
  'refutes',
  'replicates',
  'fails_to_replicate',
  'extends',
  'uses_method_of',
  'provides_data_for',
  'corrects',
  'supersedes',
  'reviews',
  'comments_on',
];

export type EdgeOrigin = 'human' | 'ai';

export type EdgeStatus = 'suggested' | 'confirmed' | 'disputed' | 'rejected';

export type AiFeature = 'summary' | 'glossary' | 'explainer';

export type AiOutputStatus = 'active' | 'flagged' | 'removed';

export type FlagTargetType = 'ai_output' | 'edge';

export type FlagStatus = 'open' | 'upheld' | 'dismissed';

/** CRediT contributor-role taxonomy (§6.2), kebab-case slugs. */
export type CreditRole =
  | 'conceptualization'
  | 'data-curation'
  | 'formal-analysis'
  | 'funding-acquisition'
  | 'investigation'
  | 'methodology'
  | 'project-administration'
  | 'resources'
  | 'software'
  | 'supervision'
  | 'validation'
  | 'visualization'
  | 'writing-original-draft'
  | 'writing-review-editing';

export const CREDIT_ROLES: CreditRole[] = [
  'conceptualization',
  'data-curation',
  'formal-analysis',
  'funding-acquisition',
  'investigation',
  'methodology',
  'project-administration',
  'resources',
  'software',
  'supervision',
  'validation',
  'visualization',
  'writing-original-draft',
  'writing-review-editing',
];

// ---------- License → tier mapping (must match server/src/lib/license.ts) ----------

export const TIER_C_LICENSES: License[] = ['cc-by', 'cc-by-sa', 'cc0', 'public-domain', 'platform-cc-by-sa'];
export const TIER_B_LICENSES: License[] = ['cc-by-nd'];

export function licenseToTier(license: License): Tier {
  if (TIER_C_LICENSES.includes(license)) return 'C';
  if (TIER_B_LICENSES.includes(license)) return 'B';
  return 'A';
}

// ---------- Content model ----------

export interface Section {
  heading: string;
  /** Plain text / lightweight markdown body. */
  body: string;
}

export interface Reference {
  /** Free-text citation string. */
  text: string;
  doi?: string | null;
  /** Local work id if the reference resolves to a work in the graph. */
  work_id?: number | null;
}

/** The canonical, hashed content of a work version (§1.3). */
export interface VersionContent {
  title: string;
  abstract: string;
  sections: Section[];
  references: Reference[];
}

// ---------- Entities (as returned by the API) ----------

export interface User {
  id: number;
  username: string;
  display_name: string;
  is_pseudonym: boolean;
  orcid: string | null;
  bio: string | null;
  created_at: string;
}

export interface Author {
  id: number;
  name: string;
  orcid: string | null;
  openalex_author_id: string | null;
  user_id: number | null;
}

export interface Authorship {
  author: Author;
  position: number;
  credit_roles: CreditRole[];
}

export interface Work {
  id: number;
  kind: WorkKind;
  result_nature: ResultNature;
  editing: EditingMode;
  title: string;
  abstract: string | null;
  doi: string | null;
  arxiv_id: string | null;
  openalex_id: string | null;
  source: WorkSource;
  license: License;
  tier: Tier;
  current_version_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkVersion {
  id: number;
  work_id: number;
  version_number: number;
  content: VersionContent;
  content_hash: string;
  license: License;
  tier: Tier;
  change_note: string | null;
  created_by: number | null;
  created_at: string;
}

export interface Subunit {
  id: number;
  work_id: number;
  version_id: number;
  type: SubunitType;
  title: string;
  content: string;
  content_hash: string;
  order_index: number;
  created_by: number | null;
  created_at: string;
}

export interface Edge {
  id: number;
  source_work_id: number;
  target_work_id: number;
  source_subunit_id: number | null;
  target_subunit_id: number | null;
  type: EdgeType;
  origin: EdgeOrigin;
  asserted_by_user: number | null;
  asserted_by_name?: string | null;
  model: string | null;
  model_version: string | null;
  confidence: number | null;
  basis: string | null;
  status: EdgeStatus;
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: string;
  /** Vote tally for contested edges (§2.4). */
  vote_score?: number;
  /** Convenience: titles for rendering. */
  source_title?: string;
  target_title?: string;
}

export interface EdgeVote {
  edge_id: number;
  user_id: number;
  vote: 1 | -1;
  comment: string | null;
  created_at: string;
}

export interface Comment {
  id: number;
  work_id: number;
  subunit_id: number | null;
  parent_id: number | null;
  author_user_id: number;
  author_name?: string;
  body: string;
  created_at: string;
}

export interface AiOutput {
  id: number;
  work_id: number;
  feature: AiFeature;
  content: string;
  model: string;
  model_version: string;
  status: AiOutputStatus;
  edited_by: number | null;
  supersedes_id: number | null;
  created_at: string;
}

export interface Flag {
  id: number;
  target_type: FlagTargetType;
  target_id: number;
  reporter_user_id: number;
  reason: string;
  status: FlagStatus;
  resolved_by: number | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

/** Per-feature AI accuracy track record (§4.5). */
export interface AiTrackRecord {
  feature: AiFeature | 'edge_suggestion';
  total: number;
  flagged: number;
  upheld: number;
  dismissed: number;
  open: number;
}

// ---------- Search & ranking (§8.3 transparent) ----------

export interface RankingBreakdown {
  relevance: number;
  rigor: number;
  review_activity: number;
  recency: number;
  total: number;
}

export interface SearchResult {
  work: Work;
  score: RankingBreakdown;
  snippet?: string;
}

// ---------- Graph API ----------

export interface GraphNode {
  id: number;
  title: string;
  kind: WorkKind;
  result_nature: ResultNature;
  tier: Tier;
  year?: number | null;
}

export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  type: EdgeType;
  origin: EdgeOrigin;
  status: EdgeStatus;
  confidence: number | null;
}

export interface GraphResponse {
  center: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------- API error shape ----------

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
