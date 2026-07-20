// Shared types for Beyond Papers — single source of truth for enums and API shapes.
// Server (Node) and client (Vite) both import from here. Mirrors docs/ARCHITECTURE.md §4.

// ---------- Enums ----------

export type WorkKind = 'paper' | 'review' | 'replication' | 'concept' | 'dataset' | 'code';
export type ResultNature = 'positive' | 'negative' | 'null' | 'inconclusive' | 'na';
export type EditingMode = 'authored' | 'communal';
export type WorkSource = 'native' | 'openalex' | 'crossref' | 'arxiv' | 'pubmed';

export type LicenseId =
  | 'cc-by' | 'cc-by-sa' | 'cc0' | 'public-domain' | 'platform-cc-by-sa'   // Tier C
  | 'cc-by-nd'                                                              // Tier B
  | 'arxiv-default' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nc-nd' | 'closed' | 'unknown'; // Tier A

export type Tier = 'A' | 'B' | 'C';

export type SubunitType = 'hypothesis' | 'method' | 'result' | 'dataset' | 'code' | 'claim' | 'figure';

export const SUBUNIT_TYPES: SubunitType[] = ['hypothesis', 'method', 'result', 'dataset', 'code', 'claim', 'figure'];

// Standard CRediT taxonomy (https://credit.niso.org/) — exact 14 slugs, no others accepted.
export type CreditRole =
  | 'conceptualization' | 'data_curation' | 'formal_analysis' | 'funding_acquisition'
  | 'investigation' | 'methodology' | 'project_administration' | 'resources'
  | 'software' | 'supervision' | 'validation' | 'visualization'
  | 'writing_original_draft' | 'writing_review_editing';

export const CREDIT_ROLES: CreditRole[] = [
  'conceptualization', 'data_curation', 'formal_analysis', 'funding_acquisition',
  'investigation', 'methodology', 'project_administration', 'resources',
  'software', 'supervision', 'validation', 'visualization',
  'writing_original_draft', 'writing_review_editing',
];

export type EdgeType =
  | 'cites' | 'supports' | 'refutes' | 'replicates' | 'fails_to_replicate'
  | 'extends' | 'uses_method_of' | 'provides_data_for' | 'corrects' | 'supersedes'
  | 'reviews' | 'comments_on';

export const EDGE_TYPES: EdgeType[] = [
  'cites', 'supports', 'refutes', 'replicates', 'fails_to_replicate',
  'extends', 'uses_method_of', 'provides_data_for', 'corrects', 'supersedes',
  'reviews', 'comments_on',
];

export type EdgeOrigin = 'human' | 'ai';
export type EdgeStatus = 'suggested' | 'confirmed' | 'disputed' | 'rejected';

export type AiFeature = 'summary' | 'glossary' | 'explainer';
export type AiOutputStatus = 'active' | 'flagged' | 'removed';

export type FlagTargetType = 'ai_output' | 'edge';
export type FlagStatus = 'open' | 'upheld' | 'dismissed';

export type GraphDirection = 'ancestors' | 'descendants' | 'both';

export type ChatPlatform = 'claude' | 'chatgpt' | 'gemini' | 'other';
export const CHAT_PLATFORMS: ChatPlatform[] = ['claude', 'chatgpt', 'gemini', 'other'];
export type ChatStatus = 'pending' | 'verified';
export type ChatLinkStatus = 'suggested' | 'confirmed' | 'rejected';

export type AiProviderName = 'anthropic' | 'heuristic';

// Per-user bring-your-own AI credential. The key itself is never sent to the client;
// only this status view is. `status` reflects the last live validation against the provider.
export type AiCredentialProvider = 'anthropic';
export type AiCredentialState = 'valid' | 'invalid' | 'unvalidated';
export interface AiCredentialStatus {
  provider: AiCredentialProvider;
  present: boolean;
  last4: string | null;
  status: AiCredentialState;
  validated_at: string | null;
}

// ---------- License → tier mapping (must match server/src/lib/license.ts) ----------

export function licenseToTier(license: LicenseId): Tier {
  switch (license) {
    case 'cc-by': case 'cc-by-sa': case 'cc0': case 'public-domain': case 'platform-cc-by-sa':
      return 'C';
    case 'cc-by-nd':
      return 'B';
    default: // arxiv-default, cc-by-nc, cc-by-nc-sa, cc-by-nc-nd, closed, unknown
      return 'A';
  }
}

export const LICENSE_IDS: LicenseId[] = [
  'cc-by', 'cc-by-sa', 'cc0', 'public-domain', 'platform-cc-by-sa',
  'cc-by-nd',
  'arxiv-default', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nc-nd', 'closed', 'unknown',
];

// ---------- Content ----------

export interface Section {
  heading: string;
  body: string;
  order: number;
}

export interface Reference {
  label: string;        // e.g. "[1]" or a citation key
  raw: string;          // formatted citation text as authored
  work_id?: number;     // resolved internal link, if any
  doi?: string;
  url?: string;
}

export interface WorkContent {
  title: string;
  abstract: string;
  sections: Section[];    // must be [] when tier === 'A'
  references: Reference[];
}

// ---------- Core entities ----------

export interface User {
  id: number;
  username: string;
  display_name: string;
  is_pseudonym: boolean;
  orcid: string | null;
  bio: string | null;
  is_admin: boolean;
  created_at: string;
}
export type PublicUser = User; // password_hash is never selected into a User object at all

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
  license: LicenseId;
  tier: Tier;
  publication_year: number | null;
  current_version_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkVersion {
  id: number;
  work_id: number;
  version_number: number;
  content: WorkContent;   // parsed from content_json
  content_hash: string;
  license: LicenseId;
  change_note: string | null;
  created_by: number | null;
  created_at: string;
}

export interface AuthorPreview {
  position: number;
  name: string;
  user_id: number | null;
  author_id: number | null;
  orcid: string | null;
  credit_roles: CreditRole[];
}

export interface WorkSummary extends Work {
  authors: AuthorPreview[];
}

export interface Subunit {
  id: number;
  work_id: number;
  version_id: number;
  type: SubunitType;
  title: string | null;
  content: string;
  content_hash: string;
  order_index: number;
  created_by: number | null;
  created_at: string;
}

export interface WorkDetail extends WorkSummary {
  current_version: WorkVersion | null; // null only for imported Tier-A stubs before any version exists
  subunits: Subunit[];                 // [] unless tier === 'C'
}

export interface Author {
  id: number;
  full_name: string;
  orcid: string | null;
  openalex_author_id: string | null;
}

export interface Authorship {
  id: number;
  work_id: number;
  position: number;
  credit_roles: CreditRole[];
  user_id: number | null;
  author_id: number | null;
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
  model: string | null;
  model_version: string | null;
  confidence: number | null;
  basis: string | null;
  status: EdgeStatus;
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface EdgeDetail extends Edge {
  votes: { up: number; down: number; my_vote: -1 | 0 | 1 };
  /** Convenience for rendering connection lists without extra fetches. */
  source_title?: string;
  target_title?: string;
}

export interface EdgeVote {
  id: number;
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
  edited_at: string | null;
  deleted_at: string | null;
}

export interface AiOutput {
  id: number;
  work_id: number;
  feature: AiFeature;
  content: string;    // summary/explainer: text or {question,answer} JSON string. glossary: JSON array string.
  model: string;
  model_version: string;
  status: AiOutputStatus;
  edited_by: number | null;
  edited_at: string | null;
  previous_output_id: number | null;
  is_current: boolean;
  created_at: string;
}

export interface GlossaryEntry { term: string; definition: string; }
export interface ExplainerContent { question: string; answer: string; }

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

export interface AccuracyTrackRecord {
  feature: AiFeature;
  open: number;
  upheld: number;
  dismissed: number;
}

// ---------- Chats (uploaded AI conversations, §4.1–4.2 trust pattern) ----------

export interface Chat {
  id: number;
  url: string | null;
  platform: ChatPlatform;
  title: string;
  transcript: string;
  content_hash: string;
  uploaded_by: number;
  uploader_name?: string;
  status: ChatStatus;
  verified_at: string | null;
  created_at: string;
}

/** Chat list rows omit the full transcript to keep payloads small. */
export type ChatSummary = Omit<Chat, 'transcript'> & {
  confirmed_link_count: number;
  suggested_link_count: number;
};

export interface ChatLink {
  id: number;
  chat_id: number;
  work_id: number;
  origin: EdgeOrigin;
  model: string | null;
  model_version: string | null;
  confidence: number | null;
  basis: string | null;
  status: ChatLinkStatus;
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface ChatLinkDetail extends ChatLink {
  work_title: string;
  work_kind: WorkKind;
}

/** A paper referenced in a chat (by DOI or arXiv id) that is not yet in the corpus.
 *  The uploader can import+link it in one click; once imported it leaves this list and
 *  appears as a confirmed link instead. Only ever populated for the uploader/admin. */
export interface ExternalRef {
  kind: 'doi' | 'arxiv';
  id: string;
}

export interface ChatDetail extends Chat {
  links: ChatLinkDetail[];
  /** Pending importable references — uploader-visible only; omitted for other viewers. */
  external_refs?: ExternalRef[];
}

/** A verified chat as shown on a work page, with the confirming link. */
export interface WorkChat {
  chat: Omit<Chat, 'transcript'>;
  link: ChatLink;
}

// ---------- Search & Graph ----------

export interface ScoreComponents {
  relevance: number;      // 0..1, from FTS5 bm25
  rigor: number;          // 0..1, normalized confirmed supports+replications-fails_to_replicate
  review_count: number;   // 0..1, normalized confirmed 'reviews' edge count
  recency: number;        // 0..1, exponential decay
}

export interface SearchResultItem {
  work: WorkSummary;
  score: number;              // weighted total, 0..1
  score_components: ScoreComponents;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  limit: number;
  offset: number;
  weights: ScoreComponents;    // the weight constants used, for transparency (§8.3)
}

export interface GraphNode {
  id: number;
  kind: WorkKind;
  title: string;
  result_nature: ResultNature;
  tier: Tier;
  publication_year: number | null;
  /** Count of non-rejected edges touching this work across the whole corpus. */
  degree: number;
}

export interface GraphEdge {
  id: number;
  source_work_id: number;
  target_work_id: number;
  type: EdgeType;
  origin: EdgeOrigin;
  status: EdgeStatus;
  confidence: number | null;
}

export interface GraphResponse {
  /** null for the field-wide overview graph (no root work). */
  root_id: number | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

// ---------- Misc ----------

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportResult {
  work: WorkDetail;
  created: boolean;   // false when deduped onto an existing work
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
