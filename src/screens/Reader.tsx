import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { useBook, useBookmarkedIds, useStatusMap } from '../hooks/data';
import { markPassedCards, savePosition, setCardsRead, toggleBookmark } from '../lib/actions';
import { db, DEFAULT_SETTINGS } from '../lib/db';
import { chapterLabel, chapterOfCard, countRead, isRead, type StatusMap } from '../lib/progress';
import type { BookFile, Chapter } from '../lib/model';
import NotFound from './NotFound';

/** Loads the book and settings, then renders the chapter that contains the requested card. */
export default function Reader() {
  const params = useParams();
  const bookId = params.bookId ?? '';
  const book = useBook(bookId);
  const statuses = useStatusMap(bookId);
  const bookmarked = useBookmarkedIds(bookId);
  // Wait for the real settings so the reader does not start in the wrong mode.
  const settings = useLiveQuery(async () => (await db.settings.get('local')) ?? DEFAULT_SETTINGS);

  if (book === undefined || settings === undefined) return null;
  if (book === null) return <NotFound message="This book is not imported on this device." />;

  const number = Number(params.cardNumber);
  const chapter = chapterOfCard(book.file, number);
  if (!chapter) return <NotFound message="This card does not exist." />;

  return (
    <ChapterReader
      // A new chapter or a new mode mounts a fresh reader that starts at the requested card.
      key={`${chapter.number}-${settings.readingMode}`}
      bookId={bookId}
      file={book.file}
      chapter={chapter}
      startIndex={chapter.cards.findIndex((c) => c.number === number)}
      statuses={statuses}
      bookmarked={bookmarked}
      horizontal={settings.readingMode === 'horizontal'}
    />
  );
}

interface ChapterReaderProps {
  bookId: string;
  file: BookFile;
  chapter: Chapter;
  startIndex: number;
  statuses: StatusMap;
  bookmarked: Set<string>;
  horizontal: boolean;
}

// Height (vertical mode) or width (horizontal mode) of the next card left visible.
const PEEK_PX = 56;

function ChapterReader({ bookId, file, chapter, startIndex, statuses, bookmarked, horizontal }: ChapterReaderProps) {
  const navigate = useNavigate();
  const cards = chapter.cards;
  const stage = useRef<HTMLDivElement>(null);
  // index === cards.length means the "end of chapter" slide is showing.
  const [index, setIndex] = useState(startIndex);
  const lastIndex = useRef(startIndex);
  const [menuOpen, setMenuOpen] = useState(false);

  const base = `/book/${encodeURIComponent(bookId)}`;
  const chapterPos = file.chapters.indexOf(chapter);
  const prevChapter = file.chapters[chapterPos - 1];
  const nextChapter = file.chapters[chapterPos + 1];
  const current = cards[index];

  const slides = () => Array.from(stage.current?.querySelectorAll<HTMLElement>(':scope > .slide') ?? []);
  const offsetOf = (el: HTMLElement) => (horizontal ? el.offsetLeft : el.offsetTop);

  // Jump (without animation) to the starting card on mount.
  useLayoutEffect(() => {
    const el = slides()[startIndex];
    if (el) stage.current?.scrollTo({ [horizontal ? 'left' : 'top']: offsetOf(el) });
  }, []);

  // Work out which card is showing from the scroll position. A card becomes
  // "current" once its start edge enters the first 35% of the screen.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const pos = horizontal ? s.scrollLeft : s.scrollTop;
        const size = horizontal ? s.clientWidth : s.clientHeight;
        let idx = 0;
        slides().forEach((el, i) => {
          if (offsetOf(el) <= pos + size * 0.35) idx = i;
        });
        setIndex(idx);
      });
    };
    s.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      s.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [horizontal]);

  // When the current card changes: mark the cards passed going forward as read,
  // save the position, and keep the URL in sync (without adding history entries).
  useEffect(() => {
    const prev = lastIndex.current;
    if (index > prev) markPassedCards(bookId, cards.slice(prev, index).map((c) => c.id));
    lastIndex.current = index;
    const card = cards[index];
    if (card) {
      savePosition(bookId, card.id);
      navigate(`${base}/read/${card.number}`, { replace: true });
    }
  }, [index]);

  /** Next (1) or previous (-1) card. Crosses into the next or previous chapter at the edges. */
  function go(dir: 1 | -1) {
    const s = stage.current;
    if (!s) return;
    if (dir === 1 && index >= cards.length) {
      if (nextChapter) navigate(`${base}/read/${nextChapter.cards[0].number}`);
      return;
    }
    if (dir === -1 && index === 0) {
      if (prevChapter) navigate(`${base}/read/${prevChapter.cards[prevChapter.cards.length - 1].number}`);
      return;
    }

    const list = slides();
    const cur = list[index];
    // A long card may not fit on screen: scroll through it before moving to the next one.
    if (cur && scrollWithinCard(s, cur, dir)) return;

    const target = list[index + dir];
    if (target) s.scrollTo({ [horizontal ? 'left' : 'top']: offsetOf(target), behavior: 'smooth' });
  }

  /** Returns true if it scrolled inside the current card instead of changing card. */
  function scrollWithinCard(s: HTMLElement, cur: HTMLElement, dir: 1 | -1): boolean {
    if (horizontal) {
      // In horizontal mode each card scrolls vertically on its own.
      const hiddenBelow = cur.scrollHeight - cur.clientHeight - cur.scrollTop;
      const step = cur.clientHeight * 0.8;
      if (dir === 1 && hiddenBelow > 4) cur.scrollBy({ top: Math.min(hiddenBelow, step), behavior: 'smooth' });
      else if (dir === -1 && cur.scrollTop > 4) cur.scrollBy({ top: -Math.min(cur.scrollTop, step), behavior: 'smooth' });
      else return false;
      return true;
    }
    const step = s.clientHeight * 0.8;
    const hiddenBelow = cur.offsetTop + cur.offsetHeight - (s.scrollTop + s.clientHeight - PEEK_PX);
    const hiddenAbove = s.scrollTop - cur.offsetTop;
    if (dir === 1 && hiddenBelow > 4) s.scrollBy({ top: Math.min(hiddenBelow, step), behavior: 'smooth' });
    else if (dir === -1 && hiddenAbove > 4) s.scrollBy({ top: -Math.min(hiddenAbove, step), behavior: 'smooth' });
    else return false;
    return true;
  }

  // Tap zones: right half for next, left half for previous.
  function onTap(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button, a')) return;
    if (window.getSelection()?.toString()) return; // the user was selecting text
    const rect = e.currentTarget.getBoundingClientRect();
    go(e.clientX - rect.left > rect.width / 2 ? 1 : -1);
  }

  // Keyboard: arrows, space and page keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (menuOpen || e.altKey || e.ctrlKey || e.metaKey) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const currentRead = current ? isRead(statuses, current.id) : false;
  const currentBookmarked = current ? bookmarked.has(current.id) : false;
  const doneInChapter = countRead(cards, statuses);

  return (
    <div className="reader">
      <header className="reader-top">
        <Link to={`${base}/chapter/${chapter.number}`} className="icon-btn" aria-label="Back to card list">
          <Icon name="back" />
        </Link>
        <div className="reader-titles">
          <div className="reader-book">{file.book.title}</div>
          <div className="reader-chapter">{chapterLabel(chapter)}</div>
        </div>
        <Link to="/settings" className="icon-btn" aria-label="Reading settings">
          <Icon name="type" />
        </Link>
      </header>

      <div className="segments" aria-hidden="true">
        {cards.map((c, i) => (
          <span key={c.id} className={`seg${i === index ? ' seg-current' : isRead(statuses, c.id) ? ' seg-read' : ''}`} />
        ))}
      </div>

      <div
        ref={stage}
        className={`stage ${horizontal ? 'stage-h' : 'stage-v'}`}
        style={{ ['--peek' as string]: `${PEEK_PX}px` }}
        onClick={onTap}
      >
        {cards.map((c) => (
          <div className="slide" key={c.id}>
            <article className="card">
              <div className="card-meta">
                <span>p. {c.page}</span>
                <span>
                  {isRead(statuses, c.id) && (
                    <span className="read-mark" title="Read">
                      <Icon name="check" size={14} />
                    </span>
                  )}
                  #{c.number}
                </span>
              </div>
              {c.title && <h2 className="card-title">{c.title}</h2>}
              <p className="card-text">{c.text}</p>
            </article>
          </div>
        ))}

        <div className="slide">
          <article className="card card-end">
            <p className="muted small">End of chapter {chapter.number}</p>
            <h2 className="card-title">{chapter.title}</h2>
            <p className="muted">
              {doneInChapter} of {cards.length} cards read
            </p>
            {nextChapter ? (
              <button className="btn btn-primary" onClick={() => go(1)}>
                Next: {chapterLabel(nextChapter)}
              </button>
            ) : (
              <>
                <p>You reached the end of the book.</p>
                <Link to="/" className="btn btn-primary">
                  Back to library
                </Link>
              </>
            )}
          </article>
        </div>
        {/* Extra space so the last slide can scroll fully into place. */}
        <div className="slide-spacer" />
      </div>

      <footer className="reader-bottom">
        <span className="muted small">
          {current ? `Card ${index + 1} of ${cards.length}` : 'End of chapter'}
        </span>
        {current && (
          <div className="reader-actions">
            <button
              className={`chip${currentRead ? ' chip-on' : ''}`}
              onClick={() => setCardsRead(bookId, [current.id], !currentRead)}
              aria-pressed={currentRead}
            >
              <Icon name="check" size={16} /> {currentRead ? 'Read' : 'Mark read'}
            </button>
            <button
              className={`icon-btn${currentBookmarked ? ' icon-on' : ''}`}
              onClick={() => toggleBookmark(bookId, current.id)}
              aria-label={currentBookmarked ? 'Remove bookmark' : 'Bookmark this card'}
              aria-pressed={currentBookmarked}
            >
              <Icon name="bookmark" filled={currentBookmarked} />
            </button>
            <button className="icon-btn" onClick={() => setMenuOpen(true)} aria-label="More actions">
              <Icon name="more" />
            </button>
          </div>
        )}
      </footer>

      {menuOpen && current && (
        <div className="sheet-backdrop" onClick={() => setMenuOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Card actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="sheet-item"
              onClick={() => {
                const before = file.chapters.flatMap((ch) => ch.cards).filter((c) => c.number < current.number);
                setCardsRead(bookId, before.filter((c) => !isRead(statuses, c.id)).map((c) => c.id), true);
                setMenuOpen(false);
              }}
            >
              Mark everything before this card as read
            </button>
            <button
              className="sheet-item"
              onClick={() => {
                setCardsRead(bookId, cards.filter((c) => !isRead(statuses, c.id)).map((c) => c.id), true);
                setMenuOpen(false);
              }}
            >
              Mark this chapter as read
            </button>
            <button className="sheet-item sheet-cancel" onClick={() => setMenuOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
