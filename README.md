# Reading Cards

A personal reading app that turns learning books into scrollable cards.
Progressive web app (React, TypeScript, Vite), data stored locally in IndexedDB, works offline.

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

1. **Import**: on the empty library, tap "Load the sample book", or "Import book" and pick `public/sample-book.json`.
   Try importing a broken JSON file: a red box lists each problem with its location (for example
   `chapters[0].cards[2].page: Invalid input: expected number, received string`).
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
   reading mode (vertical scroll or horizontal swipe). Choices are remembered.
9. **Offline**: after `npm run build && npm run preview`, open the app once, then stop the server or switch off the
   network in the browser dev tools: the app and your books still load.

## Book file format

See `public/sample-book.json`. Rules checked on import:

- `schema_version` must be `1`.
- `book`: `id`, `title` (not empty), `author`, `language`, `license`, `source_url` (string or null).
- `chapters`: at least one; each with a unique `number`, a `title`, at least one card, and an optional `quiz` array.
- Each card: unique `id`, `number`, `page` (whole number), `title` (string or null), `text` (not empty), `mood` (optional).
- Card numbers must run 1, 2, 3… across the whole book, in file order.

`quiz` and `mood` are stored but not used yet. Re-importing a book with the same `id` replaces the file and keeps your progress.

## Project structure

```
src/
  lib/schema.ts     import validation (zod)
  lib/db.ts         IndexedDB tables (Dexie)
  lib/actions.ts    all writes: import, read marks, position, bookmarks, settings
  lib/progress.ts   progress calculations (pure functions)
  lib/theme.ts      applies theme and font size
  hooks/data.ts     React hooks reading live data from IndexedDB
  screens/          Library, ChapterList, CardPicker, Reader, Bookmarks, Settings
  components/       shared UI pieces
  styles/           theme tokens (light/dark) and layout
public/
  sample-book.json  small test book (original sample text, 3 chapters, 15 cards)
```
