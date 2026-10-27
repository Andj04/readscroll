import { Dexie, type Table } from 'dexie';
import type { BookFile } from './model';

/** A book stored on this device: the full validated file (quiz and mood included). */
export interface StoredBook {
  id: string;
  file: BookFile;
  totalCards: number;
  importedAt: number;
}

/**
 * Read status of one card.
 * `manual` is true when the user set it by hand. A manual "unread" is never
 * overwritten by automatic marking while reading.
 */
export interface CardStatus {
  bookId: string;
  cardId: string;
  read: boolean;
  manual: boolean;
  updatedAt: number;
}

/** Last card the user was on, per book. */
export interface Position {
  bookId: string;
  cardId: string;
  updatedAt: number;
}

/** Removing a bookmark only sets `deleted`, so the removal can be synced later. */
export interface Bookmark {
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
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'local',
  fontSize: 19,
  theme: 'system',
  readingMode: 'vertical',
  updatedAt: 0,
};

class ReadingDB extends Dexie {
  books!: Table<StoredBook, string>;
  cardStatus!: Table<CardStatus, [string, string]>;
  positions!: Table<Position, string>;
  bookmarks!: Table<Bookmark, [string, string]>;
  settings!: Table<Settings, string>;

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
  }
}

export const db = new ReadingDB();
