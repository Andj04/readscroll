// Small text helpers shared by the extractors and the card segmentation.

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
};

/**
 * Fixes extraction artifacts only: composed accents (NFC), typographic
 * ligatures, invisible characters and unusual spaces. The wording is never changed.
 * Line breaks are kept (lists and poems use them); spaces around them are trimmed.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[­​⁠﻿]/g, '') // soft hyphen, zero-width space, word joiner, BOM
    .replace(/[\t   -   　]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/**
 * Joins the lines of one paragraph.
 * A word split by an end-of-line hyphen is rejoined only when the next line
 * starts with a lowercase letter ("infor-" + "mation"). Otherwise the hyphen is
 * kept without adding a space ("Anglo-" + "Saxon").
 */
export function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) {
      out = line;
    } else if (out.endsWith('­')) {
      out = out.slice(0, -1) + line;
    } else if (/\p{L}[-\u2010]$/u.test(out) && /^\p{Ll}/u.test(line)) {
      // "-" or U+2010 (the hyphen character some PDF producers, like Chrome, use)
      out = out.slice(0, -1) + line;
    } else if (/[-\u2010/]$/.test(out)) {
      out += line;
    } else {
      out += ' ' + line;
    }
  }
  return out;
}

/** "Chapter 3", "CHAPITRE II", "Part One", "Book 2." ... */
const CHAPTER_WORDS = /^(chapter|chapitre|part|partie|book|livre|section|lesson|leçon|capítulo|capitulo|kapitel|unit)\s+([0-9]{1,3}|[ivxlcdm]{1,7}|[\p{L}-]{2,20})([.:)—–-]|\s|$)/iu;
/** A heading that is only a roman numeral or a number: "IV", "12." */
const BARE_NUMBER = /^([IVXLCDM]{1,7}|[0-9]{1,3})\.?$/;

export function isChapterLike(heading: string): boolean {
  const t = heading.trim();
  return t.length <= 80 && (CHAPTER_WORDS.test(t) || BARE_NUMBER.test(t));
}

/** Text that ends a sentence, possibly followed by closing quotes or brackets. */
export const ENDS_SENTENCE = /[.!?…:;]["'”’»)\]]*$/;

// ---------- Words and sentences ----------

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(lang: string | undefined, granularity: 'word' | 'sentence'): Intl.Segmenter {
  const key = `${lang ?? ''}|${granularity}`;
  let s = segmenters.get(key);
  if (!s) {
    try {
      s = new Intl.Segmenter(lang || undefined, { granularity });
    } catch {
      s = new Intl.Segmenter(undefined, { granularity }); // unknown language tag
    }
    segmenters.set(key, s);
  }
  return s;
}

export function countWords(text: string, lang?: string): number {
  let n = 0;
  for (const seg of segmenter(lang, 'word').segment(text)) if (seg.isWordLike) n++;
  return n;
}

export interface Sentence {
  text: string;
  /** Offsets inside the source string. */
  start: number;
  end: number;
}

// Abbreviations after which Intl.Segmenter wrongly ends a sentence when a capital follows ("Dr. Smith").
const ABBREVIATIONS = new Set(
  [
    'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'cf', 'fig', 'figs', 'no', 'nos', 'vol', 'vols',
    'p', 'pp', 'ch', 'chap', 'ed', 'eds', 'eq', 'eqs', 'ref', 'refs', 'mt', 'gen', 'col', 'lt', 'sgt', 'capt',
    'rev', 'hon', 'inc', 'ltd', 'co', 'corp', 'dept', 'approx', 'e.g', 'i.e', 'al', 'ca', 'op',
    'm', 'mm', 'mme', 'mmes', 'mlle', 'mlles', 'me', 'pr', 'av', 'apr', 'j.-c', 'env', 'éd', 'cf', 'sq', 'sqq',
  ],
);

/** True when a sentence ends with an abbreviation or an initial ("J."), so it should not end here. */
function endsWithAbbreviation(s: string): boolean {
  const m = /(?:^|[\s(«"“'‘])([\p{L}.-]+)\.["'”’»)]*$/u.exec(s.trimEnd());
  if (!m) return false;
  const word = m[1];
  if (/^\p{Lu}$/u.test(word)) return true; // single initial: "J. R. R. Tolkien"
  if (/^(\p{L}\.)+\p{L}$/u.test(word)) return true; // "U.S", "e.g", "i.e"
  return ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * Splits a paragraph into sentences with Intl.Segmenter, then repairs two known
 * weaknesses: breaks after abbreviations/initials, and breaks before a lowercase
 * letter (never a real sentence start).
 */
export function splitSentences(text: string, lang?: string): Sentence[] {
  const raw: Sentence[] = [];
  for (const seg of segmenter(lang, 'sentence').segment(text)) {
    const lead = seg.segment.length - seg.segment.trimStart().length;
    const trimmed = seg.segment.trim();
    if (!trimmed) continue;
    const start = seg.index + lead;
    raw.push({ text: trimmed, start, end: start + trimmed.length });
  }

  const out: Sentence[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    // A segment starting with a lowercase letter or a closing quote continues the previous sentence.
    const startsLower = /^["'“‘«(\s]*\p{Ll}/u.test(s.text) || /^[»”’)\]]/u.test(s.text);
    if (prev && (endsWithAbbreviation(prev.text) || startsLower || !/\p{L}|\p{N}/u.test(s.text))) {
      prev.end = s.end;
      prev.text = text.slice(prev.start, prev.end);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}
