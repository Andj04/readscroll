import { describe, expect, it } from 'vitest';
import { buildChapters } from '../../import/build';
import type { Block } from '../../import/types';
import { paragraph } from '../../import/__tests__/fixtures';
import { migrateLegacyBook } from '../migrate';
import type { Card, LegacyStoredBook } from '../model';
import { cardAtOffset, remapBookmarks, remapPosition, remapStatuses } from '../remap';
import { bookText } from '../../import/segment';

const blocks: Block[] = Array.from({ length: 16 }, (_, i) => ({ kind: 'paragraph', text: paragraph(3 + (i % 3), i), page: null }));
const plan = [{ title: 'All', start: 0, end: blocks.length }];
const cut = (len: 'short' | 'medium' | 'long'): Card[] =>
  buildChapters({ bookId: 'b-x', blocks, chapters: plan, cardLength: len }).flatMap((c) => c.cards);

describe('remapStatuses', () => {
  it('keeps read progress when re-cutting from medium to short cards', () => {
    const medium = cut('medium');
    const short = cut('short');
    // The first half of the medium cards was read.
    const half = Math.floor(medium.length / 2);
    const old = medium.slice(0, half).map((c) => ({ bookId: 'b-x', cardId: c.id, read: true, manual: false, updatedAt: 1, start: c.start, end: c.end }));
    const mapped = remapStatuses(old, short);
    const readUntil = medium[half - 1].end;
    for (const c of short) {
      const isRead = mapped.some((s) => s.cardId === c.id && s.read);
      expect(isRead).toBe(c.end <= readUntil);
    }
  });

  it('keeps a manual "unread" mark', () => {
    const medium = cut('medium');
    const old = medium.map((c, i) => ({ bookId: 'b-x', cardId: c.id, read: i !== 0, manual: i === 0, updatedAt: 1, start: c.start, end: c.end }));
    // The first short card lies inside the first medium card, which was marked unread by hand.
    const shortCards = cut('short');
    const back = remapStatuses(old, shortCards);
    expect(back.find((s) => s.cardId === shortCards[0].id)).toMatchObject({ read: false, manual: true });
  });

  it('is the identity when the cut does not change', () => {
    const cards = cut('medium');
    const old = cards.map((c, i) => ({ bookId: 'b-x', cardId: c.id, read: i % 2 === 0, manual: false, updatedAt: 1, start: c.start, end: c.end }));
    const mapped = remapStatuses(old, cards);
    expect(mapped.map((s) => s.cardId)).toEqual(cards.filter((_, i) => i % 2 === 0).map((c) => c.id));
  });
});

describe('position and bookmarks', () => {
  it('moves the reading position and bookmarks to the card containing the same text', () => {
    const medium = cut('medium');
    const short = cut('short');
    const target = medium[3];
    const pos = remapPosition({ bookId: 'b-x', cardId: target.id, updatedAt: 5, start: target.start }, short)!;
    const card = short.find((c) => c.id === pos.cardId)!;
    expect(card.start <= target.start && target.start < card.end).toBe(true);

    const bms = remapBookmarks(
      [
        { bookId: 'b-x', cardId: medium[1].id, createdAt: 1, deleted: false, updatedAt: 1, start: medium[1].start },
        { bookId: 'b-x', cardId: medium[2].id, createdAt: 1, deleted: true, updatedAt: 1, start: medium[2].start },
      ],
      short,
    );
    expect(bms).toHaveLength(2);
    expect(bms.find((b) => !b.deleted)!.cardId).toBe(cardAtOffset(medium[1].start, short)!.id);
  });
});

describe('migrateLegacyBook', () => {
  const legacy: LegacyStoredBook = {
    id: 'sample-statistics',
    totalCards: 3,
    importedAt: 100,
    file: {
      book: { id: 'sample-statistics', title: 'Sample', author: 'Someone', language: 'en' },
      chapters: [
        { number: 1, title: 'Data', quiz: [], cards: [
          { id: 'c1', number: 1, page: 12, title: null, text: 'First card text.', mood: null },
          { id: 'c2', number: 2, page: 12, title: 'Two kinds', text: 'Second card.\n\nWith two paragraphs.', mood: null },
        ] },
        { number: 2, title: 'Spread', cards: [{ id: 'c3', number: 3, page: 14, title: null, text: 'Third card.' }] },
      ],
    },
  };

  it('keeps ids, numbers, pages and text, and adds word counts and text offsets', () => {
    const { book, source } = migrateLegacyBook(legacy);
    const cards = book.chapters.flatMap((c) => c.cards);
    expect(book).toMatchObject({ id: 'sample-statistics', title: 'Sample', identity: 'legacy', format: 'json', totalCards: 3 });
    expect(cards.map((c) => [c.id, c.number, c.page, c.title, c.chapterNumber])).toEqual([
      ['c1', 1, 12, null, 1],
      ['c2', 2, 12, 'Two kinds', 1],
      ['c3', 3, 14, null, 2],
    ]);
    expect(cards.map((c) => c.wordCount)).toEqual([3, 5, 2]);
    // Offsets point at the card in the rebuilt text.
    const text = bookText(source.blocks);
    expect(text.slice(cards[0].start, cards[0].end)).toBe('First card text.');
    expect(text.slice(cards[1].start, cards[1].end)).toBe('Two kinds\n\nSecond card.\n\nWith two paragraphs.');
    expect(source.plan.map((p) => p.title)).toEqual(['Data', 'Spread']);
    expect(book.chapters[0].quiz).toEqual([]);
    expect(cards[0].mood).toBeNull();
  });

  it('produces a source that can be re-cut', () => {
    const { source } = migrateLegacyBook(legacy);
    const chapters = buildChapters({ bookId: 'sample-statistics', blocks: source.blocks, chapters: source.plan, cardLength: 'medium' });
    expect(chapters.map((c) => c.title)).toEqual(['Data', 'Spread']);
    expect(chapters[0].cards[0].text.startsWith('First card text.')).toBe(true);
  });
});
