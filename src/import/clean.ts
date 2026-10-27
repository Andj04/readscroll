import type { Block, ImportWarning } from './types';
import { ENDS_SENTENCE, isChapterLike, joinLines, normalizeText } from './textUtils';

// Turns the text lines of PDF pages into clean blocks (headings, paragraphs, lists).
// Pure functions, so they can be unit-tested without a PDF.

/** One visual line of text on a page. y grows downwards (0 = top of the page). */
export interface Line {
  text: string;
  x: number;
  y: number;
  /** Font size of the line (largest item). */
  size: number;
  width: number;
}

export interface PageLines {
  page: number;
  width: number;
  height: number;
  lines: Line[];
}

// ---------- Headers, footers and page numbers ----------

/** "12", "- 12 -", "Page 12", "12 / 300", "xii" (front matter, lowercase roman only). */
export function isPageNumberLine(text: string): boolean {
  return /^[\s\-–—|]*(page\s+|p\.\s*)?(\d{1,4}|[ivxlcdm]{1,7})(\s*(\/|of|sur|de)\s*\d{1,4})?[\s\-–—|]*$/i.test(text) &&
    !/^[\s\-–—|]*[IVXLCDM]+[\s\-–—|]*$/.test(text); // a capital roman numeral alone is more likely a heading
}

/**
 * Lines are compared without digits, so "Chapter title — 12" and "Chapter title — 13" match.
 * Known limit: a body line at the very top or bottom of a page that is identical on 40% of
 * the pages except for its numbers would also be removed. Real body text does not repeat like that.
 */
function repeatKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

const EDGE_LINES = 2; // how many lines at the top and bottom of a page are checked

/**
 * Removes running headers and footers (the same line at the top or bottom of many
 * pages) and standalone page numbers at the top or bottom of a page.
 */
export function removeHeadersAndFooters(pages: PageLines[]): PageLines[] {
  const edgeIndexes = (n: number) => {
    const idx = new Set<number>();
    for (let i = 0; i < Math.min(EDGE_LINES, n); i++) {
      idx.add(i);
      idx.add(n - 1 - i);
    }
    return idx;
  };

  // Count on how many pages each edge line appears.
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const i of edgeIndexes(p.lines.length)) seen.add(repeatKey(p.lines[i].text));
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));

  return pages.map((p) => {
    const edges = edgeIndexes(p.lines.length);
    const lines = p.lines.filter((line, i) => {
      if (!edges.has(i)) return true;
      if (isPageNumberLine(line.text)) return false;
      if (pages.length >= 3 && (counts.get(repeatKey(line.text)) ?? 0) >= threshold) return false;
      return true;
    });
    return { ...p, lines };
  });
}

// ---------- Lines to blocks ----------

const BULLET = /^([•●▪◦‣∙·*–-]|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+/;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Most frequent value, rounded to 0.5, weighted by text length. */
function dominantSize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    weight.set(k, (weight.get(k) ?? 0) + l.text.length);
  }
  let best = 0;
  let bestW = -1;
  for (const [k, w] of weight) if (w > bestW) [best, bestW] = [k, w];
  return best;
}

export interface LinesToBlocksResult {
  blocks: Block[];
  warnings: ImportWarning[];
}

/**
 * Groups lines into paragraphs, detects headings (bigger font, or "Chapter 3"
 * style lines) and lists. Paragraphs may continue across pages.
 */
export function linesToBlocks(pages: PageLines[]): LinesToBlocksResult {
  const all = pages.flatMap((p) => p.lines);
  const body = dominantSize(all);
  const isBody = (l: Line) => Math.abs(l.size - body) <= Math.max(0.6, body * 0.06);

  // Typical spacing between two body lines of the same paragraph.
  const gaps: number[] = [];
  for (const p of pages)
    for (let i = 1; i < p.lines.length; i++) {
      const g = p.lines[i].y - p.lines[i - 1].y;
      if (g > 0 && isBody(p.lines[i]) && isBody(p.lines[i - 1])) gaps.push(g);
    }
  const lineGap = median(gaps) || body * 1.2;
  const fullWidth = median(all.filter(isBody).map((l) => l.width).sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(all.length * 0.3))));
  const leftX = median(all.filter(isBody).map((l) => l.x));

  // Heading sizes, biggest first -> heading levels 1, 2, 3.
  const headingSizes = [...new Set(all.filter((l) => l.size >= body * 1.15).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const levelOf = (size: number) => Math.min(3, headingSizes.indexOf(Math.round(size * 2) / 2) + 1) || 3;

  const blocks: Block[] = [];
  const warnings: ImportWarning[] = [];
  let para: { lines: string[]; page: number; kind: 'paragraph' | 'list'; items: string[][] } | null = null;
  let heading: { lines: string[]; page: number; size: number } | null = null;

  const flushPara = () => {
    if (!para) return;
    if (para.kind === 'list') {
      const text = para.items.map((it) => normalizeText(joinLines(it))).join('\n');
      if (text) blocks.push({ kind: 'list', text, page: para.page });
    } else {
      const text = normalizeText(joinLines(para.lines));
      if (text) blocks.push({ kind: 'paragraph', text, page: para.page });
    }
    para = null;
  };
  const flushHeading = () => {
    if (!heading) return;
    const text = normalizeText(joinLines(heading.lines));
    if (text) blocks.push({ kind: 'heading', text, level: levelOf(heading.size), page: heading.page, chapterLike: isChapterLike(text) });
    heading = null;
  };

  let prev: Line | null = null;
  let prevPage = -1;

  for (const p of pages) {
    let movedUp = 0;
    for (const line of p.lines) {
      const text = line.text.trim();
      if (!text) continue;
      const samePage = p.page === prevPage;
      const gap = prev && samePage ? line.y - prev.y : NaN;
      if (samePage && gap < -line.size * 3) movedUp++;

      // --- Headings ---
      const big = line.size >= body * 1.15 && text.length <= 150;
      const chapterLine = isChapterLike(text) && text.length <= 60 && (!para || ENDS_SENTENCE.test(prev?.text ?? ''));
      if (big || chapterLine) {
        flushPara();
        // Consecutive lines of the same heading (a title on two lines) stay together.
        if (heading && samePage && Math.abs(heading.size - line.size) < 0.5 && gap > 0 && gap < line.size * 2 && !chapterLine) {
          heading.lines.push(text);
        } else {
          flushHeading();
          heading = { lines: [text], page: p.page, size: big ? line.size : body * 1.2 };
        }
        prev = line;
        prevPage = p.page;
        continue;
      }
      flushHeading();

      // --- Paragraph and list boundaries ---
      const prevEnds = prev ? ENDS_SENTENCE.test(prev.text.trim()) : true;
      const prevShort = prev ? prev.width < fullWidth * 0.8 : true;
      let newPara = !para;
      if (para && prev) {
        if (!samePage || gap < 0) {
          // New page or new column: no spacing information, rely on punctuation and line length.
          newPara = prevEnds && prevShort;
        } else if (gap > lineGap * 1.5) {
          newPara = true;
        } else if (line.x - leftX > body * 0.8 && line.x - leftX < body * 8 && prevEnds) {
          newPara = true; // first-line indent
        } else if (prevShort && prevEnds) {
          newPara = true;
        }
      }

      const bullet = BULLET.test(text);
      if (bullet) {
        if (!para || para.kind !== 'list' || (newPara && gap > lineGap * 2.5)) {
          flushPara();
          para = { lines: [], page: p.page, kind: 'list', items: [] };
        }
        para.items.push([text]);
      } else if (para?.kind === 'list' && !newPara) {
        para.items[para.items.length - 1].push(text); // continuation of a list item
      } else {
        if (newPara || para?.kind === 'list') {
          flushPara();
          para = { lines: [], page: p.page, kind: 'paragraph', items: [] };
        }
        para!.lines.push(text);
      }
      prev = line;
      prevPage = p.page;
    }
    if (movedUp > 0) {
      warnings.push({
        page: p.page,
        message: 'This page seems to have several columns or text boxes. The reading order may be wrong.',
      });
    }
  }
  flushHeading();
  flushPara();
  return { blocks, warnings };
}
