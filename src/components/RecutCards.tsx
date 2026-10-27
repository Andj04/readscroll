import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { buildInWorker, type ImportProgress } from '../import/client';
import { LENGTH_RULES } from '../import/types';
import { saveImportedBook } from '../lib/actions';
import { db } from '../lib/db';
import type { CardLength, StoredBook } from '../lib/model';

const LENGTHS: { value: CardLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

/**
 * Cuts the book again with another card length, from the text kept on this device.
 * Read marks, position and bookmarks move to the new cards by position in the text.
 */
export default function RecutCards({ book }: { book: StoredBook }) {
  const source = useLiveQuery(() => db.sources.get(book.id), [book.id]);
  const [length, setLength] = useState<CardLength>(book.cardLength);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!source) return null;

  async function recut() {
    if (!source) return;
    setMessage(null);
    setProgress({ stage: 'Cutting cards', done: 0, total: 1 });
    try {
      const chapters = await buildInWorker(
        { bookId: book.id, blocks: source.blocks, chapters: source.plan, cardLength: length, lang: source.lang ?? undefined },
        setProgress,
      ).promise;
      const totalCards = chapters.reduce((n, c) => n + c.cards.length, 0);
      // Books from old JSON files keep their quiz data on the chapter with the same number.
      const withQuiz = chapters.map((c) => {
        const quiz = book.chapters.find((o) => o.number === c.number)?.quiz;
        return quiz ? { ...c, quiz } : c;
      });
      await saveImportedBook({ ...book, chapters: withQuiz, totalCards, cardLength: length }, source);
      setMessage(`Done: ${totalCards} cards. Your progress was kept.`);
    } catch (e) {
      setMessage((e as Error).message || 'The book could not be re-cut.');
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="setting recut">
      <h2 className="h2">Card length</h2>
      <div className="segmented" role="radiogroup" aria-label="Card length for this book">
        {LENGTHS.map((l) => (
          <button key={l.value} role="radio" aria-checked={length === l.value} className={length === l.value ? 'on' : ''} onClick={() => setLength(l.value)}>
            {l.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        About {LENGTH_RULES[length].targetMin} to {LENGTH_RULES[length].targetMax} words per card. Your read marks, position and
        bookmarks are moved to the new cards.
      </p>
      <button className="btn" disabled={!!progress || length === book.cardLength} onClick={recut}>
        {progress ? 'Cutting…' : 'Re-cut cards'}
      </button>
      {message && (
        <p className="muted small" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
