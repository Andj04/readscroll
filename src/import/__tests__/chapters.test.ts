import { describe, expect, it } from 'vitest';
import { chaptersFromStarts, detectChapters, OPENING_TITLE } from '../chapters';
import type { Block, Extracted } from '../types';
import { paragraph } from './fixtures';

const P = (n = 3, o = 0): Block => ({ kind: 'paragraph', text: paragraph(n, o), page: null });
const H = (text: string, level = 1, chapterLike = false): Block => ({ kind: 'heading', text, level, page: null, chapterLike });
const ex = (blocks: Block[], toc: Extracted['toc'] = null, format: Extracted['format'] = 'epub'): Extracted => ({
  format,
  meta: { title: 'Book', author: null, language: 'en' },
  blocks,
  toc,
  warnings: [],
});

describe('detectChapters', () => {
  it('uses the table of contents first', () => {
    const blocks = [H('One'), P(), H('Two'), P(), H('Sub', 2), P()];
    const r = detectChapters(ex(blocks, [{ title: 'One', blockIndex: 0 }, { title: 'Two', blockIndex: 2 }]), 'Book');
    expect(r.method).toBe('toc');
    expect(r.chapters).toEqual([
      { title: 'One', start: 0, end: 2 },
      { title: 'Two', start: 2, end: 6 },
    ]);
  });

  it('calls it "outline" for PDFs', () => {
    const blocks = [P(), P(), P(), P()];
    const r = detectChapters(ex(blocks, [{ title: 'A', blockIndex: 0 }, { title: 'B', blockIndex: 2 }], 'pdf'), 'Book');
    expect(r.method).toBe('outline');
  });

  it('falls back to "Chapter N" headings', () => {
    const blocks = [H('Chapter 1', 2, true), P(), P(), H('A side note', 1), P(), H('Chapter 2', 2, true), P()];
    const r = detectChapters(ex(blocks), 'Book');
    expect(r.method).toBe('headings');
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
  });

  it('combines "Chapter 3" with the subtitle heading that follows it', () => {
    const blocks = [H('Chapter 1', 1, true), H('The Harbour', 2), P(), H('Chapter 2', 1, true), H('The Storm', 2), P()];
    const r = detectChapters(ex(blocks), 'Book');
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter 1: The Harbour', 'Chapter 2: The Storm']);
  });

  it('uses the top heading level when there is no chapter pattern', () => {
    const blocks = [H('Tides'), P(), P(), H('detail', 2), P(), H('Winds'), P(), P(), P()];
    const r = detectChapters(ex(blocks), 'Book');
    expect(r.chapters.map((c) => c.title)).toEqual(['Tides', 'Winds']);
  });

  it('rejects headings that are too frequent to be chapters', () => {
    const blocks = [H('a'), P(1), H('b'), P(1), H('c'), P(1)];
    const r = detectChapters(ex(blocks), 'Book');
    expect(r.method).toBe('none');
    expect(r.chapters).toEqual([{ title: 'Book', start: 0, end: 6 }]);
  });

  it('creates a single chapter when nothing reliable is found', () => {
    const r = detectChapters(ex([P(), P()]), 'Fallback title');
    expect(r).toEqual({ method: 'none', chapters: [{ title: 'Fallback title', start: 0, end: 2 }] });
  });
});

describe('chaptersFromStarts', () => {
  it('keeps a long opening before the first chapter as its own chapter', () => {
    const blocks = [P(5), H('Chapter 1', 1, true), P()];
    expect(chaptersFromStarts(blocks, [{ title: 'Chapter 1', blockIndex: 1 }])[0]).toEqual({ title: OPENING_TITLE, start: 0, end: 1 });
  });

  it('merges a very short opening (a title page) into the first chapter', () => {
    const blocks = [H('My Book'), H('Chapter 1', 1, true), P()];
    expect(chaptersFromStarts(blocks, [{ title: 'Chapter 1', blockIndex: 1 }])).toEqual([{ title: 'Chapter 1', start: 0, end: 3 }]);
  });

  it('merges a chapter with no text of its own into the next one ("Part I" page)', () => {
    const blocks = [H('Part I', 1, true), H('Chapter 1', 2, true), P(), H('Chapter 2', 2, true), P()];
    const out = chaptersFromStarts(blocks, [
      { title: 'Part I', blockIndex: 0 },
      { title: 'Chapter 1', blockIndex: 1 },
      { title: 'Chapter 2', blockIndex: 3 },
    ]);
    expect(out).toEqual([
      { title: 'Chapter 1', start: 0, end: 3 },
      { title: 'Chapter 2', start: 3, end: 5 },
    ]);
  });

  it('keeps very short chapters that do have text', () => {
    const blocks = [H('One'), { kind: 'paragraph', text: 'Yes.', page: null } as Block, H('Two'), P()];
    const out = chaptersFromStarts(blocks, [{ title: 'One', blockIndex: 0 }, { title: 'Two', blockIndex: 2 }]);
    expect(out).toHaveLength(2);
  });
});
