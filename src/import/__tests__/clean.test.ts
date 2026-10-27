import { describe, expect, it } from 'vitest';
import { isPageNumberLine, linesToBlocks, removeHeadersAndFooters, type Line, type PageLines } from '../clean';

// Helpers to describe a PDF page as lines: body text at size 10, 12 units apart, full width 400.
const BODY = 10;
function L(text: string, y: number, opts: Partial<Line> = {}): Line {
  return { text, x: 50, y, size: BODY, width: opts.width ?? 400, ...opts };
}
function page(n: number, lines: Line[]): PageLines {
  return { page: n, width: 500, height: 700, lines };
}

describe('isPageNumberLine', () => {
  it('recognizes page numbers', () => {
    for (const t of ['12', '- 12 -', 'Page 12', 'p. 7', '12 / 300', 'xii', '— 4 —']) expect(isPageNumberLine(t)).toBe(true);
  });
  it('keeps headings and text', () => {
    for (const t of ['IV', 'Chapter 12', '12 apples', 'I']) expect(isPageNumberLine(t)).toBe(false);
  });
});

describe('removeHeadersAndFooters', () => {
  it('removes a running header, a running footer and page numbers', () => {
    const body = ['The tide came in early.', 'Boats waited at the quay.', 'Gulls circled the nets.', 'The lamps were lit at dusk.', 'Rain fell on the roofs.', 'A bell rang twice.', 'Bread was sold at noon.', 'The clock struck nine.'];
    const pages = [1, 2, 3, 4].map((n) =>
      page(n, [
        L('A Short History of Harbours', 20, { width: 150 }),
        L(body[n * 2 - 2], 60),
        L(body[n * 2 - 1], 72),
        L(`Harbours — ${n}`, 650, { width: 80 }),
        L(String(n + 10), 680, { width: 10 }),
      ]),
    );
    const out = removeHeadersAndFooters(pages);
    for (const p of out) {
      expect(p.lines.map((l) => l.text)).toEqual([body[p.page * 2 - 2], body[p.page * 2 - 1]]);
    }
  });

  it('keeps lines that repeat on only a few pages', () => {
    const pages = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => page(n, [L(n <= 2 ? 'Same first line' : `Line ${n}a`, 20), L('Body.', 40)]));
    const out = removeHeadersAndFooters(pages);
    expect(out[0].lines[0].text).toBe('Same first line');
  });
});

describe('linesToBlocks', () => {
  it('merges lines of a paragraph and splits paragraphs on a bigger gap', () => {
    const { blocks } = linesToBlocks([
      page(1, [
        L('The first paragraph starts here and', 50),
        L('continues on a second line.', 62, { width: 200 }),
        L('The second paragraph is separate', 90),
        L('from the first one.', 102, { width: 150 }),
      ]),
    ]);
    expect(blocks.map((b) => b.text)).toEqual([
      'The first paragraph starts here and continues on a second line.',
      'The second paragraph is separate from the first one.',
    ]);
  });

  it('splits paragraphs on a first-line indent', () => {
    const { blocks } = linesToBlocks([
      page(1, [
        L('One paragraph that ends at the end of', 50),
        L('this full line.', 62),
        L('Indented start of the next paragraph.', 74, { x: 70 }),
      ]),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it('rejoins hyphenated words and continues a paragraph across pages', () => {
    const { blocks } = linesToBlocks([
      page(1, [L('The keeper wrote the infor-', 600), L('mation in the ledger every', 612)]),
      page(2, [L('evening before supper.', 40, { width: 150 })]),
    ]);
    expect(blocks.map((b) => b.text)).toEqual(['The keeper wrote the information in the ledger every evening before supper.']);
    expect(blocks[0].page).toBe(1);
  });

  it('detects headings by font size and gives levels', () => {
    const { blocks } = linesToBlocks([
      page(1, [
        L('The Harbour', 40, { size: 20, width: 120 }),
        L('Morning', 70, { size: 14, width: 60 }),
        L('Body text of the section, long enough to be the body size of', 90),
        L('the page and to win the vote for the body font size.', 102),
        L('More body text that keeps the body size dominant on the page', 114),
        L('so that headings stand out clearly.', 126, { width: 200 }),
      ]),
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'heading', text: 'The Harbour', level: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'heading', text: 'Morning', level: 2 });
    expect(blocks[2].kind).toBe('paragraph');
  });

  it('detects "Chapter" lines written at body size', () => {
    const { blocks } = linesToBlocks([
      page(1, [L('Chapter 2', 40, { width: 60 }), L('It began on a Tuesday.', 60, { width: 150 })]),
    ]);
    expect(blocks[0]).toMatchObject({ kind: 'heading', chapterLike: true });
  });

  it('groups bullet lines into one list block', () => {
    const { blocks } = linesToBlocks([
      page(1, [
        L('You will need:', 40, { width: 100 }),
        L('• a rope', 60, { width: 60 }),
        L('• a lantern that', 72, { width: 100 }),
        L('  stays lit in the wind', 84, { width: 120, x: 60 }),
        L('• a map', 96, { width: 60 }),
      ]),
    ]);
    expect(blocks[1]).toEqual({ kind: 'list', text: '• a rope\n• a lantern that stays lit in the wind\n• a map', page: 1 });
  });

  it('warns when a page seems to have two columns', () => {
    const { warnings } = linesToBlocks([
      page(1, [L('Left column first line', 50, { width: 180 }), L('Left column second line.', 62, { width: 180 }), L('Right column at the top again', 50, { x: 260, width: 180 })]),
    ]);
    // Same y: no jump up. A real second column starts much higher than the end of the first one:
    const res = linesToBlocks([
      page(2, [L('Left column line one', 50, { width: 180 }), L('Left column line two', 600, { width: 180 }), L('Right column top line', 50, { x: 260, width: 180 })]),
    ]);
    expect(warnings).toHaveLength(0);
    expect(res.warnings).toEqual([expect.objectContaining({ page: 2 })]);
  });
});
