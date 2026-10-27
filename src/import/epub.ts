import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { parseDocument } from 'htmlparser2';
import { isTag, isText, type ChildNode, type Element } from 'domhandler';
import { ImportError, type Block, type Extracted, type TocEntry } from './types';
import { isChapterLike, normalizeText } from './textUtils';

// EPUB import: unzip, read container.xml -> OPF (metadata, manifest, spine),
// then the navigation document (EPUB 3) or NCX (EPUB 2), then each XHTML file of the spine.
// Web Workers have no DOMParser, so htmlparser2 is used for XML and XHTML.

type Progress = (done: number, total: number) => void;

/** Font obfuscation is allowed (it is not DRM); any other encryption is. */
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

function parseXml(text: string) {
  return parseDocument(text, { xmlMode: true });
}

/** Local name of a tag, without namespace prefix ("dc:title" -> "title"). */
function local(el: Element): string {
  const name = el.name.toLowerCase();
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

function findAll(nodes: ChildNode[], test: (el: Element) => boolean, out: Element[] = []): Element[] {
  for (const n of nodes) {
    if (!isTag(n)) continue;
    if (test(n)) out.push(n);
    findAll(n.children, test, out);
  }
  return out;
}

function findFirst(nodes: ChildNode[], test: (el: Element) => boolean): Element | undefined {
  return findAll(nodes, test)[0];
}

function textOf(node: ChildNode): string {
  if (isText(node)) return node.data;
  if (isTag(node)) return node.children.map(textOf).join('');
  return '';
}

/** Resolves an href relative to the file it appears in. Returns a zip path without "#fragment". */
export function resolvePath(fromFile: string, href: string): { path: string; fragment: string | null } {
  const [rawPath, fragment = null] = href.split('#');
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // keep as is
  }
  const baseParts = fromFile.split('/').slice(0, -1);
  const parts = decoded ? [...baseParts, ...decoded.split('/')] : fromFile.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return { path: out.join('/'), fragment };
}

function readFile(zip: Unzipped, path: string): string | null {
  const data = zip[path] ?? Object.entries(zip).find(([k]) => k.toLowerCase() === path.toLowerCase())?.[1];
  return data ? strFromU8(data) : null;
}

function checkDrm(zip: Unzipped) {
  if (zip['META-INF/rights.xml']) {
    throw new ImportError('drm', 'This EPUB is protected by DRM. Only DRM-free books can be imported.');
  }
  const enc = readFile(zip, 'META-INF/encryption.xml');
  if (!enc) return;
  const doc = parseXml(enc);
  for (const data of findAll(doc.children, (el) => local(el) === 'encrypteddata')) {
    const method = findFirst(data.children, (el) => local(el) === 'encryptionmethod');
    const algorithm = method?.attribs.Algorithm ?? method?.attribs.algorithm ?? '';
    if (!FONT_OBFUSCATION.has(algorithm)) {
      throw new ImportError('drm', 'This EPUB is protected by DRM. Only DRM-free books can be imported.');
    }
  }
}

// ---------- XHTML content to blocks ----------

const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math', 'nav', 'img', 'audio', 'video', 'object', 'iframe', 'noscript']);
const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const BLOCKS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'body', 'figure', 'figcaption',
  'dl', 'dt', 'dd', 'pre', 'hr', 'address', 'center', 'tr', 'table', 'tbody', 'thead', 'tfoot',
]);

class ContentWalker {
  blocks: Block[] = [];
  /** "path#id" and "path" -> index of the first block at or after that point. */
  anchors = new Map<string, number>();
  private buffer = '';

  constructor(private path: string) {
    this.anchors.set(path, this.blocks.length);
  }

  private flush() {
    const text = normalizeText(this.buffer);
    this.buffer = '';
    if (text) this.blocks.push({ kind: 'paragraph', text, page: null });
  }

  private mark(el: Element) {
    const id = el.attribs.id ?? el.attribs.name;
    if (id && !this.anchors.has(`${this.path}#${id}`)) this.anchors.set(`${this.path}#${id}`, this.blocks.length);
  }

  /** Text of an element with <br> kept as line breaks, ids inside it recorded. */
  private inlineText(node: ChildNode): string {
    if (isText(node)) return node.data;
    if (!isTag(node)) return '';
    const name = local(node);
    if (SKIP.has(name)) return '';
    if (name === 'br') return '\n';
    this.mark(node);
    return node.children.map((c) => this.inlineText(c)).join('');
  }

  walk(nodes: ChildNode[]) {
    for (const node of nodes) {
      if (isText(node)) {
        this.buffer += node.data;
        continue;
      }
      if (!isTag(node)) continue;
      const name = local(node);
      if (SKIP.has(name)) continue;
      if (name === 'br') {
        this.buffer += '\n';
        continue;
      }
      if (name in HEADINGS) {
        this.flush();
        this.mark(node);
        const text = normalizeText(this.inlineText(node).replace(/\n/g, ' '));
        if (text) this.blocks.push({ kind: 'heading', text, level: HEADINGS[name], page: null, chapterLike: isChapterLike(text) });
        continue;
      }
      if (name === 'ul' || name === 'ol') {
        this.flush();
        this.mark(node);
        const items = node.children.filter((c): c is Element => isTag(c) && local(c) === 'li');
        const lines = items
          .map((li, i) => {
            const t = normalizeText(this.inlineText(li).replace(/\n+/g, ' '));
            return t ? `${name === 'ol' ? `${i + 1}.` : '•'} ${t}` : '';
          })
          .filter(Boolean);
        if (lines.length) this.blocks.push({ kind: 'list', text: lines.join('\n'), page: null });
        continue;
      }
      if (name === 'blockquote') {
        this.flush();
        this.mark(node);
        // The paragraphs of a quote stay together, one per line.
        const inner = new ContentWalker(this.path);
        inner.walk(node.children);
        for (const k of inner.anchors.keys()) if (!this.anchors.has(k)) this.anchors.set(k, this.blocks.length);
        const text = inner.blocks.map((b) => b.text).join('\n');
        if (text) this.blocks.push({ kind: 'quote', text, page: null });
        continue;
      }
      if (name === 'td' || name === 'th') {
        this.buffer += ' ' + this.inlineText(node) + ' |';
        continue;
      }
      if (BLOCKS.has(name) || name === 'li') {
        this.flush();
        this.mark(node);
        this.walk(node.children);
        if (name === 'tr') this.buffer = this.buffer.replace(/\s*\|\s*$/, '');
        this.flush();
        continue;
      }
      // Inline element (span, a, em, strong, sup...): keep walking in the same paragraph.
      this.mark(node);
      this.walk(node.children);
    }
  }

  finish() {
    this.flush();
  }
}

// ---------- Table of contents ----------

interface NavItem {
  title: string;
  href: string | null;
  children: NavItem[];
}

function navItems(ol: Element): NavItem[] {
  return ol.children
    .filter((c): c is Element => isTag(c) && local(c) === 'li')
    .map((li) => {
      const link = li.children.find((c): c is Element => isTag(c) && (local(c) === 'a' || local(c) === 'span'));
      const sub = li.children.find((c): c is Element => isTag(c) && local(c) === 'ol');
      return {
        title: normalizeText(link ? textOf(link) : ''),
        href: link && local(link) === 'a' ? (link.attribs.href ?? null) : null,
        children: sub ? navItems(sub) : [],
      };
    });
}

function ncxItems(parent: Element): NavItem[] {
  return parent.children
    .filter((c): c is Element => isTag(c) && local(c) === 'navpoint')
    .map((np) => {
      const label = findFirst(np.children, (el) => local(el) === 'text');
      const content = np.children.find((c): c is Element => isTag(c) && local(c) === 'content');
      return { title: normalizeText(label ? textOf(label) : ''), href: content?.attribs.src ?? null, children: ncxItems(np) };
    });
}

/** Uses the top level of the table of contents, or the level below if the top has a single entry (the book title). */
function chooseLevel(items: NavItem[]): NavItem[] {
  let level = items;
  while (level.length === 1 && level[0].children.length > 0) level = level[0].children;
  return level;
}

// ---------- Main ----------

export function extractEpub(bytes: Uint8Array, onProgress: Progress = () => {}): Extracted {
  let zip: Unzipped;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new ImportError('corrupt', 'This EPUB file is damaged and cannot be opened.');
  }
  checkDrm(zip);

  const container = readFile(zip, 'META-INF/container.xml');
  if (!container) throw new ImportError('corrupt', 'This EPUB file is damaged (container.xml is missing).');
  const rootfile = findFirst(parseXml(container).children, (el) => local(el) === 'rootfile');
  const opfPath = rootfile?.attribs['full-path'];
  const opfText = opfPath ? readFile(zip, opfPath) : null;
  if (!opfPath || !opfText) throw new ImportError('corrupt', 'This EPUB file is damaged (the package file is missing).');
  const opf = parseXml(opfText);

  const meta = (name: string) => {
    const els = findAll(opf.children, (el) => local(el) === name);
    return els.map((el) => normalizeText(textOf(el))).filter(Boolean);
  };
  const title = meta('title')[0] ?? null;
  const authors = meta('creator');
  const language = meta('language')[0] ?? null;

  // Manifest: id -> { path, type, properties }
  const manifest = new Map<string, { path: string; type: string; props: string }>();
  for (const item of findAll(opf.children, (el) => local(el) === 'item')) {
    const { id, href } = item.attribs;
    if (!id || !href) continue;
    manifest.set(id, {
      path: resolvePath(opfPath, href).path,
      type: item.attribs['media-type'] ?? '',
      props: item.attribs.properties ?? '',
    });
  }

  const spineEl = findFirst(opf.children, (el) => local(el) === 'spine');
  const spine = (spineEl ? findAll(spineEl.children, (el) => local(el) === 'itemref') : [])
    .filter((ref) => ref.attribs.linear !== 'no')
    .map((ref) => manifest.get(ref.attribs.idref))
    .filter((m): m is { path: string; type: string; props: string } => !!m && /html|xml/.test(m.type));
  if (spine.length === 0) throw new ImportError('corrupt', 'This EPUB file has no readable content.');

  // Read each content file of the spine, in order.
  const blocks: Block[] = [];
  const anchors = new Map<string, number>();
  spine.forEach((item, i) => {
    const html = readFile(zip, item.path);
    if (html) {
      const doc = parseDocument(html, { xmlMode: false, recognizeSelfClosing: true, decodeEntities: true });
      const body = findFirst(doc.children, (el) => local(el) === 'body');
      const walker = new ContentWalker(item.path);
      walker.walk(body ? body.children : doc.children);
      walker.finish();
      for (const [k, v] of walker.anchors) anchors.set(k, blocks.length + v);
      blocks.push(...walker.blocks);
    }
    onProgress(i + 1, spine.length);
  });
  if (blocks.length === 0) throw new ImportError('empty', 'This EPUB contains no readable text.');

  // Table of contents: EPUB 3 navigation document, else EPUB 2 NCX.
  let items: NavItem[] = [];
  let tocFile = '';
  const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
  const navText = navItem ? readFile(zip, navItem.path) : null;
  if (navItem && navText) {
    const doc = parseDocument(navText, { xmlMode: false, recognizeSelfClosing: true });
    const navs = findAll(doc.children, (el) => local(el) === 'nav');
    const toc = navs.find((n) => (n.attribs['epub:type'] ?? '').includes('toc')) ?? navs[0];
    const ol = toc && findFirst(toc.children, (el) => local(el) === 'ol');
    if (ol) {
      items = navItems(ol);
      tocFile = navItem.path;
    }
  }
  if (items.length === 0) {
    const ncxId = spineEl?.attribs.toc;
    const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
    const ncxText = ncx ? readFile(zip, ncx.path) : null;
    if (ncx && ncxText) {
      const navMap = findFirst(parseXml(ncxText).children, (el) => local(el) === 'navmap');
      if (navMap) {
        items = ncxItems(navMap);
        tocFile = ncx.path;
      }
    }
  }

  let toc: TocEntry[] | null = null;
  const chosen = chooseLevel(items);
  if (chosen.length > 0) {
    toc = [];
    for (const item of chosen) {
      if (!item.href) continue;
      const { path, fragment } = resolvePath(tocFile, item.href);
      const index = (fragment ? anchors.get(`${path}#${fragment}`) : undefined) ?? anchors.get(path);
      if (index !== undefined && index < blocks.length) toc.push({ title: item.title, blockIndex: index });
    }
  }

  return {
    format: 'epub',
    meta: { title, author: authors.length ? authors.join(', ') : null, language },
    blocks,
    toc,
    warnings: [],
  };
}
