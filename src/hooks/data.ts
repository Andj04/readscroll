import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, DEFAULT_SETTINGS, type StoredBook } from '../lib/db';
import { toStatusMap, type StatusMap } from '../lib/progress';

// React hooks that read from IndexedDB and re-render when the data changes.

/** undefined while loading, null if the book is not on this device. */
export function useBook(bookId: string): StoredBook | null | undefined {
  return useLiveQuery(async () => (await db.books.get(bookId)) ?? null, [bookId]);
}

export function useStatusMap(bookId: string): StatusMap {
  const statuses = useLiveQuery(() => db.cardStatus.where('bookId').equals(bookId).toArray(), [bookId]);
  return useMemo(() => toStatusMap(statuses ?? []), [statuses]);
}

export function usePosition(bookId: string) {
  return useLiveQuery(() => db.positions.get(bookId), [bookId]);
}

/** Card ids of the active (not deleted) bookmarks of a book. */
export function useBookmarkedIds(bookId: string): Set<string> {
  const rows = useLiveQuery(() => db.bookmarks.where('bookId').equals(bookId).toArray(), [bookId]);
  return useMemo(() => new Set((rows ?? []).filter((b) => !b.deleted).map((b) => b.cardId)), [rows]);
}

export function useSettings() {
  return useLiveQuery(() => db.settings.get('local')) ?? DEFAULT_SETTINGS;
}
