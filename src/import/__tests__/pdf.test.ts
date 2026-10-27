import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBook } from '../extract';
import { extractPdf } from '../pdf';

// The PDFs are generated from original text by scripts/make-test-files.mjs.
const file = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-files/${name}`, import.meta.url)));

describe('extractPdf', () => {
  it('extracts clean paragraphs without headers, footers or page numbers', async () => {
    const ex = await extractPdf(file('harbour.pdf'));
    const all = ex.blocks.map((b) => b.text).join('\n');
    expect(all).not.toMatch(/^Harbour Stories$/m); // running header
    expect(all).not.toMatch(/^\d+$/m); // page numbers
    expect(all).toContain('Dr. Moreau, who kept the lighthouse, counted the vessels as they left.');
    // No word is left cut by a hyphen at the end of a line.
    expect(all).not.toMatch(/\p{Ll}[-\u2010] \p{Ll}/u);
    expect(all).toContain('The boat was finally launched');
    expect(ex.blocks.every((b) => b.page !== null && b.page >= 1)).toBe(true);
  });

  it('keeps paragraphs whole across lines and pages', async () => {
    const ex = await extractPdf(file('harbour.pdf'));
    const paragraphs = ex.blocks.filter((b) => b.kind === 'paragraph');
    // The source has 12 paragraphs. Every paragraph ends at the end of a sentence.
    expect(paragraphs.length).toBe(12);
    for (const p of paragraphs) expect(p.text).toMatch(/[.!?"]$/);
  });

  it('extracts exactly the source text (nothing rewritten, nothing lost)', async () => {
    // harbour.txt holds the same paragraphs as harbour.pdf.
    const source = new TextDecoder()
      .decode(file('harbour.txt'))
      .split('\n\n')
      .filter((p) => p.trim() && !p.startsWith('#') && !/^Chapter \d+$/.test(p.trim()))
      .map((p) => p.trim());
    const ex = await extractPdf(file('harbour.pdf'));
    expect(ex.blocks.filter((b) => b.kind === 'paragraph').map((b) => b.text)).toEqual(source);
  });

  it('uses the PDF outline for chapters', async () => {
    const book = await parseBook(file('harbour.pdf'), 'harbour.pdf');
    expect(book.method).toBe('outline');
    expect(book.chapters.map((c) => c.title)).toEqual(['The Harbour', 'The Storm', 'The Launch']);
  });

  it('falls back to big headings when there is no outline', async () => {
    const book = await parseBook(file('harbour-no-outline.pdf'), 'harbour.pdf');
    expect(book.method).toBe('headings');
    expect(book.chapters.map((c) => c.title)).toEqual(['The Harbour', 'The Storm', 'The Launch']);
  });

  it('gives the same book id with or without outline (same text)', async () => {
    const a = await parseBook(file('harbour.pdf'), 'a.pdf');
    const b = await parseBook(file('harbour-no-outline.pdf'), 'b.pdf');
    expect(a.bookId).toBe(b.bookId);
  });

  it('warns about pages with two columns', async () => {
    const ex = await extractPdf(file('two-columns.pdf'));
    expect(ex.warnings.some((w) => w.page !== null && /reading order/.test(w.message))).toBe(true);
  });

  it('detects scanned PDFs with no text layer', async () => {
    await expect(extractPdf(file('scanned.pdf'))).rejects.toMatchObject({ code: 'scanned' });
  });

  it('reports a damaged PDF', async () => {
    await expect(parseBook(file('damaged.pdf'), 'damaged.pdf')).rejects.toMatchObject({ code: 'corrupt' });
  });
});
