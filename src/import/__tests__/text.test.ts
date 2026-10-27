import { describe, expect, it } from 'vitest';
import { decodeText, extractText } from '../text';
import { detectFormat, parseBook } from '../extract';
import { computeBookId } from '../identity';
import { ImportError } from '../types';
import { paragraph } from './fixtures';

const enc = (s: string) => new TextEncoder().encode(s);

describe('decodeText', () => {
  it('reads UTF-8 and removes the BOM', () => {
    expect(decodeText(enc('﻿Été'))).toBe('Été');
  });
  it('falls back to Windows-1252 for old files', () => {
    expect(decodeText(new Uint8Array([0x45, 0x74, 0xe9]))).toBe('Eté');
  });
  it('rejects binary files', () => {
    expect(() => decodeText(new Uint8Array([1, 0, 2]))).toThrow(ImportError);
  });
});

describe('extractText', () => {
  it('reads paragraphs separated by blank lines and rejoins hard-wrapped lines', () => {
    const ex = extractText(enc('First line of a para-\ngraph that wraps.\n\nSecond paragraph.\n'));
    expect(ex.blocks.map((b) => b.text)).toEqual(['First line of a paragraph that wraps.', 'Second paragraph.']);
  });

  it('recognizes markdown headings, chapter lines, lists and quotes', () => {
    const src = ['# The Harbour Book', 'CHAPTER I', 'Some text.', '- one\n- two\n- three', '> A quoted line\n> that continues.', 'THE STORM', 'More text.'].join('\n\n');
    const ex = extractText(enc(src));
    expect(ex.blocks.map((b) => b.kind)).toEqual(['heading', 'heading', 'paragraph', 'list', 'quote', 'heading', 'paragraph']);
    expect(ex.blocks[1].chapterLike).toBe(true);
    expect(ex.blocks[3].text).toBe('- one\n- two\n- three');
    expect(ex.blocks[4].text).toBe('A quoted line that continues.');
    expect(ex.meta.title).toBe('The Harbour Book');
  });

  it('treats each line as a paragraph when there are no blank lines', () => {
    const ex = extractText(enc('Line one.\nLine two.\nLine three.'));
    expect(ex.blocks).toHaveLength(3);
  });

  it('rejects an empty file', () => {
    expect(() => extractText(enc('  \n\n  '))).toThrow(/empty/);
  });
});

describe('detectFormat', () => {
  it('recognizes files by their content', () => {
    expect(detectFormat(enc('%PDF-1.7 ...'), 'x.bin')).toBe('pdf');
    expect(detectFormat(enc('plain words'), 'notes')).toBe('text');
    expect(() => detectFormat(new Uint8Array([0x50, 0x4b, 3, 4]), 'archive.zip')).toThrow(/not an EPUB/);
    expect(() => detectFormat(new Uint8Array([1, 2, 0, 4]), 'image.png')).toThrow(/not supported/);
    expect(() => detectFormat(enc('garbage'), 'book.pdf')).toThrow(/damaged/);
  });
});

describe('parseBook (plain text)', () => {
  it('detects chapters and computes an id', async () => {
    const src = ['Chapter 1', paragraph(5), paragraph(4, 2), 'Chapter 2', paragraph(6, 4)].join('\n\n');
    const book = await parseBook(enc(src), 'harbour.txt');
    expect(book.method).toBe('headings');
    expect(book.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(book.bookId).toMatch(/^b-[0-9a-f]{32}$/);
  });

  it('gives an empty file a clear error', async () => {
    await expect(parseBook(new Uint8Array(), 'empty.txt')).rejects.toMatchObject({ code: 'empty' });
  });
});

describe('computeBookId', () => {
  const blocks = (t: string) => [{ kind: 'paragraph' as const, text: t, page: null }];
  const meta = { title: 'Harbour', author: 'A. Writer', language: null };

  it('is the same for the same text, whatever the spacing or letter case', async () => {
    expect(await computeBookId(meta, blocks('The  tide came in.'))).toBe(await computeBookId({ ...meta, title: 'HARBOUR' }, blocks('the tide came in.')));
  });
  it('changes when the text or the author changes', async () => {
    const a = await computeBookId(meta, blocks('The tide came in.'));
    expect(await computeBookId(meta, blocks('The tide went out.'))).not.toBe(a);
    expect(await computeBookId({ ...meta, author: 'Someone Else' }, blocks('The tide came in.'))).not.toBe(a);
  });
});
