import { Link, useParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useBook, usePosition, useStatusMap } from '../hooks/data';
import { setCardsRead } from '../lib/actions';
import { allCards, cardRange, chapterLabel, countRead, isRead, nextUnreadCard } from '../lib/progress';
import NotFound from './NotFound';

export default function CardPicker() {
  const params = useParams();
  const bookId = params.bookId ?? '';
  const book = useBook(bookId);
  const statuses = useStatusMap(bookId);
  const position = usePosition(bookId);

  if (book === undefined) return null;
  if (book === null) return <NotFound message="This book is not imported on this device." />;

  const chapter = book.file.chapters.find((c) => String(c.number) === params.chapterNumber);
  if (!chapter) return <NotFound message="This chapter does not exist." />;

  const cards = allCards(book.file);
  const posNumber = cards.find((c) => c.id === position?.cardId)?.number ?? 1;
  const next = nextUnreadCard(cards, statuses, posNumber);
  const done = countRead(chapter.cards, statuses);
  const base = `/book/${encodeURIComponent(bookId)}`;

  return (
    <div className="screen">
      <TopBar back={base} title={book.file.book.title} />
      <main className="content">
        <h1 className="h1">{chapterLabel(chapter)}</h1>
        <div className="row-between">
          <span className="muted small">
            {cardRange(chapter)} · {done} of {chapter.cards.length} read
          </span>
          <button
            className="btn btn-small"
            disabled={done === chapter.cards.length}
            onClick={() => setCardsRead(bookId, chapter.cards.map((c) => c.id), true)}
          >
            Mark chapter as read
          </button>
        </div>

        <div className="card-grid">
          {chapter.cards.map((c) => {
            const state = isRead(statuses, c.id) ? 'read' : c.id === next?.id ? 'next' : 'unread';
            return (
              <Link
                key={c.id}
                to={`${base}/read/${c.number}`}
                className={`grid-cell grid-${state}`}
                aria-label={`Card ${c.number}, ${state === 'next' ? 'next unread' : state}`}
              >
                {c.number}
              </Link>
            );
          })}
        </div>

        <div className="legend muted small">
          <span>
            <i className="grid-cell grid-read" /> Read
          </span>
          <span>
            <i className="grid-cell grid-next" /> Next unread
          </span>
          <span>
            <i className="grid-cell grid-unread" /> Unread
          </span>
        </div>
      </main>
    </div>
  );
}
