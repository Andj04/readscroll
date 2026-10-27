import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import TopBar from '../components/TopBar';
import { toggleBookmark } from '../lib/actions';
import { db } from '../lib/db';
import { allCards, cardPlace, chapterOfCard } from '../lib/progress';

const PREVIEW_CHARS = 140;

export default function Bookmarks() {
  const bookmarks = useLiveQuery(() => db.bookmarks.orderBy('createdAt').reverse().toArray());
  const books = useLiveQuery(() => db.books.toArray());
  if (!bookmarks || !books) return null;

  const active = bookmarks.filter((b) => !b.deleted);

  return (
    <div className="screen">
      <TopBar back="/" title="Bookmarks" />
      <main className="content">
        <h1 className="h1">Bookmarks</h1>
        {active.length === 0 ? (
          <p className="muted">No bookmarks yet. Tap the bookmark icon while reading to save a card.</p>
        ) : (
          <ul className="list">
            {active.map((bm) => {
              const book = books.find((b) => b.id === bm.bookId);
              const card = book && allCards(book).find((c) => c.id === bm.cardId);
              const chapter = book && card && chapterOfCard(book, card.number);
              return (
                <li key={`${bm.bookId}/${bm.cardId}`} className="bookmark-item">
                  {book && card ? (
                    <Link to={`/book/${encodeURIComponent(bm.bookId)}/read/${card.number}`} className="bookmark-link">
                      <div className="muted small">
                        {book.title} · Ch. {chapter?.number} · {cardPlace(card)} · #{card.number}
                      </div>
                      {card.title && <div className="bookmark-title">{card.title}</div>}
                      <div className="bookmark-text">
                        {card.text.length > PREVIEW_CHARS ? `${card.text.slice(0, PREVIEW_CHARS)}…` : card.text}
                      </div>
                    </Link>
                  ) : (
                    <div className="bookmark-link muted">
                      Card {bm.cardId} (book “{bm.bookId}” is not imported on this device)
                    </div>
                  )}
                  <button
                    className="icon-btn"
                    onClick={() => toggleBookmark(bm.bookId, bm.cardId)}
                    aria-label="Remove bookmark"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
