import type { Block, CardLength, PlannedChapter, SourceFormat } from '../import/types';

// Book data model used by the app.
// Book text stays on this device. Only progress (read marks, position, bookmarks)
// and small book references (id, title, author) are meant to be synced.

export type { CardLength };

export interface Card {
  /** Stable id: book id + where the card starts in the book text. Legacy books keep their old ids. */
  id: string;
  bookId: string;
  chapterNumber: number;
  /** Continuous across the book: 1, 2, 3... */
  number: number;
  /** PDF page (or the page given by an old JSON book). null for EPUB and plain text. */
  page: number | null;
  /** Position for formats without pages, e.g. "12%". */
  location: string | null;
  title: string | null;
  text: string;
  wordCount: number;
  /** Offsets in the book text. Used to move progress onto new cards when a book is re-cut. */
  start: number;
  end: number;
  /** Kept from old JSON books, not used yet. */
  mood?: unknown;
}

export interface Chapter {
  number: number;
  title: string;
  cards: Card[];
  /** Kept from old JSON books, not used yet. */
  quiz?: unknown[];
}

export interface StoredBook {
  id: string;
  title: string;
  author: string;
  language: string | null;
  /** 'content': id is a hash of the text (matches across devices). 'legacy': id from an old JSON file. */
  identity: 'content' | 'legacy';
  format: SourceFormat | 'json';
  chapters: Chapter[];
  totalCards: number;
  cardLength: CardLength;
  importedAt: number;
}

/**
 * The cleaned text of a book and its reviewed chapter plan, kept on this device
 * so the book can be re-cut with another card length. Never synced.
 */
export interface BookSource {
  bookId: string;
  blocks: Block[];
  plan: PlannedChapter[];
  lang: string | null;
}

/**
 * A small reference to a book: what another device needs to show "needs import"
 * and to link progress once the same book is imported. No book text in it.
 */
export interface BookRef {
  bookId: string;
  title: string;
  author: string;
  totalCards: number;
  updatedAt: number;
}

/** Old shape of a stored book (imported from a JSON file), before version 2 of the database. */
export interface LegacyStoredBook {
  id: string;
  file: {
    book: { id: string; title: string; author: string; language: string };
    chapters: {
      number: number;
      title: string;
      quiz?: unknown[];
      cards: { id: string; number: number; page: number; title: string | null; text: string; mood?: unknown }[];
    }[];
  };
  totalCards: number;
  importedAt: number;
}
