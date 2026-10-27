import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// End-to-end tests of the on-device import. Test books are generated from original
// text by scripts/make-test-files.mjs.

const file = (name: string) => path.join(import.meta.dirname, '..', 'test-files', name);

async function importFile(page: Page, name: string) {
  await page.getByTestId('import-input').first().setInputFiles(file(name));
  await expect(page).toHaveURL(/\/import$/);
}

/** Values of the chapter title fields in the review screen. */
async function chapterTitles(page: Page): Promise<string[]> {
  return page.locator('.review-chapter input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
}

async function bookCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('reading-cards');
        req.onsuccess = () => {
          const db = req.result;
          const count = db.transaction('books').objectStore('books').count();
          count.onsuccess = () => {
            resolve(count.result);
            db.close();
          };
        };
      }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
});

test('EPUB: review, rename, add to library and read', async ({ page }) => {
  await importFile(page, 'harbour.epub');
  await expect(page.getByRole('heading', { name: 'Review the import' })).toBeVisible();
  await expect(page.getByText('Chapters come from the book’s table of contents.')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Harbour Stories');
  await expect(page.getByLabel('Author')).toHaveValue('Test Author');
  await expect(page.locator('.review-chapter')).toHaveCount(3);

  await page.getByLabel('Title of chapter 1').fill('The Harbour Town');
  await page.getByRole('button', { name: 'Preview / split' }).first().click();
  await expect(page.locator('.preview-card').first()).toContainText('The harbour town woke slowly under a pale sky.');

  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page).toHaveURL(/\/book\/b-[0-9a-f]+$/);
  await expect(page.locator('.chapter-row')).toHaveCount(3);
  await expect(page.locator('.chapter-row').first()).toContainText('The Harbour Town');

  await page.getByRole('link', { name: 'Start reading' }).click();
  await expect(page.locator('.card').first()).toContainText('The harbour town woke slowly');
  await expect(page.locator('.card-meta').first()).toContainText('0%'); // EPUB: location instead of a page
});

test('PDF: outline chapters, clean text, page numbers on cards', async ({ page }) => {
  await importFile(page, 'harbour.pdf');
  await expect(page.getByText('Chapters come from the PDF bookmarks (outline).')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => chapterTitles(page)).toEqual(['The Harbour', 'The Storm', 'The Launch']);
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page).toHaveURL(/\/book\/b-[0-9a-f]+$/);
  await page.getByRole('link', { name: 'Start reading' }).click();
  const card = page.locator('.card').first();
  await expect(card.locator('.card-meta')).toContainText('p. 1');
  await expect(card).not.toContainText('Harbour Stories'); // running header removed
});

test('Plain text: split, merge, reorder and delete chapters', async ({ page }) => {
  await importFile(page, 'harbour.txt');
  await expect(page.getByText('Chapters were guessed from the headings')).toBeVisible();
  await expect.poll(() => chapterTitles(page)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);

  // Split chapter 1 before its third paragraph.
  await page.getByRole('button', { name: 'Preview / split' }).first().click();
  await page.locator('.split-points li').nth(2).getByRole('button', { name: 'Split here' }).click();
  await expect.poll(() => chapterTitles(page)).toEqual(['Chapter 1', 'New chapter', 'Chapter 2', 'Chapter 3']);

  // Merge it back, then move chapter 3 up and delete chapter 2.
  await page.getByRole('button', { name: 'Merge with next' }).first().click();
  await expect.poll(() => chapterTitles(page)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3']);
  await page.getByRole('button', { name: 'Move chapter 3 up' }).click();
  await expect.poll(() => chapterTitles(page)).toEqual(['Chapter 1', 'Chapter 3', 'Chapter 2']);
  await expect(page.getByRole('button', { name: 'Merge with next' }).first()).toBeDisabled(); // not next to each other in the text
  await page.getByRole('button', { name: 'Delete' }).nth(2).click();
  await expect.poll(() => chapterTitles(page)).toEqual(['Chapter 1', 'Chapter 3']);

  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page.locator('.chapter-row')).toHaveCount(2);
  await expect(page.locator('.chapter-row').nth(1)).toContainText('Chapter 3');
});

test('Nothing is saved until the user confirms', async ({ page }) => {
  await importFile(page, 'harbour.epub');
  await expect(page.getByRole('heading', { name: 'Review the import' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page).toHaveURL(/\/$/);
  expect(await bookCount(page)).toBe(0);
});

test('Clear errors for scanned, DRM, damaged and unsupported files', async ({ page }) => {
  const cases: [string, RegExp][] = [
    ['scanned.pdf', /no text layer.*OCR/],
    ['drm.epub', /protected by DRM/],
    ['damaged.pdf', /damaged/],
  ];
  for (const [name, message] of cases) {
    await page.goto('/');
    await importFile(page, name);
    await expect(page.getByRole('alert')).toContainText(message, { timeout: 30_000 });
  }
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) });
  await expect(page.getByRole('alert')).toContainText('not supported');
  expect(await bookCount(page)).toBe(0);
});

test('Warns about pages with an unreliable reading order', async ({ page }) => {
  await importFile(page, 'two-columns.pdf');
  await expect(page.getByRole('status')).toContainText('Page 1: This page seems to have several columns', { timeout: 30_000 });
});

test('Importing sends nothing over the network', async ({ page }) => {
  const requests: { method: string; url: string; body: boolean }[] = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), body: !!r.postDataBuffer() }));
  await importFile(page, 'harbour.pdf');
  await expect(page.getByRole('heading', { name: 'Review the import' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add to library' }).click();
  await expect(page).toHaveURL(/\/book\//);
  // Only the app's own files may be loaded (e.g. the worker script). No upload, no other server.
  for (const r of requests) {
    expect(r.method).toBe('GET');
    expect(r.body).toBe(false);
    expect(new URL(r.url).origin).toBe('http://localhost:4174');
  }
});
