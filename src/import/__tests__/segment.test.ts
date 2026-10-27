import { describe, expect, it } from 'vitest';
import { buildChapters } from '../build';
import { blockOffsets, bookText, segmentChapter } from '../segment';
import { LENGTH_RULES, type Block, type CardDraft, type PlannedChapter } from '../types';
import { countWords, splitSentences } from '../textUtils';
import { EN_SENTENCES, FR_PARAGRAPH, paragraph } from './fixtures';

const medium = LENGTH_RULES.medium;
const P = (text: string): Block => ({ kind: 'paragraph', text, page: null });
const H = (text: string, level = 2): Block => ({ kind: 'heading', text, level, page: null });

function cut(blocks: Block[], chapter: Partial<PlannedChapter> = {}, rules = medium): CardDraft[] {
  return segmentChapter(blocks, blockOffsets(blocks), { title: 'Chapter', start: 0, end: blocks.length, ...chapter }, { rules, lang: 'en' });
}

/** Every card must end at the end of a sentence (never in the middle of one). */
function expectWholeSentences(blocks: Block[], cards: CardDraft[]) {
  const text = bookText(blocks);
  const sentenceEnds = new Set<number>();
  const offsets = blockOffsets(blocks);
  blocks.forEach((b, i) => {
    for (const s of splitSentences(b.text)) sentenceEnds.add(offsets[i] + s.end);
    let pos = 0;
    for (const line of b.text.split('\n')) {
      pos += line.length;
      sentenceEnds.add(offsets[i] + pos);
      pos += 1;
    }
  });
  for (const c of cards) {
    expect(sentenceEnds.has(c.end), `card ends mid-sentence: "…${text.slice(c.end - 30, c.end)}|"`).toBe(true);
  }
}

describe('segmentChapter', () => {
  it('cuts a long chapter into cards of 80 to 180 words', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => P(paragraph(3 + (i % 4), i)));
    const cards = cut(blocks);
    cards.slice(0, -1).forEach((c) => {
      expect(c.wordCount).toBeGreaterThanOrEqual(medium.softMin);
      expect(c.wordCount).toBeLessThanOrEqual(medium.hardMax);
    });
    const avg = cards.reduce((s, c) => s + c.wordCount, 0) / cards.length;
    expect(avg).toBeGreaterThanOrEqual(80);
    expect(avg).toBeLessThanOrEqual(150);
    expectWholeSentences(blocks, cards);
  });

  it('splits a very long paragraph at sentence boundaries into balanced cards', () => {
    const blocks = [P(paragraph(60))]; // about 700 words in one paragraph
    const cards = cut(blocks);
    expect(cards.length).toBeGreaterThanOrEqual(5);
    for (const c of cards) expect(c.wordCount).toBeLessThanOrEqual(medium.hardMax);
    const counts = cards.map((c) => c.wordCount);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThan(60); // balanced, no tiny leftover
    expectWholeSentences(blocks, cards);
  });

  it('merges short paragraphs into one card', () => {
    const blocks = [P(EN_SENTENCES[0]), P(EN_SENTENCES[1]), P(EN_SENTENCES[2]), P(EN_SENTENCES[3])];
    const cards = cut(blocks);
    expect(cards).toHaveLength(1);
    expect(cards[0].text.split('\n\n')).toHaveLength(4); // paragraph breaks are kept inside the card
  });

  it('keeps a heading attached to the paragraph after it, as the card title', () => {
    const blocks = [P(paragraph(8)), H('The Storm'), P(paragraph(8, 3))];
    const cards = cut(blocks);
    const withTitle = cards.find((c) => c.title === 'The Storm');
    expect(withTitle).toBeDefined();
    expect(withTitle!.text.startsWith(EN_SENTENCES[3])).toBe(true);
    expect(cards.some((c) => c.text.includes('The Storm'))).toBe(false);
  });

  it('skips the heading that repeats the chapter title', () => {
    const blocks = [H('Chapter 1: The Harbour', 1), P(paragraph(3))];
    const cards = cut(blocks, { title: 'Chapter 1: The Harbour' });
    expect(cards[0].title).toBeNull();
  });

  it('keeps a list together when it fits', () => {
    const list: Block = { kind: 'list', text: '• a rope\n• a lantern\n• a map of the bay\n• bread for two days', page: null };
    const blocks = [P(paragraph(6)), list, P(paragraph(2, 4))];
    const cards = cut(blocks);
    const holder = cards.filter((c) => c.text.includes('• a'));
    expect(holder).toHaveLength(1);
    expect(holder[0].text).toContain('• a rope\n• a lantern\n• a map of the bay\n• bread for two days');
  });

  it('splits a list that is too long between items, never inside one', () => {
    const items = Array.from({ length: 30 }, (_, i) => `• Item ${i + 1}: ${EN_SENTENCES[i % 10]}`);
    const blocks: Block[] = [{ kind: 'list', text: items.join('\n'), page: null }];
    const cards = cut(blocks);
    expect(cards.length).toBeGreaterThan(1);
    for (const c of cards) for (const line of c.text.split('\n')) expect(items).toContain(line);
  });

  it('keeps a quote together when it fits', () => {
    const quote: Block = { kind: 'quote', text: 'Keep the lamp lit.\nWatch the water.', page: null };
    const cards = cut([P(paragraph(4)), quote]);
    expect(cards).toHaveLength(1);
    expect(cards[0].text).toContain('Keep the lamp lit.\nWatch the water.');
  });

  it('allows the last card of a short chapter to be short', () => {
    const cards = cut([P('Yes.')]);
    expect(cards).toEqual([expect.objectContaining({ text: 'Yes.', wordCount: 1 })]);
  });

  it('merges a short last card into the previous one when it fits', () => {
    const blocks = [P(paragraph(9)), P('The end.')];
    const cards = cut(blocks);
    expect(cards).toHaveLength(1);
  });

  it('keeps a single sentence longer than the maximum whole', () => {
    const long = 'The ' + Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ') + ' ended.';
    const cards = cut([P(long)]);
    expect(cards).toHaveLength(1);
    expect(cards[0].text).toBe(long);
  });

  it('handles dialogue, abbreviations and decimals without cutting inside sentences', () => {
    const dialogue = Array.from({ length: 12 }, (_, i) => `"Is it ${i}.5 metres deep, Dr. Moreau?" asked Mrs. Alder. "It is," he said.`).join(' ');
    const blocks = [P(dialogue)];
    const cards = cut(blocks);
    expectWholeSentences(blocks, cards);
    for (const c of cards) expect(c.text.startsWith('"Is it')).toBe(true);
  });

  it('works with accented text', () => {
    const blocks = Array.from({ length: 6 }, () => P(FR_PARAGRAPH));
    const cards = segmentChapter(blocks, blockOffsets(blocks), { title: 'Chapitre', start: 0, end: 6 }, { rules: medium, lang: 'fr' });
    expect(cards.length).toBeGreaterThan(1);
    expect(cards[0].text.startsWith("L'été dernier")).toBe(true);
    for (const c of cards) expect(c.wordCount).toBe(countWords(c.text, 'fr'));
  });

  it('respects the short and long settings', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => P(paragraph(4, i)));
    const short = cut(blocks, {}, LENGTH_RULES.short);
    const long = cut(blocks, {}, LENGTH_RULES.long);
    expect(short.length).toBeGreaterThan(long.length);
    for (const c of short.slice(0, -1)) expect(c.wordCount).toBeLessThanOrEqual(LENGTH_RULES.short.hardMax);
    for (const c of long.slice(0, -1)) expect(c.wordCount).toBeLessThanOrEqual(LENGTH_RULES.long.hardMax);
  });

  it('gives offsets that point to the card text in the book text', () => {
    const blocks = [P(paragraph(20)), P(paragraph(3, 2))];
    const text = bookText(blocks);
    for (const c of cut(blocks)) {
      const firstSentence = c.text.split(/(?<=[.!?])\s/)[0];
      expect(text.slice(c.start).startsWith(firstSentence)).toBe(true);
      expect(c.end).toBeGreaterThan(c.start);
    }
  });

  it('returns only the first cards when a limit is given', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => P(paragraph(5, i)));
    const cards = segmentChapter(blocks, blockOffsets(blocks), { title: 'C', start: 0, end: 20 }, { rules: medium, limit: 2 });
    expect(cards).toHaveLength(2);
  });
});

describe('buildChapters', () => {
  it('numbers cards continuously across chapters, with stable ids and locations', () => {
    const blocks = [H('One', 1), P(paragraph(10)), H('Two', 1), P(paragraph(10, 5))];
    const input = {
      bookId: 'b-test',
      blocks,
      chapters: [
        { title: 'One', start: 0, end: 2 },
        { title: 'Two', start: 2, end: 4 },
      ],
      cardLength: 'medium' as const,
    };
    const chapters = buildChapters(input);
    const cards = chapters.flatMap((c) => c.cards);
    expect(cards.map((c) => c.number)).toEqual(cards.map((_, i) => i + 1));
    expect(chapters.map((c) => c.number)).toEqual([1, 2]);
    expect(cards[0].location).toBe('0%');
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    // Same input -> same ids (stable).
    expect(buildChapters(input).flatMap((c) => c.cards).map((c) => c.id)).toEqual(cards.map((c) => c.id));
  });

  it('drops chapters with no text', () => {
    const blocks = [H('Empty', 1), H('Full', 1), P(paragraph(3))];
    const chapters = buildChapters({
      bookId: 'b',
      blocks,
      chapters: [
        { title: 'Empty', start: 0, end: 1 },
        { title: 'Full', start: 1, end: 3 },
      ],
      cardLength: 'medium',
    });
    expect(chapters.map((c) => c.title)).toEqual(['Full']);
    expect(chapters[0].number).toBe(1);
  });
});
