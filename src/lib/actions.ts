import { db, DEFAULT_SETTINGS, type Bookmark, type CardStatus, type Position, type Settings } from './db';
import type { BookSource, StoredBook } from './model';
import { remapBookmarks, remapPosition, remapStatuses, type Span } from './remap';

// All writes to the local database go through these functions.

// ---------- Text positions of cards ----------
// Progress records also store where their card sits in the book text (start/end),
// so they can be moved onto new cards later. The reading screens only pass card ids,
// so the positions are looked up here, with a small cache per book.

const spanCache = new Map<string, Map<string, Span>>();

async function spansOf(bookId: string): Promise<Map<string, Span>> {
  let spans = spanCache.get(bookId);
  if (!spans) {
    const book = await db.books.get(bookId);
    spans = new Map((book?.chapters ?? []).flatMap((ch) => ch.cards.map((c) => [c.id, { start: c.start, end: c.end }] as const)));
    spanCache.set(bookId, spans);
  }
  return spans;
}

/**
 * Marks cards as read because the reader moved past them.
 * Skips cards already read, and cards the user explicitly marked unread.
 */
export async function markPassedCards(bookId: string, cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;
  const spans = await spansOf(bookId);
  await db.transaction('rw', db.cardStatus, async () => {
    const existing = await db.cardStatus.bulkGet(cardIds.map((id) => [bookId, id] as [string, string]));
    const now = Date.now();
    const updates: CardStatus[] = [];
    cardIds.forEach((cardId, i) => {
      const s = existing[i];
      if (s?.read) return;
      if (s?.manual && !s.read) return; // manual "unread" wins over automatic marking
      updates.push({ bookId, cardId, read: true, manual: false, updatedAt: now, ...spans.get(cardId) });
    });
    await db.cardStatus.bulkPut(updates);
  });
}

/** Manual read/unread for one or more cards (toggle, mark chapter, mark everything before). */
export async function setCardsRead(bookId: string, cardIds: string[], read: boolean): Promise<void> {
  if (cardIds.length === 0) return;
  const now = Date.now();
  const spans = await spansOf(bookId);
  await db.cardStatus.bulkPut(cardIds.map((cardId) => ({ bookId, cardId, read, manual: true, updatedAt: now, ...spans.get(cardId) })));
}

export async function savePosition(bookId: string, cardId: string): Promise<void> {
  const spans = await spansOf(bookId);
  await db.positions.put({ bookId, cardId, updatedAt: Date.now(), ...spans.get(cardId) });
}

export async function toggleBookmark(bookId: string, cardId: string): Promise<void> {
  const now = Date.now();
  const span = (await spansOf(bookId)).get(cardId);
  await db.transaction('rw', db.bookmarks, async () => {
    const existing = await db.bookmarks.get([bookId, cardId]);
    if (existing && !existing.deleted) {
      await db.bookmarks.put({ ...existing, deleted: true, updatedAt: now, ...span });
    } else {
      await db.bookmarks.put({ bookId, cardId, createdAt: now, deleted: false, updatedAt: now, ...span });
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

// ---------- Saving an imported (or re-cut) book ----------

/**
 * Saves a book, its source and its reference. If progress already exists for this
 * book id (same book imported before, re-cut, or progress synced from another device),
 * it is moved onto the new cards by position in the text.
 */
export async function saveImportedBook(book: StoredBook, source: BookSource): Promise<void> {
  const newCards = book.chapters.flatMap((ch) => ch.cards);
  await db.transaction('rw', [db.books, db.sources, db.bookRefs, db.cardStatus, db.positions, db.bookmarks], async () => {
    // Old card positions, for progress records saved before positions were stored.
    const oldBook = await db.books.get(book.id);
    const oldSpans = new Map((oldBook?.chapters ?? []).flatMap((ch) => ch.cards.map((c) => [c.id, { start: c.start, end: c.end }] as const)));
    const withSpan = <T extends { cardId: string; start?: number; end?: number }>(r: T): T => (r.start === undefined ? { ...r, ...oldSpans.get(r.cardId) } : r);

    const statuses = (await db.cardStatus.where('bookId').equals(book.id).toArray()).map(withSpan);
    const position = await db.positions.get(book.id);
    const bookmarks = (await db.bookmarks.where('bookId').equals(book.id).toArray()).map(withSpan);

    await db.cardStatus.where('bookId').equals(book.id).delete();
    await db.bookmarks.where('bookId').equals(book.id).delete();
    await db.cardStatus.bulkPut(remapStatuses(statuses.filter((s): s is CardStatus & Span => s.start !== undefined && s.end !== undefined), newCards));
    await db.bookmarks.bulkPut(remapBookmarks(bookmarks as (Bookmark & Partial<Span>)[], newCards));
    const pos = remapPosition(position ? withSpan(position) : undefined, newCards);
    if (pos) {
      const card = newCards.find((c) => c.id === pos.cardId)!;
      await db.positions.put({ ...pos, start: card.start, end: card.end } as Position);
    } else if (position) {
      await db.positions.delete(book.id);
    }

    await db.books.put(book);
    await db.sources.put(source);
    await db.bookRefs.put({ bookId: book.id, title: book.title, author: book.author, totalCards: book.totalCards, updatedAt: Date.now() });
  });
  spanCache.delete(book.id);
}
