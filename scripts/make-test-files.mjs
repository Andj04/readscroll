// Generates the test books used by the PDF unit tests and the end-to-end tests.
// All text is original, written for these tests. Run: npm run make-test-files
// PDFs are printed with the Chromium browser that Playwright uses.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const OUT = new URL('../test-files/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SENTENCES = [
  'The harbour town woke slowly under a pale sky.',
  'Fishermen untied their boats while gulls argued over the nets.',
  'Dr. Moreau, who kept the lighthouse, counted the vessels as they left.',
  'He wrote each name in a ledger that was older than the town hall.',
  'By noon the tide had turned, and the water in the bay was 3.5 metres deep.',
  'Nobody remembered when the ledger had first been opened.',
  'Children ran along the quay, shouting the names of the boats they knew.',
  'Mrs. Alder sold bread from a cart painted the colour of the sea.',
  'At dusk the lamps were lit one by one, from the church to the pier.',
  'The keeper climbed the stairs and wound the great clock by hand.',
  'In winter the wind came from the north and rattled every shutter in the street.',
  'The school closed early on stormy days, and the children watched the waves from the hill.',
  'A new boat was built each spring in the yard behind the chapel.',
  'Its hull was painted on the first warm afternoon, while the whole street gave advice.',
  '"Too much blue," said the baker. "Not enough," said the priest.',
  'The boat was finally launched on a Sunday, with flags on every mast.',
  'Old sailors measured the depth of the channel with knotted ropes and patience.',
  'Their figures were written in chalk on the harbour wall and washed away by the rain.',
  'Each autumn the town held a market where nets, lanterns and stories were exchanged.',
  'Visitors rarely stayed long, but those who did never quite forgot the sound of the bell.',
];
const para = (n, o) => Array.from({ length: n }, (_, i) => SENTENCES[(i + o) % SENTENCES.length]).join(' ');

const CHAPTERS = [
  { title: 'The Harbour', paras: [para(6, 0), para(5, 6), para(7, 11), para(4, 3)] },
  { title: 'The Storm', paras: [para(5, 2), para(8, 7), para(3, 15), para(6, 9)] },
  { title: 'The Launch', paras: [para(7, 12), para(4, 1), para(6, 16), para(5, 5)] },
];

// ---------- Plain text ----------
writeFileSync(
  OUT + 'harbour.txt',
  ['# Harbour Stories', ...CHAPTERS.flatMap((c, i) => [`Chapter ${i + 1}`, ...c.paras])].join('\n\n') + '\n',
);

// ---------- EPUB ----------
const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;
function epub(extra = {}) {
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">harbour-stories</dc:identifier><dc:title>Harbour Stories</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${CHAPTERS.map((_, i) => `<item id="c${i}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${CHAPTERS.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`),
    'OEBPS/nav.xhtml': strToU8(
      xhtml('Contents', `<nav epub:type="toc"><ol>${CHAPTERS.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${c.title}</a></li>`).join('')}</ol></nav>`),
    ),
  };
  CHAPTERS.forEach((c, i) => {
    files[`OEBPS/ch${i + 1}.xhtml`] = strToU8(xhtml(c.title, `<h1>${c.title}</h1>${c.paras.map((p) => `<p>${p}</p>`).join('')}`));
  });
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return zipSync(files);
}
writeFileSync(OUT + 'harbour.epub', epub());
writeFileSync(OUT + 'drm.epub', epub({ 'META-INF/rights.xml': '<rights/>' }));

// ---------- PDFs ----------
const page = (body, css = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { font: 12pt/1.5 Georgia, serif; margin: 0; }
  h1 { font-size: 22pt; page-break-before: always; margin: 0 0 18pt; }
  h1:first-of-type { page-break-before: auto; }
  p { margin: 0; text-indent: 1.5em; text-align: justify; hyphens: auto; }
  ${css}</style></head><body>${body}</body></html>`;
const book = CHAPTERS.map((c) => `<h1>${c.title}</h1>${c.paras.map((p) => `<p>${p}</p>`).join('')}`).join('');

const { chromium } = require('playwright');
const browser = await chromium.launch();
const p = await browser.newPage();
const pdf = async (file, html, opts = {}) => {
  await p.setContent(html);
  writeFileSync(OUT + file, await p.pdf({ format: 'A6', margin: { top: '18mm', bottom: '18mm', left: '12mm', right: '12mm' }, ...opts }));
};
const headerFooter = {
  displayHeaderFooter: true,
  headerTemplate: '<div style="font-size:8px;width:100%;text-align:center;font-family:Georgia">Harbour Stories</div>',
  footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;font-family:Georgia"><span class="pageNumber"></span></div>',
};
// With a document outline (bookmarks), running header and page numbers.
await pdf('harbour.pdf', page(book), { ...headerFooter, outline: true, tagged: true });
// Same book without outline: chapters must come from the headings.
await pdf('harbour-no-outline.pdf', page(book), headerFooter);
// Two columns: the reading order warning should appear.
await pdf('two-columns.pdf', page(`<div style="columns:2;column-gap:8mm;font-size:8pt">${CHAPTERS[0].paras.concat(CHAPTERS[1].paras).map((x) => `<p>${x}</p>`).join('')}</div>`));
// Scanned: pages are pictures, no text layer.
await p.setContent(page(`<canvas id="c" width="600" height="300"></canvas>`));
const png = await p.evaluate(() => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 300); g.fillStyle = '#000'; g.font = '20px serif';
  g.fillText('This line is only a picture of text.', 20, 50);
  return c.toDataURL('image/png');
});
await pdf('scanned.pdf', page(`<img src="${png}" style="width:100%"><div style="page-break-before:always"></div><img src="${png}" style="width:100%">`));
await browser.close();

// Damaged PDF: a valid start, then cut.
const good = (await import('node:fs')).readFileSync(OUT + 'harbour.pdf');
writeFileSync(OUT + 'damaged.pdf', good.subarray(0, 600));
console.log('Test files written to', OUT);
