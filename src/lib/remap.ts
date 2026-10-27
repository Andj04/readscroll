import type { Bookmark, CardStatus, Position } from './db';
import type { Card } from './model';

// Moves progress from old cards to new cards by position in the book text.
// Used when a book is re-cut (another card length, other chapter edits) or imported again,
// and later by sync when another device cut the same book differently.

export interface Span {
  start: number;
  end: number;
}

/** Characters of [a] covered by [b]. */
function overlap(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * A new card is read when more than half of its text was in old cards marked read.
 * A manual "unread" covering more than half of it is kept as a manual unread.
 */
export function remapStatuses(old: (CardStatus & Span)[], newCards: Card[], now = Date.now()): (CardStatus & Span)[] {
  const out: (CardStatus & Span)[] = [];
  for (const card of newCards) {
    const length = Math.max(1, card.end - card.start);
    let read = 0;
    let unread = 0;
    let manualRead = false;
    for (const s of old) {
      const o = overlap(card, s);
      if (o === 0) continue;
      if (s.read) {
        read += o;
        manualRead ||= s.manual;
      } else if (s.manual) {
        unread += o;
      }
    }
    const base = { bookId: card.bookId, cardId: card.id, start: card.start, end: card.end, updatedAt: now };
    if (read * 2 > length) out.push({ ...base, read: true, manual: manualRead });
    else if (unread * 2 > length) out.push({ ...base, read: false, manual: true });
  }
  return out;
}

/** The new card that contains a text offset (or the first card after it, or the last card). */
export function cardAtOffset(offset: number, cards: Card[]): Card | undefined {
  return cards.find((c) => offset >= c.start && offset < Math.max(c.end, c.start + 1)) ?? cards.find((c) => c.start >= offset) ?? cards[cards.length - 1];
}

export function remapPosition(old: (Position & Partial<Span>) | undefined, newCards: Card[]): Position | undefined {
  if (!old || old.start === undefined) return undefined;
  const card = cardAtOffset(old.start, newCards);
  return card ? { bookId: card.bookId, cardId: card.id, updatedAt: old.updatedAt } : undefined;
}

export function remapBookmarks(old: (Bookmark & Partial<Span>)[], newCards: Card[]): Bookmark[] {
  const byCard = new Map<string, Bookmark>();
  for (const b of old) {
    if (b.start === undefined) continue;
    const card = cardAtOffset(b.start, newCards);
    if (!card) continue;
    const prev = byCard.get(card.id);
    // Two old bookmarks can land on the same new card: an active one wins over a deleted one.
    if (!prev || (prev.deleted && !b.deleted)) byCard.set(card.id, { ...b, bookId: card.bookId, cardId: card.id, start: card.start, end: card.end } as Bookmark);
  }
  return [...byCard.values()];
}
