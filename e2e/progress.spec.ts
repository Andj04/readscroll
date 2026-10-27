import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// Progress must survive: the database migration, a re-import of the same book
// with another card length, and an import on a "new device" that only has the progress.

const file = (name: string) => path.join(import.meta.dirname, '..', 'test-files', name);

/** Runs a function on the raw IndexedDB database of the app. */
async function withDb<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(async (body) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('reading-cards');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const run = new Function('db', `return (async () => { ${body} })()`);
    try {
      return await run(db);
    } finally {
      db.close();
    }
  }, fn);
}

const all = (store: string) => `
  return await new Promise((res) => { const r = db.transaction('${store}').objectStore('${store}').getAll(); r.onsuccess = () => res(r.result); });`;

async function importAndAdd(page: Page, name: string, length?: 'Short' | 'Medium' | 'Long') {
  await page.getByTestId('import-input').first().setInputFiles(file(name));
  await expect(page.getByRole('heading', { name: 'Review the import' })).toBeVisible({ timeout: 30_000 });
  if (length) await page.getByRole('radio', { name: length }).click();
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page).toHaveURL(/\/book\/b-[0-9a-f]+$/);
}

/** Marks the first n cards as read, from the reader (we are on the book's chapter list). */
async function readCards(page: Page, n: number) {
  await page.goto(`${new URL(page.url()).pathname}/read/${n + 1}`);
  await expect(page.locator('.card').first()).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Mark everything before this card as read' }).click();
  await expect.poll(async () => (await withDb<{ read: boolean }[]>(page, all('cardStatus'))).filter((x) => x.read).length).toBe(n);
}

test('migrates a book stored by the previous version (JSON import) and keeps its progress', async ({ page }) => {
  // Create the version 1 database (Dexie version 1 = IndexedDB version 10) with an old book.
  await page.goto('/icons/icon.svg');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('reading-cards', 10);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('books', { keyPath: 'id' });
          db.createObjectStore('cardStatus', { keyPath: ['bookId', 'cardId'] }).createIndex('bookId', 'bookId');
          db.createObjectStore('positions', { keyPath: 'bookId' });
          const bm = db.createObjectStore('bookmarks', { keyPath: ['bookId', 'cardId'] });
          bm.createIndex('bookId', 'bookId');
          bm.createIndex('createdAt', 'createdAt');
          db.createObjectStore('settings', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['books', 'cardStatus', 'positions', 'bookmarks'], 'readwrite');
          const card = (n: number, text: string) => ({ id: `old-${n}`, number: n, page: 10 + n, title: null, text, mood: null });
          tx.objectStore('books').put({
            id: 'old-book',
            totalCards: 3,
            importedAt: 1,
            file: {
              schema_version: 1,
              book: { id: 'old-book', title: 'Old Book', author: 'Old Author', language: 'en', license: 'test', source_url: null },
              chapters: [
                { number: 1, title: 'First', quiz: [], cards: [card(1, 'The first old card.'), card(2, 'The second old card.')] },
                { number: 2, title: 'Second', quiz: [], cards: [card(3, 'The third old card.')] },
              ],
            },
          });
          tx.objectStore('cardStatus').put({ bookId: 'old-book', cardId: 'old-1', read: true, manual: false, updatedAt: 1 });
          tx.objectStore('positions').put({ bookId: 'old-book', cardId: 'old-2', updatedAt: 1 });
          tx.objectStore('bookmarks').put({ bookId: 'old-book', cardId: 'old-2', createdAt: 1, deleted: false, updatedAt: 1 });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );

  await page.goto('/');
  const item = page.locator('.book-item').filter({ hasText: 'Old Book' });
  await expect(item).toContainText('33% · 1 of 3 cards');
  await item.getByRole('link', { name: 'Continue reading' }).click();
  await expect(page).toHaveURL(/\/read\/2$/);
  await expect(page.locator('.card').nth(1)).toContainText('The second old card.');
  await expect(page.locator('.card-meta').nth(1)).toContainText('p. 12');

  await page.goto('/bookmarks');
  await expect(page.locator('.bookmark-item')).toContainText('The second old card.');

  // Progress records now carry text positions, and the book has a source for re-cutting.
  const statuses = await withDb<{ start?: number }[]>(page, all('cardStatus'));
  expect(statuses[0].start).toBe(0 + 'First\n\n'.length);
  const sources = await withDb<unknown[]>(page, all('sources'));
  expect(sources).toHaveLength(1);
});

test('re-importing the same book with another card length keeps progress', async ({ page }) => {
  await page.goto('/');
  await importAndAdd(page, 'harbour.txt', 'Medium');
  await readCards(page, 3);
  await page.goto('/');
  const before = await page.locator('.book-item').first().innerText();
  expect(before).toMatch(/[1-9]\d*% · 3 of \d+ cards/);

  await importAndAdd(page, 'harbour.txt', 'Short');
  await page.goto('/');
  const item = page.locator('.book-item').first();
  // More, shorter cards now; the same part of the text is still marked read.
  await expect(item).not.toContainText('0%');
  const statuses = await withDb<{ read: boolean; end: number }[]>(page, all('cardStatus'));
  expect(statuses.filter((s) => s.read).length).toBeGreaterThan(3);
});

test('a book known only from its progress shows "needs import", then links when imported', async ({ page }) => {
  await page.goto('/');
  await importAndAdd(page, 'harbour.epub');
  await readCards(page, 2);

  // Simulate a new device: progress and the book reference are there, the book text is not.
  await withDb(page, `
    await new Promise((res) => {
      const tx = db.transaction(['books', 'sources'], 'readwrite');
      tx.objectStore('books').clear();
      tx.objectStore('sources').clear();
      tx.oncomplete = res;
    });`);

  await page.goto('/');
  const missing = page.getByTestId('needs-import');
  await expect(missing).toContainText('Harbour Stories');
  await expect(missing).toContainText('33% read');

  await missing.getByTestId('import-input').setInputFiles(file('harbour.epub'));
  await expect(page.getByText('Your progress for “Harbour Stories” will be linked to this book.')).toBeVisible();
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page).toHaveURL(/\/book\/b-[0-9a-f]+$/);
  await expect(page.getByText(/33% · 2 of 6 cards/)).toBeVisible();
  await page.goto('/');
  await expect(page.getByTestId('needs-import')).toHaveCount(0);
});
