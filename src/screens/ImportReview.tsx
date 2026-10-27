import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import ImportButton from '../components/ImportButton';
import TopBar from '../components/TopBar';
import { useSettings } from '../hooks/data';
import { buildInWorker, type ImportProgress } from '../import/client';
import type { ParsedBook } from '../import/extract';
import { blockOffsets, segmentChapter } from '../import/segment';
import { cancelImport, finishImport, useImportState } from '../import/session';
import { countWords } from '../import/textUtils';
import { LENGTH_RULES, type CardLength, type ChapterMethod, type PlannedChapter } from '../import/types';
import { saveImportedBook } from '../lib/actions';
import { db } from '../lib/db';
import type { StoredBook } from '../lib/model';

const METHOD_TEXT: Record<ChapterMethod, string> = {
  toc: 'Chapters come from the book’s table of contents.',
  outline: 'Chapters come from the PDF bookmarks (outline).',
  headings: 'Chapters were guessed from the headings in the text. Check them below.',
  none: 'No reliable chapters were found, so the whole book is one chapter. Open it and use “Split here” to divide it.',
};

const LENGTHS: { value: CardLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

export default function ImportReview() {
  const state = useImportState();
  const navigate = useNavigate();
  const cancel = () => {
    navigate('/', { replace: true });
    cancelImport();
  };

  // No import in progress (e.g. the page was reloaded): nothing is kept in memory.
  // A message rather than an automatic redirect, which would race with the
  // navigation to the new book right after "Add to library".
  if (state.status === 'idle') {
    return (
      <div className="screen">
        <TopBar back="/" title="Import" />
        <main className="content empty">
          <p>No import in progress.</p>
          <Link to="/" className="btn">
            Back to library
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar
        title="Import"
        actions={
          <button className="btn btn-small" onClick={cancel}>
            Cancel
          </button>
        }
      />
      <main className="content">
        {state.status === 'parsing' && <ParsingView fileName={state.fileName} progress={state.progress} />}
        {state.status === 'error' && (
          <>
            <h1 className="h1">Could not import</h1>
            <div className="notice notice-error" role="alert">
              <strong>{state.fileName}</strong>
              <p>{state.message}</p>
            </div>
            <div className="row-between">
              <Link to="/" className="btn" onClick={cancelImport}>
                Back to library
              </Link>
              <ImportButton label="Choose another file" />
            </div>
          </>
        )}
        {state.status === 'review' && <ReviewForm key={state.parsed.bookId + state.fileName} fileName={state.fileName} parsed={state.parsed} onCancel={cancel} />}
      </main>
    </div>
  );
}

function ProgressView({ title, progress }: { title: string; progress: ImportProgress | null }) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="import-progress" aria-live="polite">
      <p className="muted small">{title}</p>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small">
        {progress ? `${progress.stage}… ${progress.total > 1 ? `${progress.done} / ${progress.total}` : ''}` : 'Opening the file…'}
      </p>
    </div>
  );
}

function ParsingView({ fileName, progress }: { fileName: string; progress: ImportProgress | null }) {
  return (
    <>
      <h1 className="h1">Reading the file</h1>
      <ProgressView title={fileName} progress={progress} />
      <p className="muted small">The file is read on this device. Its text is not sent anywhere.</p>
    </>
  );
}

function ReviewForm({ fileName, parsed, onCancel }: { fileName: string; parsed: ParsedBook; onCancel: () => void }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const { bookId, extracted } = parsed;
  const { blocks, meta, warnings } = extracted;
  const lang = meta.language ?? undefined;

  const [title, setTitle] = useState(meta.title ?? fileName.replace(/\.[^.]+$/, ''));
  const [author, setAuthor] = useState(meta.author ?? '');
  const [chapters, setChapters] = useState<PlannedChapter[]>(parsed.chapters);
  const [cardLength, setCardLength] = useState<CardLength>(settings.cardLength ?? 'medium');
  const [open, setOpen] = useState<number | null>(null);
  const [building, setBuilding] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Is this book (same text) already here, or is there progress waiting for it?
  const existing = useLiveQuery(() => db.books.get(bookId), [bookId]);
  const ref = useLiveQuery(() => db.bookRefs.get(bookId), [bookId]);
  const progressCount = useLiveQuery(() => db.cardStatus.where('bookId').equals(bookId).count(), [bookId]);

  const offsets = useMemo(() => blockOffsets(blocks), [blocks]);
  const blockWords = useMemo(() => blocks.map((b) => countWords(b.text, lang)), [blocks, lang]);
  const wordsOf = (ch: PlannedChapter) => blockWords.slice(ch.start, ch.end).reduce((a, b) => a + b, 0);

  // ---------- Chapter edits ----------
  const update = (next: PlannedChapter[]) => {
    setChapters(next);
    setOpen(null);
  };
  const rename = (i: number, t: string) => setChapters(chapters.map((c, k) => (k === i ? { ...c, title: t } : c)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...chapters];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    update(next);
  };
  // Merging only makes sense for chapters that follow each other in the text.
  const canMerge = (i: number) => i + 1 < chapters.length && chapters[i].end === chapters[i + 1].start;
  const merge = (i: number) => update([...chapters.slice(0, i), { ...chapters[i], end: chapters[i + 1].end }, ...chapters.slice(i + 2)]);
  const remove = (i: number) => update(chapters.filter((_, k) => k !== i));
  const split = (i: number, at: number) => {
    const ch = chapters[i];
    const newTitle = blocks[at].kind === 'heading' ? blocks[at].text : 'New chapter';
    const next = [...chapters.slice(0, i), { ...ch, end: at }, { title: newTitle, start: at, end: ch.end }, ...chapters.slice(i + 1)];
    setChapters(next);
    setOpen(i);
  };

  async function confirm() {
    setError(null);
    if (!title.trim()) return setError('Please give the book a title.');
    if (chapters.length === 0) return setError('Keep at least one chapter.');
    setBuilding({ stage: 'Cutting cards', done: 0, total: 1 });
    try {
      const plan = chapters.map((c) => ({ ...c, title: c.title.trim() || 'Untitled chapter' }));
      const built = await buildInWorker({ bookId, blocks, chapters: plan, cardLength, lang }, setBuilding).promise;
      const totalCards = built.reduce((n, c) => n + c.cards.length, 0);
      if (totalCards === 0) throw new Error('These chapters contain no text.');
      const book: StoredBook = {
        id: bookId,
        title: title.trim(),
        author: author.trim(),
        language: meta.language,
        identity: 'content',
        format: extracted.format,
        chapters: built,
        totalCards,
        cardLength,
        importedAt: Date.now(),
      };
      await saveImportedBook(book, { bookId, blocks, plan, lang: meta.language });
      navigate(`/book/${encodeURIComponent(bookId)}`, { replace: true });
      finishImport();
    } catch (e) {
      setBuilding(null);
      setError((e as Error).message || 'The book could not be saved.');
    }
  }

  if (building) {
    return (
      <>
        <h1 className="h1">Creating cards</h1>
        <ProgressView title={title} progress={building} />
      </>
    );
  }

  return (
    <>
      <h1 className="h1">Review the import</h1>
      <p className="muted small">Nothing is saved until you tap “Add to library”. {fileName}</p>

      {existing && <div className="notice notice-ok">This book is already in your library. Importing it again replaces it and keeps your progress.</div>}
      {!existing && ref && (progressCount ?? 0) > 0 && (
        <div className="notice notice-ok">Your progress for “{ref.title}” will be linked to this book.</div>
      )}

      <section className="setting">
        <label className="field">
          <span className="setting-label">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="setting-label">Author</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Unknown" />
        </label>
      </section>

      <section className="setting">
        <div className="setting-label">Card length</div>
        <div className="segmented" role="radiogroup" aria-label="Card length">
          {LENGTHS.map((l) => (
            <button key={l.value} role="radio" aria-checked={cardLength === l.value} className={cardLength === l.value ? 'on' : ''} onClick={() => setCardLength(l.value)}>
              {l.label}
            </button>
          ))}
        </div>
        <p className="muted small">
          About {LENGTH_RULES[cardLength].targetMin} to {LENGTH_RULES[cardLength].targetMax} words per card.
        </p>
      </section>

      {warnings.length > 0 && (
        <div className="notice notice-warn" role="status">
          <strong>Check these pages</strong>
          <ul>
            {warnings.slice(0, 12).map((w, i) => (
              <li key={i}>
                {w.page !== null ? `Page ${w.page}: ` : ''}
                {w.message}
              </li>
            ))}
            {warnings.length > 12 && <li>…and {warnings.length - 12} more.</li>}
          </ul>
        </div>
      )}

      <h2 className="h2">Chapters ({chapters.length})</h2>
      <p className="muted small">{METHOD_TEXT[parsed.method]}</p>

      <ol className="review-chapters">
        {chapters.map((ch, i) => (
          <li key={`${ch.start}-${i}`} className="review-chapter">
            <div className="review-row">
              <span className="muted review-num">{i + 1}</span>
              <input aria-label={`Title of chapter ${i + 1}`} value={ch.title} onChange={(e) => rename(i, e.target.value)} />
            </div>
            <div className="review-meta muted small">
              {wordsOf(ch).toLocaleString()} words · about {Math.max(1, Math.round(wordsOf(ch) / ((LENGTH_RULES[cardLength].targetMin + LENGTH_RULES[cardLength].targetMax) / 2)))} cards
            </div>
            <div className="review-actions">
              <button className="chip" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                {open === i ? 'Close' : 'Preview / split'}
              </button>
              <button className="chip" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move chapter ${i + 1} up`}>
                ↑
              </button>
              <button className="chip" disabled={i === chapters.length - 1} onClick={() => move(i, 1)} aria-label={`Move chapter ${i + 1} down`}>
                ↓
              </button>
              <button className="chip" disabled={!canMerge(i)} onClick={() => merge(i)}>
                Merge with next
              </button>
              <button className="chip chip-danger" disabled={chapters.length === 1} onClick={() => remove(i)}>
                Delete
              </button>
            </div>
            {open === i && <ChapterDetail parsed={parsed} offsets={offsets} chapter={ch} cardLength={cardLength} lang={lang} onSplit={(at) => split(i, at)} />}
          </li>
        ))}
      </ol>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="review-footer">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={confirm}>
          <Icon name="check" size={18} /> Add to library
        </button>
      </div>
    </>
  );
}

const SPLIT_POINTS_SHOWN = 60;

/** Preview of the first cards of a chapter, and the places where it can be split. */
function ChapterDetail(props: {
  parsed: ParsedBook;
  offsets: number[];
  chapter: PlannedChapter;
  cardLength: CardLength;
  lang?: string;
  onSplit: (blockIndex: number) => void;
}) {
  const { parsed, offsets, chapter, cardLength, lang, onSplit } = props;
  const blocks = parsed.extracted.blocks;
  const [shown, setShown] = useState(SPLIT_POINTS_SHOWN);
  const preview = useMemo(
    () => segmentChapter(blocks, offsets, chapter, { rules: LENGTH_RULES[cardLength], lang, limit: 2 }),
    [blocks, offsets, chapter, cardLength, lang],
  );
  const points = [];
  for (let i = chapter.start + 1; i < chapter.end && points.length < shown; i++) points.push(i);

  return (
    <div className="chapter-detail">
      <div className="muted small">First cards</div>
      {preview.length === 0 && <p className="muted small">This chapter has no text and will be left out.</p>}
      {preview.map((c, k) => (
        <article key={k} className="card preview-card">
          <div className="card-meta">
            <span>{c.page !== null ? `p. ${c.page}` : ''}</span>
            <span>{c.wordCount} words</span>
          </div>
          {c.title && <h3 className="card-title">{c.title}</h3>}
          <p className="card-text">{c.text}</p>
        </article>
      ))}

      {chapter.end - chapter.start > 1 && (
        <>
          <div className="muted small split-label">Split this chapter before…</div>
          <ul className="split-points">
            {points.map((i) => (
              <li key={i} className={blocks[i].kind === 'heading' ? 'split-heading' : ''}>
                <span className="split-text">
                  {blocks[i].page !== null && <span className="muted">p. {blocks[i].page} · </span>}
                  {blocks[i].text.slice(0, 90)}
                  {blocks[i].text.length > 90 ? '…' : ''}
                </span>
                <button className="chip" onClick={() => onSplit(i)}>
                  Split here
                </button>
              </li>
            ))}
          </ul>
          {chapter.start + 1 + shown < chapter.end && (
            <button className="btn btn-small" onClick={() => setShown(shown + SPLIT_POINTS_SHOWN)}>
              Show more
            </button>
          )}
        </>
      )}
    </div>
  );
}
