import { db, DEFAULT_SETTINGS, type CardStatus, type Settings } from './db';
import type { BookFile } from './schema';

// All writes to the local database go through these functions.

/** Stores a validated book. Re-importing the same book id replaces the file but keeps progress. */
export async function saveBook(file: BookFile): Promise<{ replaced: boolean }> {
  const existing = await db.books.get(file.book.id);
  await db.books.put({
    id: file.book.id,
    file,
    totalCards: file.chapters.reduce((n, ch) => n + ch.cards.length, 0),
    importedAt: Date.now(),
  });
  return { replaced: existing !== undefined };
}

/**
 * Marks cards as read because the reader moved past them.
 * Skips cards already read, and cards the user explicitly marked unread.
 */
export async function markPassedCards(bookId: string, cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;
  await db.transaction('rw', db.cardStatus, async () => {
    const existing = await db.cardStatus.bulkGet(cardIds.map((id) => [bookId, id] as [string, string]));
    const now = Date.now();
    const updates: CardStatus[] = [];
    cardIds.forEach((cardId, i) => {
      const s = existing[i];
      if (s?.read) return;
      if (s?.manual && !s.read) return; // manual "unread" wins over automatic marking
      updates.push({ bookId, cardId, read: true, manual: false, updatedAt: now });
    });
    await db.cardStatus.bulkPut(updates);
  });
}

/** Manual read/unread for one or more cards (toggle, mark chapter, mark everything before). */
export async function setCardsRead(bookId: string, cardIds: string[], read: boolean): Promise<void> {
  if (cardIds.length === 0) return;
  const now = Date.now();
  await db.cardStatus.bulkPut(cardIds.map((cardId) => ({ bookId, cardId, read, manual: true, updatedAt: now })));
}

export async function savePosition(bookId: string, cardId: string): Promise<void> {
  await db.positions.put({ bookId, cardId, updatedAt: Date.now() });
}

export async function toggleBookmark(bookId: string, cardId: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.bookmarks, async () => {
    const existing = await db.bookmarks.get([bookId, cardId]);
    if (existing && !existing.deleted) {
      await db.bookmarks.put({ ...existing, deleted: true, updatedAt: now });
    } else {
      await db.bookmarks.put({ bookId, cardId, createdAt: now, deleted: false, updatedAt: now });
    }
  });
}

export async function updateSettings(change: Partial<Omit<Settings, 'id' | 'updatedAt'>>): Promise<void> {
  // Read and write in one transaction, so two quick changes cannot overwrite each other.
  await db.transaction('rw', db.settings, async () => {
    const current = (await db.settings.get('local')) ?? DEFAULT_SETTINGS;
    await db.settings.put({ ...current, ...change, id: 'local', updatedAt: Date.now() });
  });
}
