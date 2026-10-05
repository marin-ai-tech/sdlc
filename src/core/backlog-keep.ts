/**
 * Hand-written backlog content the parsed model does not hold: notes, unknown fields and fenced blocks under items,
 * lines under epic headings, text after the header, extra `##` sections and an unknown status text.
 * The parser records it here, beside the model, and the renderer writes it back, so a CLI write changes only its
 * own item or epic. WeakMaps keep it out of the model itself, so `backlog list --json` stays as it was.
 */
import type { Backlog, BacklogEpic, BacklogItem } from './backlog.js';

/** An extra `##` section that is neither an epic nor Unassigned, with its lines. */
export interface KeptSection {
  heading: string;
  lines: string[];
}

/** Hand-written content outside items and epics. */
export interface KeptDocument {
  /** The first `# ` line of the header, when the file has one. */
  title?: string;
  /** Lines before the first `##` section, header lines left out. */
  preamble: string[];
  /** Index in `preamble` right after the last header line: blank lines before it belong to the header. */
  headerEnd: number;
  /** Lines under `## Unassigned` before its first item. */
  unassigned: string[];
  sections: KeptSection[];
}

interface KeptItem {
  lines: string[];
  /** Status text the CLI does not know (e.g. `blocked`); the model reads such an item as open. */
  statusText?: string;
}

const documents = new WeakMap<Backlog, KeptDocument>();
const items = new WeakMap<BacklogItem, KeptItem>();
const epics = new WeakMap<BacklogEpic, string[]>();

/** Starts the record for a parsed backlog. */
export function keepDocument(backlog: Backlog): KeptDocument {
  const kept: KeptDocument = { preamble: [], headerEnd: 0, unassigned: [], sections: [] };
  documents.set(backlog, kept);
  return kept;
}

/** Starts the record for a parsed item; returns the list its unparsed lines go to. */
export function keepItem(item: BacklogItem, statusText: string | undefined): string[] {
  const kept: KeptItem = statusText === undefined ? { lines: [] } : { lines: [], statusText };
  items.set(item, kept);
  return kept.lines;
}

/** Starts the record for a parsed epic; returns the list its unparsed lines go to. */
export function keepEpic(epic: BacklogEpic): string[] {
  const lines: string[] = [];
  epics.set(epic, lines);
  return lines;
}

function withoutTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) {
    end--;
  }
  return lines.slice(0, end);
}

export function keptDocument(backlog: Backlog): KeptDocument | undefined {
  return documents.get(backlog);
}

/** Text between the header and the first section. */
export function keptPreamble(kept: KeptDocument | undefined): string[] {
  if (!kept) {
    return [];
  }
  const body = kept.preamble.filter((line, index) => index >= kept.headerEnd || line.trim() !== '');
  return withoutTrailingBlanks(body);
}

/** Lines under an epic heading (other than `Goal:`), or under Unassigned when `epic` is undefined. */
export function keptSectionLines(kept: KeptDocument | undefined, epic: BacklogEpic | undefined): string[] {
  const lines = epic ? epics.get(epic) : kept?.unassigned;
  return withoutTrailingBlanks(lines ?? []);
}

/** Lines under an item that are not its known fields, in file order. */
export function keptItemLines(item: BacklogItem): string[] {
  return withoutTrailingBlanks(items.get(item)?.lines ?? []);
}

/** The status text for the item heading: an unknown text stays until a CLI command sets a status. */
export function headingStatus(item: BacklogItem): string {
  const statusText = items.get(item)?.statusText;
  return statusText !== undefined && item.status === 'open' ? statusText : item.status;
}

/** The extra `##` sections, each after a blank line, for the end of the file. */
export function keptSectionsAtEnd(kept: KeptDocument | undefined): string[] {
  const lines: string[] = [];
  for (const section of kept?.sections ?? []) {
    lines.push('', section.heading, ...withoutTrailingBlanks(section.lines));
  }
  return lines;
}
