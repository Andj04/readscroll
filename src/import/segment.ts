import { isTitleHeading } from './chapters';
import type { Block, CardDraft, LengthRules, PlannedChapter } from './types';
import { countWords, splitSentences } from './textUtils';

// Cuts the blocks of a chapter into cards.
// Rules: never cut inside a sentence, prefer paragraph ends, split long paragraphs
// at sentence boundaries, merge short paragraphs, keep a heading with the text after it,
// keep lists and quotes whole when they fit.

/** Start offset of each block in the book text (blocks joined by a blank line). */
export function blockOffsets(blocks: Block[]): number[] {
  const out: number[] = [];
  let pos = 0;
  for (const b of blocks) {
    out.push(pos);
    pos += b.text.length + 2;
  }
  return out;
}

/** The book text that card offsets point into. Used for the book identity and to map progress. */
export function bookText(blocks: Block[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

/** A piece of a block that can go into a card: a sentence, or one list item. */
interface Piece {
  block: number;
  text: string;
  start: number;
  end: number;
  words: number;
  page: number | null;
}

interface Draft {
  title: string | null;
  pieces: Piece[];
  words: number;
}

function piecesOf(block: Block, index: number, offset: number, lang?: string): Piece[] {
  if (block.kind === 'list' || block.kind === 'quote') {
    // Items (or quoted paragraphs) are the cutting points.
    const out: Piece[] = [];
    let pos = 0;
    for (const line of block.text.split('\n')) {
      if (line.trim()) out.push({ block: index, text: line, start: offset + pos, end: offset + pos + line.length, words: countWords(line, lang), page: block.page });
      pos += line.length + 1;
    }
    return out;
  }
  return splitSentences(block.text, lang).map((s) => ({
    block: index,
    text: s.text,
    start: offset + s.start,
    end: offset + s.end,
    words: countWords(s.text, lang),
    page: block.page,
  }));
}

function render(d: Draft, blocks: Block[]): CardDraft {
  let text = '';
  let prev: Piece | null = null;
  for (const p of d.pieces) {
    if (prev) {
      if (p.block !== prev.block) text += '\n\n';
      else text += blocks[p.block].kind === 'paragraph' ? ' ' : '\n';
    }
    text += p.text;
    prev = p;
  }
  return {
    title: d.title,
    text,
    wordCount: d.words,
    page: d.pieces[0].page,
    start: d.pieces[0].start,
    end: d.pieces[d.pieces.length - 1].end,
  };
}

/**
 * Splits pieces that are too long for one card into balanced parts:
 * n = ceil(words / targetMax) parts of about words / n words each.
 */
function balancedParts(pieces: Piece[], rules: LengthRules): Piece[][] {
  const total = pieces.reduce((s, p) => s + p.words, 0);
  const n = Math.max(1, Math.ceil(total / rules.targetMax));
  const goal = total / n;
  const parts: Piece[][] = [[]];
  let words = 0;
  for (const p of pieces) {
    const cur = parts[parts.length - 1];
    // Close the part when adding this piece would take it further from the goal, or over the maximum.
    const closer = Math.abs(words + p.words - goal) <= Math.abs(words - goal);
    if (cur.length > 0 && (!closer || words + p.words > rules.hardMax)) {
      parts.push([p]);
      words = p.words;
    } else {
      cur.push(p);
      words += p.words;
    }
  }
  return parts;
}

export interface SegmentOptions {
  rules: LengthRules;
  lang?: string;
  /** Stop after this many cards (used for previews). */
  limit?: number;
}

export function segmentChapter(blocks: Block[], offsets: number[], chapter: PlannedChapter, opts: SegmentOptions): CardDraft[] {
  const { rules, lang, limit = Infinity } = opts;
  const drafts: Draft[] = [];
  let cur: Draft = { title: null, pieces: [], words: 0 };
  const flush = () => {
    if (cur.pieces.length) drafts.push(cur);
    cur = { title: null, pieces: [], words: 0 };
  };
  const add = (ps: Piece[]) => {
    for (const p of ps) {
      cur.pieces.push(p);
      cur.words += p.words;
    }
  };

  let leading = true; // headings at the very start that repeat the chapter title are skipped
  for (let i = chapter.start; i < chapter.end && drafts.length < limit + 2; i++) {
    const block = blocks[i];
    if (block.kind === 'heading') {
      if (leading && isTitleHeading(block, chapter.title)) continue;
      // A heading starts a new card and becomes its title (two headings in a row are combined).
      if (cur.pieces.length) flush();
      cur.title = cur.title ? `${cur.title} · ${block.text}` : block.text;
      continue;
    }
    leading = false;

    const pieces = piecesOf(block, i, offsets[i], lang);
    const total = pieces.reduce((s, p) => s + p.words, 0);
    if (pieces.length === 0) continue;

    // 1. The whole block fits in the current card.
    if (cur.words + total <= rules.targetMax) {
      add(pieces);
      continue;
    }
    // 2. The current card is long enough: close it and start a new one.
    if (cur.words >= rules.targetMin) flush();
    // 3. The block still fits under the hard maximum.
    if (cur.words + total <= rules.hardMax) {
      add(pieces);
      continue;
    }
    // 4. The block must be split at sentence (or item) boundaries.
    let rest = pieces;
    if (cur.words > 0) {
      let k = 0;
      while (k < rest.length && cur.words + rest[k].words <= rules.targetMax) k++;
      add(rest.slice(0, k));
      rest = rest.slice(k);
      flush();
    }
    const parts = balancedParts(rest, rules);
    parts.forEach((part, j) => {
      add(part);
      if (j < parts.length - 1) flush(); // the last part stays open so the next paragraph can join it
    });
  }
  flush();

  // Merge cards below the soft minimum with a neighbour when the result stays under the hard maximum.
  const merged: Draft[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const next = drafts[i + 1];
    const prev = merged[merged.length - 1];
    if (d.words < rules.softMin) {
      if (next && !next.title && d.words + next.words <= rules.hardMax) {
        drafts[i + 1] = { title: d.title, pieces: [...d.pieces, ...next.pieces], words: d.words + next.words };
        continue;
      }
      if (prev && !d.title && prev.words + d.words <= rules.hardMax) {
        prev.pieces.push(...d.pieces);
        prev.words += d.words;
        continue;
      }
    }
    merged.push(d);
  }
  return merged.slice(0, limit).map((d) => render(d, blocks));
}
