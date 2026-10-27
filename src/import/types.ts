// Shared types of the on-device import pipeline.
//
// Pipeline: file -> extractor (pdf / epub / text) -> cleaned Blocks
//   -> chapter detection -> ChapterPlan -> segmentation -> cards.

export type SourceFormat = 'pdf' | 'epub' | 'text';

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'quote';

/** One cleaned piece of the book: a heading, a paragraph, a whole list or a quote. */
export interface Block {
  kind: BlockKind;
  /** Lists keep one item per line ("\n"); other blocks are a single line of text. */
  text: string;
  /** Heading level (1 = biggest). Only for headings. */
  level?: number;
  /** PDF page number (1-based), or null for EPUB and plain text. */
  page: number | null;
  /** True when the heading matches a "Chapter 3" / "Part II" style pattern. */
  chapterLike?: boolean;
}

export interface ImportWarning {
  page: number | null;
  message: string;
}

/** A chapter start found in the file's own table of contents (EPUB nav/NCX or PDF outline). */
export interface TocEntry {
  title: string;
  blockIndex: number;
}

/** What an extractor returns, after cleaning. */
export interface Extracted {
  format: SourceFormat;
  meta: { title: string | null; author: string | null; language: string | null };
  blocks: Block[];
  toc: TocEntry[] | null;
  warnings: ImportWarning[];
}

/** One chapter as the user will see it in the review screen: a range of blocks. */
export interface PlannedChapter {
  title: string;
  /** First block (inclusive). */
  start: number;
  /** End block (exclusive). */
  end: number;
}

export type ChapterMethod = 'toc' | 'outline' | 'headings' | 'none';

export type CardLength = 'short' | 'medium' | 'long';

export interface LengthRules {
  /** A card is "full" once it reaches this many words. */
  targetMin: number;
  /** Paragraphs are packed into a card up to this many words. */
  targetMax: number;
  /** Never above this, unless a single sentence is longer. */
  hardMax: number;
  /** Cards below this are merged with a neighbour (the last card of a chapter may stay shorter). */
  softMin: number;
}

export const LENGTH_RULES: Record<CardLength, LengthRules> = {
  short: { targetMin: 40, targetMax: 80, hardMax: 100, softMin: 25 },
  medium: { targetMin: 80, targetMax: 150, hardMax: 180, softMin: 40 },
  long: { targetMin: 150, targetMax: 250, hardMax: 300, softMin: 80 },
};

/** A card before it gets its id and number. Offsets point into the book text (see bookText). */
export interface CardDraft {
  title: string | null;
  text: string;
  wordCount: number;
  page: number | null;
  start: number;
  end: number;
}

export type ImportErrorCode = 'scanned' | 'drm' | 'password' | 'corrupt' | 'empty' | 'unsupported';

export class ImportError extends Error {
  constructor(
    public code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}
