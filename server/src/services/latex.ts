// content_json -> .tex / .bib rendering — spec §9.
import type { WorkDetail } from '../../../shared/types.js';

/** Escapes the LaTeX special characters & % $ # _ { } ~ ^ \ in arbitrary interpolated text. */
export function escapeLatex(input: string): string {
  if (!input) return '';
  let out = '';
  for (const ch of input) {
    switch (ch) {
      case '\\':
        out += '\\textbackslash{}';
        break;
      case '&':
        out += '\\&';
        break;
      case '%':
        out += '\\%';
        break;
      case '$':
        out += '\\$';
        break;
      case '#':
        out += '\\#';
        break;
      case '_':
        out += '\\_';
        break;
      case '{':
        out += '\\{';
        break;
      case '}':
        out += '\\}';
        break;
      case '~':
        out += '\\textasciitilde{}';
        break;
      case '^':
        out += '\\textasciicircum{}';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/**
 * Splits a display name ("Jane Q. Public") into {given, family} on the LAST space
 * (best-effort — names are stored as free-text display strings, not structured).
 * No space found -> the whole name is treated as the family name, given is ''.
 */
export function splitName(name: string): { given: string; family: string } {
  const trimmed = name.trim();
  const idx = trimmed.lastIndexOf(' ');
  if (idx === -1) return { given: '', family: trimmed };
  return { given: trimmed.slice(0, idx), family: trimmed.slice(idx + 1) };
}

function yearOf(work: WorkDetail): string {
  if (work.publication_year != null) return String(work.publication_year);
  const y = new Date(work.created_at).getUTCFullYear();
  return Number.isFinite(y) ? String(y) : '';
}

function orderedAuthorNames(work: WorkDetail): string[] {
  return work.authors
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((a) => a.name);
}

/**
 * renderLatex — spec §9: \documentclass{article}, \title/\author (\and-joined, 'Anonymous' if
 * none), \date from publication_year or created_at year, abstract env, one \section per Section
 * (in `order`), and a thebibliography built from references. Works with empty `sections`
 * (Tier A) still render a valid stub article.
 */
export function renderLatex(work: WorkDetail): string {
  const content = work.current_version?.content ?? {
    title: work.title,
    abstract: work.abstract ?? '',
    sections: [],
    references: [],
  };

  const names = orderedAuthorNames(work);
  const authorLine = names.length > 0 ? names.map(escapeLatex).join(' \\and ') : 'Anonymous';
  const sortedSections = [...content.sections].sort((a, b) => a.order - b.order);

  const lines: string[] = [];
  lines.push('\\documentclass{article}');
  lines.push('\\usepackage[utf8]{inputenc}');
  lines.push(`\\title{${escapeLatex(content.title)}}`);
  lines.push(`\\author{${authorLine}}`);
  lines.push(`\\date{${escapeLatex(yearOf(work))}}`);
  lines.push('');
  lines.push('\\begin{document}');
  lines.push('\\maketitle');
  lines.push('');
  lines.push('\\begin{abstract}');
  lines.push(escapeLatex(content.abstract));
  lines.push('\\end{abstract}');

  for (const section of sortedSections) {
    lines.push('');
    lines.push(`\\section{${escapeLatex(section.heading)}}`);
    lines.push(escapeLatex(section.body));
  }

  lines.push('');
  const bibWidth = Math.max(content.references.length, 1);
  lines.push(`\\begin{thebibliography}{${bibWidth}}`);
  for (const ref of content.references) {
    lines.push(`\\bibitem{${escapeLatex(ref.label)}} ${escapeLatex(ref.raw)}`);
  }
  lines.push('\\end{thebibliography}');
  lines.push('');
  lines.push('\\end{document}');

  return lines.join('\n');
}

/** Minimal brace-escaping for a BibTeX field value (keeps the field's delimiter braces balanced). */
function escapeBibtexValue(value: string): string {
  return value.replace(/[{}]/g, (ch) => `\\${ch}`);
}

function bibField(name: string, value: string, preserveCase = false): string {
  const escaped = escapeBibtexValue(value);
  return `  ${name} = {${preserveCase ? `{${escaped}}` : escaped}}`;
}

/** "Jane Q. Public" -> "Public, Jane Q." (split on last space; no space -> unchanged). */
function lastFirst(name: string): string {
  const { given, family } = splitName(name);
  return given ? `${family}, ${given}` : family;
}

/**
 * renderBibtex — spec (routes/export.ts task): @article{bp<id>, title (double-braced to
 * preserve case), author (Last, First and Last2, First2 / 'Anonymous'), year
 * (publication_year ?? created_at year), doi if present, note with node id/tier/license.
 * No url field.
 */
export function renderBibtex(work: WorkDetail): string {
  const title = work.current_version?.content.title ?? work.title;
  const names = orderedAuthorNames(work);
  const author = names.length > 0 ? names.map(lastFirst).join(' and ') : 'Anonymous';
  const year = yearOf(work);

  const fields: string[] = [];
  fields.push(bibField('title', title, true));
  fields.push(bibField('author', author));
  fields.push(bibField('year', year));
  if (work.doi) fields.push(bibField('doi', work.doi));

  // Web-native works cite as @misc with howpublished — there is no journal to point at.
  if (work.kind === 'blog') {
    // Not via bibField — its brace-escaping would mangle the \url{} macro itself.
    if (work.url) fields.push(`  howpublished = {\\url{${work.url.replace(/[{}]/g, '')}}}`);
    const noteParts = [work.site_name, `Beyond Papers node #${work.id}, tier ${work.tier}, license ${work.license}`];
    fields.push(bibField('note', noteParts.filter(Boolean).join('. ')));
    return `@misc{bp${work.id},\n${fields.join(',\n')}\n}\n`;
  }

  fields.push(bibField('note', `Beyond Papers node #${work.id}, tier ${work.tier}, license ${work.license}`));

  return `@article{bp${work.id},\n${fields.join(',\n')}\n}\n`;
}
