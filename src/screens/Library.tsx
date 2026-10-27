import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import ImportButton from '../components/ImportButton';
import ProgressBar from '../components/ProgressBar';
import TopBar from '../components/TopBar';
import { db } from '../lib/db';
import { allCards, countRead, percent, toStatusMap } from '../lib/progress';

export default function Library() {
  const books = useLiveQuery(() => db.books.orderBy('id').toArray());
  const statuses = useLiveQuery(() => db.cardStatus.toArray());
  const positions = useLiveQuery(() => db.positions.toArray());
  const refs = useLiveQuery(() => db.bookRefs.toArray());

  if (!books || !statuses || !positions || !refs) return null;

  // Books known from progress (e.g. synced from another device) whose text is not on this device.
  const needsImport = refs.filter((r) => !books.some((b) => b.id === r.bookId));

  return (
    <div className="screen">
      <TopBar
        title={<span className="app-name">Reading Cards</span>}
        actions={
          <>
            <Link to="/bookmarks" className="icon-btn" aria-label="Bookmarks">
              <Icon name="bookmark" />
            </Link>
            <Link to="/settings" className="icon-btn" aria-label="Settings">
              <Icon name="settings" />
            </Link>
          </>
        }
      />

      <main className="content">
        <div className="row-between">
          <h1 className="h1">Library</h1>
          <ImportButton />
        </div>

        {books.length === 0 ? (
          <div className="empty">
            <p>No books yet. Import a PDF, EPUB or text file you own: it is turned into cards on this device.</p>
          </div>
        ) : (
          <ul className="list">
            {books.map((b) => {
              const map = toStatusMap(statuses.filter((s) => s.bookId === b.id));
              const read = countRead(allCards(b), map);
              const pct = percent(read, b.totalCards);
              const pos = positions.find((p) => p.bookId === b.id);
              const posCard = pos && allCards(b).find((c) => c.id === pos.cardId);
              const continueNumber = posCard?.number ?? 1;
              return (
                <li key={b.id} className="book-item">
                  <Link to={`/book/${encodeURIComponent(b.id)}`} className="book-link">
                    <div className="book-title">{b.title}</div>
                    <div className="muted">{b.author}</div>
                  </Link>
                  <ProgressBar value={pct} />
                  <div className="row-between">
                    <span className="muted small">
                      {pct}% · {read} of {b.totalCards} cards
                    </span>
                    <Link className="btn btn-small" to={`/book/${encodeURIComponent(b.id)}/read/${continueNumber}`}>
                      {read === 0 && !pos ? 'Start reading' : 'Continue reading'}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {needsImport.length > 0 && (
          <>
            <h2 className="h2">Needs import on this device</h2>
            <ul className="list">
              {needsImport.map((r) => {
                const read = statuses.filter((s) => s.bookId === r.bookId && s.read).length;
                const pct = percent(read, r.totalCards);
                return (
                  <li key={r.bookId} className="book-item book-missing" data-testid="needs-import">
                    <div className="book-title">{r.title}</div>
                    <div className="muted">{r.author}</div>
                    <ProgressBar value={pct} />
                    <div className="row-between">
                      <span className="muted small">
                        {pct}% read · import the same file to continue
                      </span>
                      <ImportButton label="Import" className="btn btn-small" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
