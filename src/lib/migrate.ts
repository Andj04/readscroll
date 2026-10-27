import { blockOffsets } from '../import/segment';
import type { Block, PlannedChapter } from '../import/types';
import { countWords } from '../import/textUtils';
import type { BookSource, Card, Chapter, LegacyStoredBook, StoredBook } from './model';

// Database version 2 migration: books stored in the old JSON shape get the new shape.
//
// - Card ids, numbers, pages, titles and text are kept exactly, so read marks,
//   reading position and bookmarks keep pointing to the same cards.
// - Each card gets its word count and its offsets in a rebuilt book text,
//   and the book gets a "source" (blocks + chapter plan) so it can be re-cut later.
// - The book id is kept: it is marked 'legacy' because it is not a content hash.

export function migrateLegacyBook(old: LegacyStoredBook): { book: StoredBook; source: BookSource } {
  const blocks: Block[] = [];
  const plan: PlannedChapter[] = [];
  // Card -> range of its blocks, filled while building the blocks.
  const cardBlocks: { first: number; last: number }[][] = [];

  for (const ch of old.file.chapters) {
    const start = blocks.length;
    blocks.push({ kind: 'heading', text: ch.title, level: 1, page: ch.cards[0]?.page ?? null });
    const ranges: { first: number; last: number }[] = [];
    for (const c of ch.cards) {
      const first = blocks.length;
      if (c.title) blocks.push({ kind: 'heading', text: c.title, level: 2, page: c.page });
      for (const para of c.text.split(/\n{2,}/)) if (para.trim()) blocks.push({ kind: 'paragraph', text: para, page: c.page });
      ranges.push({ first, last: blocks.length - 1 });
    }
    cardBlocks.push(ranges);
    plan.push({ title: ch.title, start, end: blocks.length });
  }

  const offsets = blockOffsets(blocks);
  const chapters: Chapter[] = old.file.chapters.map((ch, ci) => ({
    number: ch.number,
    title: ch.title,
    ...(ch.quiz ? { quiz: ch.quiz } : {}),
    cards: ch.cards.map((c, k): Card => {
      const { first, last } = cardBlocks[ci][k];
      return {
        id: c.id,
        bookId: old.id,
        chapterNumber: ch.number,
        number: c.number,
        page: c.page,
        location: null,
        title: c.title,
        text: c.text,
        wordCount: countWords(c.text),
        start: offsets[first],
        end: offsets[last] + blocks[last].text.length,
        ...(c.mood !== undefined ? { mood: c.mood } : {}),
      };
    }),
  }));

  return {
    book: {
      id: old.id,
      title: old.file.book.title,
      author: old.file.book.author,
      language: old.file.book.language || null,
      identity: 'legacy',
      format: 'json',
      chapters,
      totalCards: old.totalCards,
      cardLength: 'medium',
      importedAt: old.importedAt,
    },
    source: { bookId: old.id, blocks, plan, lang: old.file.book.language || null },
  };
}

export function isLegacyBook(b: unknown): b is LegacyStoredBook {
  return typeof b === 'object' && b !== null && 'file' in b;
}
