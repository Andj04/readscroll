import type { Block, ChapterMethod, Extracted, PlannedChapter } from './types';
import { countWords } from './textUtils';

// Chapter detection, in this order:
//   1. the EPUB table of contents, or the PDF outline,
//   2. headings in the text ("Chapter 3", or the biggest heading level),
//   3. nothing reliable: one chapter, which the user can split in the review screen.

/** Text before the first chapter with fewer words than this is merged into the first chapter. */
const MIN_OPENING_WORDS = 30;

export const OPENING_TITLE = 'Opening pages';

function wordsIn(blocks: Block[], from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) n += countWords(blocks[i].text);
  return n;
}

/** True when the block is a heading repeated by the chapter title (it is then not shown as a card). */
export function isTitleHeading(block: Block, chapterTitle: string): boolean {
  if (block.kind !== 'heading') return false;
  const simple = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const h = simple(block.text);
  return h.length > 0 && simple(chapterTitle).includes(h);
}

/** Words of a chapter, not counting the headings already used as its title. */
function contentWords(blocks: Block[], ch: PlannedChapter): number {
  let n = 0;
  for (let i = ch.start; i < ch.end; i++) if (!isTitleHeading(blocks[i], ch.title)) n += countWords(blocks[i].text);
  return n;
}

/** Builds chapters from a list of start points. Empty chapters are merged into the next one. */
export function chaptersFromStarts(blocks: Block[], starts: { title: string; blockIndex: number }[]): PlannedChapter[] {
  const sorted = [...starts].sort((a, b) => a.blockIndex - b.blockIndex).filter((s, i, arr) => i === 0 || s.blockIndex !== arr[i - 1].blockIndex);
  if (sorted.length === 0) return [];

  const chapters: PlannedChapter[] = [];
  if (sorted[0].blockIndex > 0) {
    if (wordsIn(blocks, 0, sorted[0].blockIndex) >= MIN_OPENING_WORDS) {
      chapters.push({ title: OPENING_TITLE, start: 0, end: sorted[0].blockIndex });
    } else {
      sorted[0] = { ...sorted[0], blockIndex: 0 };
    }
  }
  sorted.forEach((s, i) => {
    chapters.push({ title: s.title, start: s.blockIndex, end: i + 1 < sorted.length ? sorted[i + 1].blockIndex : blocks.length });
  });

  // A chapter with no text of its own (e.g. a "Part I" page right before "Chapter 1") joins the next one.
  const out: PlannedChapter[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (contentWords(blocks, ch) === 0 && i + 1 < chapters.length) {
      chapters[i + 1] = { ...chapters[i + 1], start: ch.start };
      continue;
    }
    out.push(ch);
  }
  return out;
}

/** Title for a chapter starting with a heading: "Chapter 3" followed by a subtitle heading becomes "Chapter 3: Subtitle". */
function headingTitle(blocks: Block[], i: number): string {
  const h = blocks[i];
  const next = blocks[i + 1];
  if (h.chapterLike && h.text.split(/\s+/).length <= 3 && next?.kind === 'heading' && !next.chapterLike) {
    return `${h.text}: ${next.text}`;
  }
  return h.text;
}

function fromHeadings(blocks: Block[]): PlannedChapter[] | null {
  const headings = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'heading');
  if (headings.length < 2) return null;

  // "Chapter 3", "Part II", "IV": the most reliable signal.
  const chapterLike = headings.filter(({ b }) => b.chapterLike);
  if (chapterLike.length >= 2) {
    return chaptersFromStarts(blocks, chapterLike.map(({ i }) => ({ title: headingTitle(blocks, i), blockIndex: i })));
  }

  // Otherwise, the biggest heading level, if it splits the text into chapters of reasonable size.
  const top = Math.min(...headings.map(({ b }) => b.level ?? 9));
  const tops = headings.filter(({ b }) => (b.level ?? 9) === top);
  if (tops.length < 2) return null;
  const avgBlocks = blocks.length / tops.length;
  if (avgBlocks < 3) return null; // headings almost everywhere: not chapter titles
  return chaptersFromStarts(blocks, tops.map(({ b, i }) => ({ title: b.text, blockIndex: i })));
}

export function detectChapters(ex: Extracted, fallbackTitle: string): { chapters: PlannedChapter[]; method: ChapterMethod } {
  if (ex.toc && ex.toc.length >= 2) {
    const chapters = chaptersFromStarts(ex.blocks, ex.toc);
    if (chapters.length >= 2) return { chapters, method: ex.format === 'pdf' ? 'outline' : 'toc' };
  }
  const byHeadings = fromHeadings(ex.blocks);
  if (byHeadings && byHeadings.length >= 2) return { chapters: byHeadings, method: 'headings' };
  return { chapters: [{ title: fallbackTitle, start: 0, end: ex.blocks.length }], method: 'none' };
}
