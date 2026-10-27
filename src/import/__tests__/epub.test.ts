import { describe, expect, it } from 'vitest';
import { extractEpub, resolvePath } from '../epub';
import { parseBook } from '../extract';
import { makeEpub } from './epubFixture';

describe('resolvePath', () => {
  it('resolves relative hrefs and fragments', () => {
    expect(resolvePath('OEBPS/nav.xhtml', 'text/ch1.xhtml#c1')).toEqual({ path: 'OEBPS/text/ch1.xhtml', fragment: 'c1' });
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a%20b.png')).toEqual({ path: 'OEBPS/images/a b.png', fragment: null });
    expect(resolvePath('OEBPS/text/ch1.xhtml', '#note')).toEqual({ path: 'OEBPS/text/ch1.xhtml', fragment: 'note' });
  });
});

describe('extractEpub', () => {
  it('reads metadata, the spine in order and the EPUB 3 table of contents', () => {
    const ex = extractEpub(makeEpub());
    expect(ex.meta).toEqual({ title: 'Harbour Stories', author: 'Test Author', language: 'en' });
    expect(ex.toc).toEqual([
      { title: 'The Harbour', blockIndex: 0 },
      { title: 'The Storm', blockIndex: 5 },
    ]);
    expect(ex.blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'paragraph', 'list', 'quote', 'heading', 'paragraph', 'paragraph', 'paragraph']);
  });

  it('keeps line breaks, lists, quotes, non-breaking spaces and accents correctly', () => {
    const ex = extractEpub(makeEpub());
    expect(ex.blocks[2].text).toBe('Dr. Moreau, who kept the lighthouse, counted the vessels as they left.\nHe wrote each name in a ledger.');
    expect(ex.blocks[3].text).toBe('• a rope\n• a lantern');
    expect(ex.blocks[4].text).toBe('Keep the lamp lit.\nWatch the water.');
    expect(ex.blocks[6].text).toContain('3.5 metres');
    expect(ex.blocks[7].text).toBe('L’été suivant, Hélène revint au port avec une carte annotée.');
    expect(ex.blocks[8].text).toBe('Boat | Crew');
  });

  it('reads the EPUB 2 NCX table of contents', () => {
    const ex = extractEpub(makeEpub({ version: 2 }));
    expect(ex.toc?.map((t) => t.title)).toEqual(['The Harbour', 'The Storm']);
  });

  it('follows table of contents links to an anchor inside a file', () => {
    const ex = extractEpub(makeEpub({ tocFragments: true }));
    expect(ex.blocks[ex.toc![1].blockIndex]).toMatchObject({ kind: 'heading', text: 'The Storm' });
  });

  it('accepts font obfuscation but refuses DRM', () => {
    const fontOnly = `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
      <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/a.otf"/></enc:CipherData></enc:EncryptedData></encryption>`;
    expect(() => extractEpub(makeEpub({ extra: { 'META-INF/encryption.xml': fontOnly } }))).not.toThrow();

    const drm = fontOnly.replace('http://www.idpf.org/2008/embedding', 'http://www.w3.org/2001/04/xmlenc#aes128-cbc');
    expect(() => extractEpub(makeEpub({ extra: { 'META-INF/encryption.xml': drm } }))).toThrow(/DRM/);
    expect(() => extractEpub(makeEpub({ extra: { 'META-INF/rights.xml': '<rights/>' } }))).toThrow(/DRM/);
  });

  it('reports damaged files clearly', () => {
    const good = makeEpub();
    expect(() => extractEpub(good.slice(0, 200))).toThrow(/damaged/);
    expect(() => extractEpub(makeEpub({ chapters: [] }))).toThrow(/no readable content/);
  });

  it('reports an EPUB with no text', () => {
    expect(() => extractEpub(makeEpub({ chapters: [{ file: 'a.xhtml', title: 'Cover', body: '<img src="cover.jpg"/>' }] }))).toThrow(/no readable text/);
  });
});

describe('parseBook (EPUB)', () => {
  it('uses the table of contents for chapters', async () => {
    const book = await parseBook(makeEpub(), 'harbour.epub');
    expect(book.method).toBe('toc');
    expect(book.chapters.map((c) => c.title)).toEqual(['The Harbour', 'The Storm']);
  });
});
