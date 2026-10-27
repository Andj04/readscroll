# Reading Cards

A personal reading app that turns learning books into scrollable cards.
Progressive web app (React, TypeScript, Vite), data stored locally in IndexedDB, works offline.

Books are imported from PDF, EPUB or plain text files you own. The text is extracted, cleaned and cut
into cards **on the device**, in a Web Worker: no AI call, no server call. Book text is never synced;
only progress is meant to be (sync is not built yet).

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # development server, opens on http://localhost:5173
```

To test the installable, offline version:

```bash
npm run build
npm run preview    # http://localhost:4173
```

Both commands also print a "Network" address: open it on your phone (same Wi-Fi) to try the mobile layout.
Note: installing as an app and offline mode need HTTPS on a phone, so on a phone they only work once the app
is deployed (localhost on a computer is fine).

## Test checklist

1. **Import**: "Import book" in the library, pick a file from `test-files/` (for example `harbour.epub`,
   `harbour.pdf` or `harbour.txt`). A progress bar shows while the file is read, then the review screen opens:
   edit title and author, choose the card length, rename / merge / split / delete / reorder chapters,
   preview the first cards. Nothing is saved until "Add to library".
   Try `scanned.pdf`, `drm.epub` and `damaged.pdf` to see the error messages, and `two-columns.pdf` for the
   reading order warning.
2. **Library**: progress bar, percentage and "Continue reading".
3. **Chapters**: tap the book title. Finished chapters show a check, chapters in progress show a counter like `3/5`.
4. **Card picker**: tap a chapter. Green cells are read, the outlined cell is the next unread card, plain cells are unread.
   Tap a number to start reading there.
5. **Reading**: scroll (or swipe) to the next card, tap the right half for next and the left half for previous,
   or use the arrow keys and space bar. Cards you move past are marked read automatically.
6. **Manual marks**: "Mark read" / "Read" toggles the current card. The `···` button offers
   "Mark everything before this card as read" and "Mark this chapter as read".
   A card you mark unread yourself stays unread even if you scroll past it again.
7. **Bookmarks**: bookmark icon while reading; list from the bookmark icon in the library header.
8. **Settings** (gear icon, or the "T" icon while reading): font size, theme (system, light, dark),
   reading mode (vertical scroll or horizontal swipe), card length for new imports. Choices are remembered.
9. **Offline**: after `npm run build && npm run preview`, open the app once, then stop the server or switch off the
   network in the browser dev tools: the app and your books still load.

10. **Re-cut**: on a book's chapter list, choose another card length and tap "Re-cut cards".
    Read marks, position and bookmarks move to the new cards.

## Automated tests

```bash
npm test               # unit tests (Vitest): cleaning, sentences, chapters, segmentation, EPUB, PDF, migration
npm run test:e2e       # end-to-end tests (Playwright) on the production build
npm run typecheck
```

First time on a new computer, `npx playwright install chromium` downloads the browser used by the
end-to-end tests. The test books in `test-files/` are generated from original text by
`npm run make-test-files` (no copyrighted book is in the repository).

## How the import works

1. **Extraction** (`src/import/pdf.ts`, `epub.ts`, `text.ts`)
   - PDF: pdf.js gives the text of each page with positions. Lines are rebuilt, running headers and footers
     (the same line at the top or bottom of many pages) and standalone page numbers are removed.
   - EPUB: unzip, read `container.xml`, the OPF (metadata, spine), the navigation document (EPUB 3) or NCX
     (EPUB 2), then each XHTML file in spine order.
   - Plain text: UTF-8, or Windows-1252 for old files. Paragraphs are separated by blank lines.
2. **Cleaning** (`clean.ts`, `textUtils.ts`): words split by an end-of-line hyphen are rejoined when the next
   line starts in lowercase, lines of a paragraph are merged, ligatures and unusual spaces are normalized.
   The wording itself is never changed.
3. **Chapters** (`chapters.ts`): EPUB table of contents, then PDF outline, then headings ("Chapter 3",
   or the biggest heading level). Otherwise one chapter, which can be split in the review screen.
4. **Cards** (`segment.ts`): medium = 80 to 150 words (maximum 180, minimum 40 except the last card of a
   chapter); short = 40 to 80; long = 150 to 250. Cards never end inside a sentence (`Intl.Segmenter`,
   with fixes for abbreviations like "Dr." and initials). A heading stays with the text after it,
   lists and quotes stay whole when they fit.
5. **Identity** (`identity.ts`): the book id is a SHA-256 hash of the title and author read from the file
   and of the normalized text, so the same file gives the same id on every device. Renaming the book in the
   review screen does not change it.

Errors are explained for scanned PDFs (no text layer, OCR is not supported), password or DRM protected
files, damaged files, empty files and unsupported file types.

**Known limits**
- Rejoining hyphenated words cannot always tell "infor-mation" from "well-known" split at the hyphen.
- The reading order warning is a heuristic, mainly for pages with several columns.
- The same book as PDF on one device and as EPUB on another gets two different ids (the text differs).
- PDFs using CJK fonts without embedded character maps may extract badly (pdf.js character maps are not bundled).

## Data and migration

Database version 2 (`src/lib/db.ts`) converts books imported from JSON files by the previous version:
card ids, numbers, pages and text are kept, so read marks, position and bookmarks stay valid. It runs once,
automatically, when the new version first opens. Progress records now also store where their card sits in
the book text, so they can be moved onto new cards (re-cut, re-import, or later another device's cards).
Books known only from their progress (`bookRefs`) appear in the library as "Needs import on this device";
importing the same file links the progress.

## Project structure

```
src/
  import/           on-device import: extraction, cleaning, chapters, cards, worker
  lib/model.ts      book, chapter and card types
  lib/migrate.ts    migration of books from the previous version
  lib/remap.ts      moves progress to new cards by position in the text
  lib/db.ts         IndexedDB tables (Dexie)
  lib/actions.ts    all writes: saving books, read marks, position, bookmarks, settings
  lib/progress.ts   progress calculations (pure functions)
  lib/theme.ts      applies theme and font size
  hooks/data.ts     React hooks reading live data from IndexedDB
  screens/          Library, ImportReview, ChapterList, CardPicker, Reader, Bookmarks, Settings
  components/       shared UI pieces
  styles/           theme tokens (light/dark) and layout
```
