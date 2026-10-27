import type { BookFile, Card, Chapter } from './schema';
import type { CardStatus } from './db';

// Pure helpers to compute progress. No database access here.

export type StatusMap = Map<string, CardStatus>;

export function toStatusMap(statuses: CardStatus[]): StatusMap {
  return new Map(statuses.map((s) => [s.cardId, s]));
}

export function isRead(statuses: StatusMap, cardId: string): boolean {
  return statuses.get(cardId)?.read === true;
}

/** All cards of the book in order. Validation guarantees card n is at index n - 1. */
export function allCards(book: BookFile): Card[] {
  return book.chapters.flatMap((c) => c.cards);
}

export function countRead(cards: Card[], statuses: StatusMap): number {
  return cards.reduce((n, c) => n + (isRead(statuses, c.id) ? 1 : 0), 0);
}

export function percent(read: number, total: number): number {
  return total === 0 ? 0 : Math.round((read / total) * 100);
}

export function chapterOfCard(book: BookFile, cardNumber: number): Chapter | undefined {
  return book.chapters.find((ch) => ch.cards.some((c) => c.number === cardNumber));
}

/**
 * The "next unread" card: the first unread card at or after the reading
 * position, or else the first unread card of the book.
 */
export function nextUnreadCard(cards: Card[], statuses: StatusMap, fromNumber = 1): Card | undefined {
  return (
    cards.find((c) => c.number >= fromNumber && !isRead(statuses, c.id)) ??
    cards.find((c) => !isRead(statuses, c.id))
  );
}

export function cardRange(chapter: Chapter): string {
  const first = chapter.cards[0].number;
  const last = chapter.cards[chapter.cards.length - 1].number;
  return first === last ? `Card ${first}` : `Cards ${first}–${last}`;
}

export function chapterLabel(chapter: Chapter): string {
  return chapter.title ? `Chapter ${chapter.number} · ${chapter.title}` : `Chapter ${chapter.number}`;
}
