import { ImportError, type Block, type Extracted } from './types';
import { isChapterLike, joinLines, normalizeText } from './textUtils';

// Plain text import (.txt, .md). Paragraphs are separated by blank lines.

/** UTF-8 first; if the bytes are not valid UTF-8, fall back to Windows-1252 (old Western files). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new ImportError('unsupported', 'This file is not a text file.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const BULLET_LINE = /^\s*([•●▪◦*+-]|\d{1,3}[.)])\s+/;

function paragraphToBlock(lines: string[]): Block | null {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  const first = trimmed[0];

  // Markdown heading: "# Title"
  const md = /^(#{1,6})\s+(.+?)\s*#*$/.exec(first);
  if (md && trimmed.length === 1) {
    const text = normalizeText(md[2]);
    return { kind: 'heading', text, level: md[1].length, page: null, chapterLike: isChapterLike(text) };
  }

  if (trimmed.length === 1 && first.length <= 80) {
    const text = normalizeText(first);
    if (isChapterLike(text)) return { kind: 'heading', text, level: 1, page: null, chapterLike: true };
    // A short line in capitals with no final period: "THE RIVER"
    if (/\p{Lu}{3}/u.test(text) && !/\p{Ll}/u.test(text) && !/[.,;]$/.test(text)) {
      return { kind: 'heading', text, level: 2, page: null, chapterLike: false };
    }
  }

  if (trimmed.every((l) => l.startsWith('>'))) {
    const text = normalizeText(joinLines(trimmed.map((l) => l.replace(/^>\s?/, ''))));
    return text ? { kind: 'quote', text, page: null } : null;
  }

  if (BULLET_LINE.test(trimmed[0]) && trimmed.filter((l) => BULLET_LINE.test(l)).length >= 2) {
    // A list: each bullet starts an item, other lines continue the previous item.
    const items: string[][] = [];
    for (const l of trimmed) {
      if (BULLET_LINE.test(l) || items.length === 0) items.push([l]);
      else items[items.length - 1].push(l);
    }
    return { kind: 'list', text: items.map((it) => normalizeText(joinLines(it))).join('\n'), page: null };
  }

  const text = normalizeText(joinLines(trimmed));
  return text ? { kind: 'paragraph', text, page: null } : null;
}

export function extractText(bytes: Uint8Array): Extracted {
  const content = decodeText(bytes).replace(/\r\n?/g, '\n');
  if (!content.trim()) throw new ImportError('empty', 'This file is empty.');

  let paragraphs = content.split(/\n[ \t]*\n/);
  // No blank lines at all: one paragraph per line.
  if (paragraphs.length <= 1) paragraphs = content.split('\n');

  const blocks = paragraphs.map((p) => paragraphToBlock(p.split('\n'))).filter((b): b is Block => b !== null);
  if (blocks.length === 0) throw new ImportError('empty', 'This file contains no readable text.');

  // A first-level markdown heading at the very top is usually the book title.
  const title = blocks[0].kind === 'heading' && blocks[0].level === 1 && !blocks[0].chapterLike ? blocks[0].text : null;
  return {
    format: 'text',
    // Only a title found inside the file is used: the file name differs between devices
    // and would break the book identity. The review screen falls back to the file name.
    meta: { title, author: null, language: null },
    blocks,
    toc: null,
    warnings: [],
  };
}
