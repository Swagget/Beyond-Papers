// Shared work-authoring form — used by SubmitPage (create), EditWorkPage (edit),
// and ReviewComposerPage (review). See docs/ARCHITECTURE.md §12 page inventory
// and §13.3/§13.5 request shapes.
//
// The form owns all field state and client-side validation; it never talks to
// the API directly. The caller supplies `onSubmit`, which is expected to
// perform the actual request. If `onSubmit` throws (in particular an
// ApiRequestError from client/src/api.ts), the thrown message is displayed
// verbatim so server-side messages — especially LICENSE_GATE explanations —
// reach the user unmodified.

import { useState } from 'react';
import type { FormEvent } from 'react';
import type {
  EditingMode,
  LicenseId,
  Reference,
  ResultNature,
  Section,
  Tier,
  WorkContent,
  WorkKind,
} from '@shared/types';
import { LICENSE_IDS, licenseToTier } from '@shared/types';
import { ApiRequestError } from '../api';

export type WorkFormMode = 'create' | 'edit' | 'review';

export interface WorkFormInitial extends Partial<WorkContent> {
  kind?: WorkKind;
  result_nature?: ResultNature;
  editing?: EditingMode;
  license?: LicenseId;
}

export interface WorkFormPayload {
  kind: WorkKind;
  result_nature: ResultNature;
  editing: EditingMode;
  title: string;
  abstract: string;
  sections: Section[];
  references: Reference[];
  license: LicenseId;
  change_note: string;
}

interface WorkFormProps {
  initial?: WorkFormInitial;
  mode: WorkFormMode;
  onSubmit: (payload: WorkFormPayload) => Promise<void> | void;
  submitLabel: string;
  busy?: boolean;
}

const KIND_OPTIONS: { value: WorkKind; label: string; help: string }[] = [
  { value: 'paper', label: 'Paper', help: 'A conventional research paper — the primary literature type.' },
  { value: 'replication', label: 'Replication', help: "An attempt to reproduce another work's results." },
  { value: 'concept', label: 'Concept', help: 'A shared idea or concept node, owned by no one in particular (§12.4).' },
  { value: 'dataset', label: 'Dataset', help: 'A dataset as a first-class, citable node.' },
  { value: 'code', label: 'Code', help: 'Code or software as a first-class, citable node.' },
];

const RESULT_NATURE_OPTIONS: { value: ResultNature; label: string }[] = [
  { value: 'positive', label: 'Positive — supports the hypothesis' },
  { value: 'negative', label: 'Negative — contradicts the hypothesis' },
  { value: 'null', label: 'Null — no significant effect found' },
  { value: 'inconclusive', label: 'Inconclusive' },
  { value: 'na', label: 'Not applicable' },
];

const EDITING_OPTIONS: { value: EditingMode; label: string; help: string }[] = [
  {
    value: 'authored',
    label: 'Authored',
    help: 'Only you (and co-authors) can edit directly — others suggest changes via review (§12.3).',
  },
  {
    value: 'communal',
    label: 'Communal',
    help: 'Anyone can edit, wiki-style, with full version history and revert preserved (§12.3).',
  },
];

const LICENSE_NAMES: Record<LicenseId, string> = {
  'cc-by': 'CC BY 4.0',
  'cc-by-sa': 'CC BY-SA 4.0',
  cc0: 'CC0 — public domain dedication',
  'public-domain': 'Public domain',
  'platform-cc-by-sa': 'Platform CC BY-SA 4.0 (native contribution)',
  'cc-by-nd': 'CC BY-ND 4.0',
  'arxiv-default': 'arXiv default license',
  'cc-by-nc': 'CC BY-NC 4.0',
  'cc-by-nc-sa': 'CC BY-NC-SA 4.0',
  'cc-by-nc-nd': 'CC BY-NC-ND 4.0',
  closed: 'All rights reserved / closed',
  unknown: 'Unknown / unspecified',
};

const TIER_FEATURE_TEXT: Record<Tier, string> = {
  A: 'metadata + abstract only',
  B: 'hosted whole, unchanged',
  C: 'full features',
};

function emptySection(order: number): Section {
  return { heading: '', body: '', order };
}

function emptyReference(): Reference {
  return { label: '', raw: '' };
}

export default function WorkForm({ initial, mode, onSubmit, submitLabel, busy }: WorkFormProps) {
  const showKind = mode !== 'review';
  const showResultNature = mode !== 'review';

  const [kind, setKind] = useState<WorkKind>(initial?.kind && initial.kind !== 'review' ? initial.kind : 'paper');
  const [resultNature, setResultNature] = useState<ResultNature>(initial?.result_nature ?? 'na');
  const [editing, setEditing] = useState<EditingMode>(initial?.editing ?? 'authored');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [abstract, setAbstract] = useState(initial?.abstract ?? '');
  const [license, setLicense] = useState<LicenseId>(
    mode === 'review' ? 'platform-cc-by-sa' : initial?.license ?? 'platform-cc-by-sa',
  );
  const [sections, setSections] = useState<Section[]>(initial?.sections ?? []);
  const [references, setReferences] = useState<Reference[]>(initial?.references ?? []);
  const [changeNote, setChangeNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isConcept = showKind && kind === 'concept';
  const showEditing = mode !== 'review' && !isConcept;
  const tier = licenseToTier(license);
  const sectionsDisabled = tier === 'A';

  function updateSection(index: number, patch: Partial<Section>) {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addSection() {
    setSections((prev) => [...prev, emptySection(prev.length)]);
  }

  function removeSection(index: number) {
    setSections((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i })));
  }

  function updateReference(index: number, patch: Partial<Reference>) {
    setReferences((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addReference() {
    setReferences((prev) => [...prev, emptyReference()]);
  }

  function removeReference(index: number) {
    setReferences((prev) => prev.filter((_, i) => i !== index));
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!title.trim()) errs.push('Title is required.');
    if (!abstract.trim()) errs.push('Abstract is required.');
    if (mode === 'edit' && !changeNote.trim()) errs.push('A change note is required when saving a new version (§1.3).');
    if (!sectionsDisabled) {
      sections.forEach((s, i) => {
        if (!s.heading.trim()) errs.push(`Section ${i + 1}: heading is required.`);
        if (!s.body.trim()) errs.push(`Section ${i + 1}: body is required.`);
      });
    }
    references.forEach((r, i) => {
      if (!r.label.trim()) errs.push(`Reference ${i + 1}: label is required.`);
      if (!r.raw.trim()) errs.push(`Reference ${i + 1}: citation text is required.`);
    });
    return errs;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setSubmitError(null);
    if (errs.length > 0) return;

    const effectiveKind: WorkKind = showKind ? kind : 'paper';
    const effectiveEditing: EditingMode = isConcept ? 'communal' : effectiveKind === 'concept' ? 'communal' : editing;

    const payload: WorkFormPayload = {
      kind: effectiveKind,
      result_nature: showResultNature ? resultNature : 'na',
      editing: effectiveEditing,
      title: title.trim(),
      abstract: abstract.trim(),
      sections: sectionsDisabled ? [] : sections.map((s, i) => ({ ...s, order: i })),
      references,
      license,
      change_note: changeNote.trim(),
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setSubmitError(err.message);
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isBusy = Boolean(busy) || submitting;

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      {errors.length > 0 ? (
        <div
          role="alert"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-danger)',
          }}
        >
          <p className="small" style={{ fontWeight: 'var(--font-weight-semibold)' }}>
            Please fix the following before submitting:
          </p>
          <ul style={{ listStyle: 'disc', paddingLeft: '1.25em', marginTop: 'var(--space-1)' }}>
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {submitError ? (
        <div
          role="alert"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-danger)',
          }}
        >
          {submitError}
        </div>
      ) : null}

      {showKind ? (
        <div className="field">
          <label htmlFor="wf-kind">Kind</label>
          <select id="wf-kind" value={kind} onChange={(e) => setKind(e.target.value as WorkKind)}>
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="field-hint">{KIND_OPTIONS.find((o) => o.value === kind)?.help}</p>
          {isConcept ? (
            <p className="field-hint" style={{ color: 'var(--color-accent)' }}>
              Concept nodes are communal — openly editable by anyone (§12.4)
            </p>
          ) : null}
        </div>
      ) : null}

      {showResultNature ? (
        <div className="field">
          <label htmlFor="wf-result-nature">Nature of results</label>
          <select id="wf-result-nature" value={resultNature} onChange={(e) => setResultNature(e.target.value as ResultNature)}>
            {RESULT_NATURE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="field-hint">Negative, null and inconclusive results are first-class here (§1.4).</p>
        </div>
      ) : null}

      {showEditing ? (
        <div className="field">
          <label htmlFor="wf-editing">Editing mode</label>
          <select id="wf-editing" value={editing} onChange={(e) => setEditing(e.target.value as EditingMode)}>
            {EDITING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="field-hint">{EDITING_OPTIONS.find((o) => o.value === editing)?.help}</p>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="wf-title">Title</label>
        <input id="wf-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      <div className="field">
        <label htmlFor="wf-abstract">Abstract</label>
        <textarea id="wf-abstract" value={abstract} onChange={(e) => setAbstract(e.target.value)} required />
      </div>

      <div className="field">
        <label htmlFor="wf-license">License</label>
        {mode === 'review' ? (
          <p className="field-hint">
            Fixed to <strong>{LICENSE_NAMES['platform-cc-by-sa']}</strong> · Tier C ({TIER_FEATURE_TEXT.C}). Your
            contribution is published under CC-BY-SA 4.0 (§3.7).
          </p>
        ) : (
          <>
            <select id="wf-license" value={license} onChange={(e) => setLicense(e.target.value as LicenseId)}>
              {LICENSE_IDS.map((id) => (
                <option key={id} value={id}>
                  {LICENSE_NAMES[id]}
                </option>
              ))}
            </select>
            <p className="field-hint">
              {license} → Tier {tier} ({TIER_FEATURE_TEXT[tier]})
            </p>
            <p className="field-hint">
              Tier A licenses store metadata + abstract only. Tier B hosts the full work unchanged. Tier C unlocks
              sub-units and AI transformation (§3.1).
              {license === 'platform-cc-by-sa' ? ' Your contribution is published under CC-BY-SA 4.0 (§3.7).' : ''}
            </p>
          </>
        )}
      </div>

      <fieldset>
        <legend>Sections</legend>
        {sectionsDisabled ? (
          <p className="field-hint">Tier A licenses store metadata + abstract only (§3.1).</p>
        ) : (
          <div className="stack">
            {sections.length === 0 ? <p className="field-hint">No sections yet — add one below.</p> : null}
            {sections.map((s, i) => (
              <div key={i} className="stack" style={{ gap: 'var(--space-2)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--color-border)' }}>
                <div className="field">
                  <label htmlFor={`wf-section-heading-${i}`}>Section {i + 1} heading</label>
                  <input
                    id={`wf-section-heading-${i}`}
                    type="text"
                    value={s.heading}
                    onChange={(e) => updateSection(i, { heading: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`wf-section-body-${i}`}>Section {i + 1} body</label>
                  <textarea
                    id={`wf-section-body-${i}`}
                    value={s.body}
                    onChange={(e) => updateSection(i, { body: e.target.value })}
                  />
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSection(i)}>
                  Remove section {i + 1}
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addSection}>
              + Add section
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>References</legend>
        <div className="stack">
          {references.length === 0 ? <p className="field-hint">No references yet — add one below.</p> : null}
          {references.map((r, i) => (
            <div key={i} className="stack" style={{ gap: 'var(--space-2)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--color-border)' }}>
              <div className="field">
                <label htmlFor={`wf-ref-label-${i}`}>Reference {i + 1} label</label>
                <input
                  id={`wf-ref-label-${i}`}
                  type="text"
                  placeholder="[1]"
                  value={r.label}
                  onChange={(e) => updateReference(i, { label: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`wf-ref-raw-${i}`}>Reference {i + 1} citation text</label>
                <textarea
                  id={`wf-ref-raw-${i}`}
                  value={r.raw}
                  onChange={(e) => updateReference(i, { raw: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`wf-ref-doi-${i}`}>Reference {i + 1} DOI (optional)</label>
                <input
                  id={`wf-ref-doi-${i}`}
                  type="text"
                  value={r.doi ?? ''}
                  onChange={(e) => updateReference(i, { doi: e.target.value || undefined })}
                />
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeReference(i)}>
                Remove reference {i + 1}
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addReference}>
            + Add reference
          </button>
        </div>
      </fieldset>

      {mode === 'edit' ? (
        <div className="field">
          <label htmlFor="wf-change-note">Change note</label>
          <input
            id="wf-change-note"
            type="text"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            required
            placeholder="What changed and why?"
          />
          <p className="field-hint">Saving creates a new immutable version (§1.3).</p>
        </div>
      ) : null}

      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={isBusy}>
          {isBusy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
