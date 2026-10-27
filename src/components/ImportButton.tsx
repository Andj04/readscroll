import { useRef } from 'react';
import { saveBook } from '../lib/actions';
import { validateBookJson } from '../lib/schema';
import Icon from './Icon';

export type ImportResult =
  | { kind: 'ok'; message: string }
  | { kind: 'error'; fileName: string; errors: string[] };

/** Reads one or more JSON files, validates each one and stores the valid ones. */
export async function importTexts(files: { name: string; text: string }[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const { name, text } of files) {
    const check = validateBookJson(text);
    if (!check.ok) {
      results.push({ kind: 'error', fileName: name, errors: check.errors });
      continue;
    }
    const { replaced } = await saveBook(check.book);
    const cards = check.book.chapters.reduce((n, ch) => n + ch.cards.length, 0);
    results.push({
      kind: 'ok',
      message: `${replaced ? 'Updated' : 'Imported'} “${check.book.book.title}” (${cards} cards)${
        replaced ? '. Your progress was kept.' : ''
      }`,
    });
  }
  return results;
}

export default function ImportButton({ onResults }: { onResults: (r: ImportResult[]) => void }) {
  const input = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, text: await f.text() })));
    onResults(await importTexts(files));
    // Reset so the same file can be picked again after fixing it.
    if (input.current) input.current.value = '';
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => input.current?.click()}>
        <Icon name="upload" size={18} /> Import book
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  );
}
