import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import ImportButton, { importTexts, type ImportResult } from '../components/ImportButton';
import ProgressBar from '../components/ProgressBar';
import TopBar from '../components/TopBar';
import { db } from '../lib/db';
import { allCards, countRead, percent, toStatusMap } from '../lib/progress';

export default function Library() {
  const books = useLiveQuery(() => db.books.orderBy('id').toArray());
  const statuses = useLiveQuery(() => db.cardStatus.toArray());
  const positions = useLiveQuery(() => db.positions.toArray());
  const [results, setResults] = useState<ImportResult[]>([]);

  async function loadSample() {
    const res = await fetch('/sample-book.json');
    setResults(await importTexts([{ name: 'sample-book.json', text: await res.text() }]));
  }

  if (!books || !statuses || !positions) return null;

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
          <ImportButton onResults={setResults} />
        </div>

        {results.map((r, i) =>
          r.kind === 'ok' ? (
            <div key={i} className="notice notice-ok">
              {r.message}
            </div>
          ) : (
            <div key={i} className="notice notice-error" role="alert">
              <strong>Could not import {r.fileName}</strong>
              <ul>
                {r.errors.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
              </ul>
            </div>
          ),
        )}

        {books.length === 0 ? (
          <div className="empty">
            <p>No books yet. Import a book file (.json) to start reading.</p>
            <button className="btn" onClick={loadSample}>
              Load the sample book
            </button>
          </div>
        ) : (
          <ul className="list">
            {books.map((b) => {
              const map = toStatusMap(statuses.filter((s) => s.bookId === b.id));
              const read = countRead(allCards(b.file), map);
              const pct = percent(read, b.totalCards);
              const pos = positions.find((p) => p.bookId === b.id);
              const posCard = pos && allCards(b.file).find((c) => c.id === pos.cardId);
              const continueNumber = posCard?.number ?? 1;
              return (
                <li key={b.id} className="book-item">
                  <Link to={`/book/${encodeURIComponent(b.id)}`} className="book-link">
                    <div className="book-title">{b.file.book.title}</div>
                    <div className="muted">{b.file.book.author}</div>
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
      </main>
    </div>
  );
}
