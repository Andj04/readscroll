// The legacy build includes polyfills for older browsers (e.g. Safari before 18.2) and Node.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { linesToBlocks, removeHeadersAndFooters, type Line, type PageLines } from './clean';
import { ImportError, type Block, type Extracted, type ImportWarning, type TocEntry } from './types';
import { normalizeText } from './textUtils';

// PDF import with pdf.js: text and positions of each page, the document outline and metadata.
// This code already runs inside our own Web Worker, so pdf.js runs its own "worker" code
// in the same thread: setting globalThis.pdfjsWorker makes pdf.js use it directly.

type Progress = (done: number, total: number) => void;

async function ensurePdfWorker() {
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
}

/** Groups the text items of a page into lines, in the order of the content stream. */
export function itemsToLines(items: TextItem[], pageHeight: number): Line[] {
  const lines: Line[] = [];
  let cur: (Line & { endX: number }) | null = null;
  let endOfLine = false;

  for (const item of items) {
    const [, , c, d, e, f] = item.transform as number[];
    const size = Math.hypot(c, d) || item.height || 10;
    const x = e;
    const y = pageHeight - f;
    if (item.str) {
      const sameLine = cur && !endOfLine && Math.abs(y - cur.y) < size * 0.5;
      if (cur && sameLine) {
        // Add a space when there is a visible gap and neither side already has one.
        const gap = x - cur.endX;
        if (gap > size * 0.15 && !cur.text.endsWith(' ') && !item.str.startsWith(' ')) cur.text += ' ';
        cur.text += item.str;
        cur.endX = x + item.width;
        cur.width = cur.endX - cur.x;
        cur.size = Math.max(cur.size, size);
      } else {
        if (cur) lines.push(cur);
        cur = { text: item.str, x, y, size, width: item.width, endX: x + item.width };
      }
    }
    endOfLine = item.hasEOL;
  }
  if (cur) lines.push(cur);
  return lines
    .map(({ text, x, y, size, width }) => ({ text: text.trim(), x, y, size, width }))
    .filter((l) => l.text.length > 0);
}

async function outlineToPages(doc: PDFDocumentProxy): Promise<{ title: string; page: number }[]> {
  let outline: Awaited<ReturnType<PDFDocumentProxy['getOutline']>> | null = null;
  try {
    outline = await doc.getOutline();
  } catch {
    return [];
  }
  if (!outline || outline.length === 0) return [];
  // The top level, or the level below when the top is a single entry (usually the book title).
  let level = outline;
  while (level.length === 1 && level[0].items?.length) level = level[0].items;

  const out: { title: string; page: number }[] = [];
  for (const item of level) {
    try {
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
      if (!dest || dest.length === 0) continue;
      const target = dest[0];
      const index = typeof target === 'number' ? target : await doc.getPageIndex(target);
      out.push({ title: normalizeText(item.title), page: index + 1 });
    } catch {
      // Broken outline entry: ignore it.
    }
  }
  return out;
}

const simplify = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Finds the block where an outline entry starts: a heading with the same title on that page, else the first block of the page. */
function outlineToBlock(blocks: Block[], title: string, page: number): number {
  const want = simplify(title);
  const onPage = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.page === page);
  const match = onPage.find(({ b }) => {
    const got = simplify(b.text);
    return got.length > 0 && (got === want || (b.kind === 'heading' && (want.startsWith(got) || got.startsWith(want))));
  });
  if (match) return match.i;
  if (onPage.length) return onPage[0].i;
  const after = blocks.findIndex((b) => (b.page ?? 0) > page);
  return after;
}

export async function extractPdf(bytes: Uint8Array, onProgress: Progress = () => {}): Promise<Extracted> {
  await ensurePdfWorker();
  let doc: PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: bytes, stopAtErrors: false }).promise;
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'PasswordException') {
      throw new ImportError('password', 'This PDF is protected by a password or DRM. Only unprotected files can be imported.');
    }
    throw new ImportError('corrupt', 'This PDF file is damaged and cannot be opened.');
  }

  try {
    const pages: PageLines[] = [];
    let pagesWithText = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((it): it is TextItem => 'str' in it);
      const lines = itemsToLines(items, viewport.height);
      const chars = lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0);
      if (chars >= 20) pagesWithText++;
      pages.push({ page: n, width: viewport.width, height: viewport.height, lines });
      page.cleanup();
      onProgress(n, doc.numPages);
    }

    if (doc.numPages > 0 && pagesWithText === 0) {
      throw new ImportError(
        'scanned',
        'This PDF has no text layer: it looks like a scan (pictures of pages). Text recognition (OCR) is not supported.',
      );
    }
    if (pagesWithText < doc.numPages * 0.5) {
      throw new ImportError(
        'scanned',
        `Only ${pagesWithText} of ${doc.numPages} pages contain text: this PDF looks mostly scanned. Text recognition (OCR) is not supported.`,
      );
    }

    const warnings: ImportWarning[] = [];
    const empty = doc.numPages - pagesWithText;
    if (empty > 0 && empty > doc.numPages * 0.1) {
      warnings.push({ page: null, message: `${empty} pages have no text (blank pages or pictures). They were skipped.` });
    }

    const cleaned = removeHeadersAndFooters(pages);
    const { blocks, warnings: orderWarnings } = linesToBlocks(cleaned);
    if (blocks.length === 0) throw new ImportError('empty', 'This PDF contains no readable text.');
    warnings.push(...orderWarnings);

    const outline = await outlineToPages(doc);
    const toc: TocEntry[] = outline
      .map((o) => ({ title: o.title, blockIndex: outlineToBlock(blocks, o.title, o.page) }))
      .filter((t) => t.blockIndex >= 0);

    let info: Record<string, unknown> = {};
    try {
      info = ((await doc.getMetadata()).info ?? {}) as Record<string, unknown>;
    } catch {
      // No metadata.
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? normalizeText(v) : null);

    return {
      format: 'pdf',
      meta: { title: str(info.Title), author: str(info.Author), language: str(info.Language) },
      blocks,
      toc: toc.length ? toc : null,
      warnings,
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}
