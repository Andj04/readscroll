import { blockOffsets, bookText, segmentChapter } from './segment';
import { LENGTH_RULES, type Block, type CardLength, type PlannedChapter } from './types';

// Turns the reviewed chapter plan into the final chapters and cards.

export interface BuiltCard {
  id: string;
  bookId: string;
  chapterNumber: number;
  /** Continuous across the book. */
  number: number;
  /** PDF page, or null for EPUB and plain text. */
  page: number | null;
  /** Position in the book for formats without pages, e.g. "12%". */
  location: string | null;
  title: string | null;
  text: string;
  wordCount: number;
  /** Offsets in the book text, used to keep progress when cards are re-cut. */
  start: number;
  end: number;
}

export interface BuiltChapter {
  number: number;
  title: string;
  cards: BuiltCard[];
}

export interface BuildInput {
  bookId: string;
  blocks: Block[];
  chapters: PlannedChapter[];
  cardLength: CardLength;
  lang?: string;
}

/** Card ids depend only on the book and where the card starts in its text. */
export function cardId(bookId: string, start: number): string {
  return `${bookId}-${start.toString(36)}`;
}

export function buildChapters({ bookId, blocks, chapters, cardLength, lang }: BuildInput): BuiltChapter[] {
  const offsets = blockOffsets(blocks);
  const totalLength = Math.max(1, bookText(blocks).length);
  const rules = LENGTH_RULES[cardLength];
  const out: BuiltChapter[] = [];
  let number = 1;

  for (const plan of chapters) {
    const drafts = segmentChapter(blocks, offsets, plan, { rules, lang });
    if (drafts.length === 0) continue; // a chapter with no text produces no cards and is dropped
    const chapterNumber = out.length + 1;
    out.push({
      number: chapterNumber,
      title: plan.title,
      cards: drafts.map((d) => ({
        id: cardId(bookId, d.start),
        bookId,
        chapterNumber,
        number: number++,
        page: d.page,
        location: d.page === null ? `${Math.floor((d.start / totalLength) * 100)}%` : null,
        title: d.title,
        text: d.text,
        wordCount: d.wordCount,
        start: d.start,
        end: d.end,
      })),
    });
  }
  return out;
}
