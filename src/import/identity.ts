import type { Block, Extracted } from './types';
import { bookText } from './segment';

// Stable book identity: the same book imported on two devices gets the same id,
// so synced progress can be attached to it.
//
// id = SHA-256 of (title + author read from the file) and the normalized text.
// Titles typed by the user in the review screen are NOT used, so renaming a book
// does not change its identity. Chapter edits and the card length do not change it either.

function normalizeForHash(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function computeBookId(meta: Extracted['meta'], blocks: Block[]): Promise<string> {
  const input = [normalizeForHash(meta.title ?? ''), normalizeForHash(meta.author ?? ''), normalizeForHash(bookText(blocks))].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `b-${hex.slice(0, 32)}`;
}
