import { Dexie, type Table } from 'dexie';
import { isLegacyBook, migrateLegacyBook } from './migrate';
import type { BookRef, BookSource, CardLength, StoredBook } from './model';

export type { StoredBook };

/**
 * Where a card sits in the book text. Stored with progress so it can be moved to
 * new cards when a book is re-cut, or matched with another device's cards later.
 */
interface TextSpan {
  start?: number;
  end?: number;
}

/**
 * Read status of one card.
 * `manual` is true when the user set it by hand. A manual "unread" is never
 * overwritten by automatic marking while reading.
 */
export interface CardStatus extends TextSpan {
  bookId: string;
  cardId: string;
  read: boolean;
  manual: boolean;
  updatedAt: number;
}

/** Last card the user was on, per book. */
export interface Position extends TextSpan {
  bookId: string;
  cardId: string;
  updatedAt: number;
}

/** Removing a bookmark only sets `deleted`, so the removal can be synced later. */
export interface Bookmark extends TextSpan {
  bookId: string;
  cardId: string;
  createdAt: number;
  deleted: boolean;
  updatedAt: number;
}

export type Theme = 'system' | 'light' | 'dark';
export type ReadingMode = 'vertical' | 'horizontal';

export interface Settings {
  id: 'local';
  fontSize: number;
  theme: Theme;
  readingMode: ReadingMode;
  /** Card length used for new imports. */
  cardLength?: CardLength;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'local',
  fontSize: 19,
  theme: 'system',
  readingMode: 'vertical',
  cardLength: 'medium',
  updatedAt: 0,
};

class ReadingDB extends Dexie {
  books!: Table<StoredBook, string>;
  cardStatus!: Table<CardStatus, [string, string]>;
  positions!: Table<Position, string>;
  bookmarks!: Table<Bookmark, [string, string]>;
  settings!: Table<Settings, string>;
  sources!: Table<BookSource, string>;
  bookRefs!: Table<BookRef, string>;

  constructor() {
    super('reading-cards');
    // Only indexed fields are listed here; other fields are stored too.
    this.version(1).stores({
      books: 'id',
      cardStatus: '[bookId+cardId], bookId',
      positions: 'bookId',
      bookmarks: '[bookId+cardId], bookId, createdAt',
      settings: 'id',
    });

    // Version 2: on-device import. Books get a new shape (see migrate.ts), plus two tables:
    // `sources` (cleaned text for re-cutting, never synced) and `bookRefs` (title/author only).
    // The upgrade runs once, automatically, the first time this version of the app opens.
    this.version(2)
      .stores({
        sources: 'bookId',
        bookRefs: 'bookId',
      })
      .upgrade(async (tx) => {
        const spans = new Map<string, { start: number; end: number }>(); // "bookId|cardId" -> span
        await tx
          .table('books')
          .toCollection()
          .modify((old, ref) => {
            if (!isLegacyBook(old)) return;
            const { book, source } = migrateLegacyBook(old);
            for (const c of book.chapters.flatMap((ch) => ch.cards)) spans.set(`${book.id}|${c.id}`, { start: c.start, end: c.end });
            tx.table('sources').put(source);
            tx.table('bookRefs').put({ bookId: book.id, title: book.title, author: book.author, totalCards: book.totalCards, updatedAt: Date.now() });
            ref.value = book;
          });
        // Progress records get the text position of their card.
        const addSpan = (row: { bookId: string; cardId: string; start?: number; end?: number }) => {
          const span = spans.get(`${row.bookId}|${row.cardId}`);
          if (span) Object.assign(row, span);
        };
        await tx.table('cardStatus').toCollection().modify(addSpan);
        await tx.table('positions').toCollection().modify(addSpan);
        await tx.table('bookmarks').toCollection().modify(addSpan);
      });
  }
}

export const db = new ReadingDB();
