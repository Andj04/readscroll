import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import ProgressBar from '../components/ProgressBar';
import TopBar from '../components/TopBar';
import { useBook, usePosition, useStatusMap } from '../hooks/data';
import { allCards, cardRange, countRead, percent } from '../lib/progress';
import NotFound from './NotFound';

export default function ChapterList() {
  const bookId = useParams().bookId ?? '';
  const book = useBook(bookId);
  const statuses = useStatusMap(bookId);
  const position = usePosition(bookId);

  if (book === undefined) return null;
  if (book === null) return <NotFound message="This book is not imported on this device." />;

  const cards = allCards(book);
  const read = countRead(cards, statuses);
  const posCard = position && cards.find((c) => c.id === position.cardId);
  const base = `/book/${encodeURIComponent(bookId)}`;

  return (
    <div className="screen">
      <TopBar back="/" title={book.title} />
      <main className="content">
        <h1 className="h1">{book.title}</h1>
        <p className="muted">{book.author}</p>
        <ProgressBar value={percent(read, cards.length)} />
        <div className="row-between">
          <span className="muted small">
            {percent(read, cards.length)}% · {read} of {cards.length} cards
          </span>
          <Link className="btn btn-small btn-primary" to={`${base}/read/${posCard?.number ?? 1}`}>
            {posCard ? 'Continue reading' : 'Start reading'}
          </Link>
        </div>

        <h2 className="h2">Chapters</h2>
        <ul className="list">
          {book.chapters.map((ch) => {
            const done = countRead(ch.cards, statuses);
            const finished = done === ch.cards.length;
            return (
              <li key={ch.number}>
                <Link to={`${base}/chapter/${ch.number}`} className="chapter-row">
                  <div className="chapter-main">
                    <div className="chapter-title">
                      <span className="muted">{ch.number}.</span> {ch.title}
                    </div>
                    <div className="muted small">{cardRange(ch)}</div>
                  </div>
                  {finished ? (
                    <span className="badge-done" aria-label="Finished">
                      <Icon name="check" size={18} />
                    </span>
                  ) : done > 0 ? (
                    <span className="counter">
                      {done}/{ch.cards.length}
                    </span>
                  ) : null}
                  <Icon name="chevron" size={18} />
                </Link>
              </li>
            );
          })}
        </ul>

      </main>
    </div>
  );
}
