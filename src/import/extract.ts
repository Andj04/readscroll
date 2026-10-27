import { detectChapters } from './chapters';
import { extractEpub } from './epub';
import { computeBookId } from './identity';
import { extractPdf } from './pdf';
import { extractText } from './text';
import { ImportError, type ChapterMethod, type Extracted, type PlannedChapter, type SourceFormat } from './types';

// Entry point of the pipeline: recognizes the file type, extracts and cleans the text,
// detects chapters and computes the book identity.

export function detectFormat(bytes: Uint8Array, fileName: string): SourceFormat {
  const head = String.fromCharCode(...bytes.slice(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (/\.epub$/i.test(fileName) || head.includes('application/epub+zip') || head.includes('META-INF')) return 'epub';
    throw new ImportError('unsupported', 'This ZIP file is not an EPUB book.');
  }
  if (/\.pdf$/i.test(fileName)) throw new ImportError('corrupt', 'This PDF file is damaged and cannot be opened.');
  if (/\.epub$/i.test(fileName)) throw new ImportError('corrupt', 'This EPUB file is damaged and cannot be opened.');
  if (/\.(txt|text|md|markdown)$/i.test(fileName) || !bytes.slice(0, 4096).includes(0)) return 'text';
  throw new ImportError('unsupported', 'This file type is not supported. Choose a PDF, EPUB or plain text file.');
}

export interface ParsedBook {
  bookId: string;
  extracted: Extracted;
  chapters: PlannedChapter[];
  method: ChapterMethod;
}

export type Progress = (stage: string, done: number, total: number) => void;

export async function parseBook(bytes: Uint8Array, fileName: string, onProgress: Progress = () => {}): Promise<ParsedBook> {
  if (bytes.length === 0) throw new ImportError('empty', 'This file is empty.');
  const format = detectFormat(bytes, fileName);
  let extracted: Extracted;
  if (format === 'pdf') extracted = await extractPdf(bytes, (d, t) => onProgress('Reading pages', d, t));
  else if (format === 'epub') extracted = extractEpub(bytes, (d, t) => onProgress('Reading chapters', d, t));
  else extracted = extractText(bytes);

  onProgress('Finding chapters', 0, 1);
  const fallbackTitle = extracted.meta.title ?? fileName.replace(/\.[^.]+$/, '');
  const { chapters, method } = detectChapters(extracted, fallbackTitle);
  const bookId = await computeBookId(extracted.meta, extracted.blocks);
  onProgress('Finding chapters', 1, 1);
  return { bookId, extracted, chapters, method };
}
