import { strToU8, zipSync } from 'fflate';

// Builds small EPUB files in memory for tests (original text only).

export interface EpubOptions {
  version?: 2 | 3;
  title?: string;
  author?: string;
  chapters?: { file: string; title: string; body: string }[];
  /** Extra files, e.g. META-INF/encryption.xml */
  extra?: Record<string, string>;
  /** Point the table of contents at a fragment inside the chapter file. */
  tocFragments?: boolean;
}

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><style>p { margin: 0 }</style></head>
<body>${body}</body></html>`;

export const DEFAULT_CHAPTERS = [
  {
    file: 'text/ch1.xhtml',
    title: 'The Harbour',
    body: `<section id="c1"><h1>The Harbour</h1>
<p>The harbour town woke slowly under a pale sky. Fishermen untied their boats while gulls argued over the nets.</p>
<p>Dr. Moreau, who kept the lighthouse, counted the vessels as they left.<br/>He wrote each name in a ledger.</p>
<ul><li>a rope</li><li>a <em>lantern</em></li></ul>
<blockquote><p>Keep the lamp lit.</p><p>Watch the water.</p></blockquote></section>`,
  },
  {
    file: 'text/ch2.xhtml',
    title: 'The Storm',
    body: `<h1 id="storm">The Storm</h1><p>By noon the tide had turned, and the water in the bay was 3.5&#160;metres deep.</p>
<p>L’été suivant, Hélène revint au port avec une carte annotée.</p>
<table><tr><td>Boat</td><td>Crew</td></tr></table>`,
  },
];

export function makeEpub(opts: EpubOptions = {}): Uint8Array {
  const { version = 3, title = 'Harbour Stories', author = 'Test Author', chapters = DEFAULT_CHAPTERS, extra = {}, tocFragments = false } = opts;
  const items = chapters.map((c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n');
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('');
  const href = (c: { file: string }, i: number) => `${c.file}${tocFragments && i === 1 ? '#storm' : ''}`;

  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">test-book</dc:identifier><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>en</dc:language>
</metadata>
<manifest>
${version === 3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'}
${items}
</manifest>
<spine${version === 2 ? ' toc="ncx"' : ''}>${spine}</spine>
</package>`),
  };
  if (version === 3) {
    files['OEBPS/nav.xhtml'] = strToU8(
      xhtml('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>${chapters.map((c, i) => `<li><a href="${href(c, i)}">${c.title}</a></li>`).join('')}</ol></nav>`),
    );
  } else {
    files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>
${chapters.map((c, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${c.title}</text></navLabel><content src="${href(c, i)}"/></navPoint>`).join('\n')}
</navMap></ncx>`);
  }
  for (const c of chapters) files[`OEBPS/${c.file}`] = strToU8(xhtml(c.title, c.body));
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return zipSync(files);
}
