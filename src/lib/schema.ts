import { z } from 'zod';

// Shape of an importable book file (schema_version 1).
// `mood` and `quiz` are not used yet, but they are kept as-is when a book is stored.

const CardSchema = z.object({
  id: z.string().min(1, 'Card id must not be empty'),
  number: z.number().int().positive(),
  page: z.number().int().nonnegative(),
  title: z.string().nullable(),
  text: z.string().min(1, 'Card text must not be empty'),
  mood: z.unknown().optional(),
});

const ChapterSchema = z.object({
  number: z.number().int().nonnegative(),
  title: z.string(),
  cards: z.array(CardSchema).min(1, 'A chapter must contain at least one card'),
  quiz: z.array(z.unknown()).optional(),
});

const BookFileSchema = z
  .object({
    schema_version: z.literal(1, { error: 'Unsupported schema_version (this app reads version 1)' }),
    book: z.object({
      id: z.string().min(1, 'Book id must not be empty'),
      title: z.string().min(1, 'Book title must not be empty'),
      author: z.string(),
      language: z.string(),
      license: z.string(),
      source_url: z.string().nullable(),
    }),
    chapters: z.array(ChapterSchema).min(1, 'A book must contain at least one chapter'),
  })
  // Checks that involve several cards or chapters at once.
  .superRefine((file, ctx) => {
    const chapterNumbers = new Set<number>();
    const cardIds = new Set<string>();
    let expectedNumber = 1;

    file.chapters.forEach((chapter, ci) => {
      if (chapterNumbers.has(chapter.number)) {
        ctx.addIssue({
          code: 'custom',
          path: ['chapters', ci, 'number'],
          message: `Chapter number ${chapter.number} is used more than once`,
        });
      }
      chapterNumbers.add(chapter.number);

      chapter.cards.forEach((card, ki) => {
        if (cardIds.has(card.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['chapters', ci, 'cards', ki, 'id'],
            message: `Card id "${card.id}" is used more than once`,
          });
        }
        cardIds.add(card.id);

        // Card numbers must run 1, 2, 3... across the whole book, in file order.
        if (card.number !== expectedNumber) {
          ctx.addIssue({
            code: 'custom',
            path: ['chapters', ci, 'cards', ki, 'number'],
            message: `Card numbers must be continuous across the book: expected ${expectedNumber}, found ${card.number}`,
          });
        }
        expectedNumber = card.number + 1;
      });
    });
  });

export type BookFile = z.infer<typeof BookFileSchema>;
export type Chapter = BookFile['chapters'][number];
export type Card = Chapter['cards'][number];

export type ValidationResult = { ok: true; book: BookFile } | { ok: false; errors: string[] };

const MAX_ERRORS_SHOWN = 8;

/** Turns a zod path like ['chapters', 0, 'cards', 2, 'page'] into "chapters[0].cards[2].page". */
function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === 'number') return `${out}[${part}]`;
    return out ? `${out}.${String(part)}` : String(part);
  }, '');
}

/** Parses and validates the text of a book file. Never throws. */
export function validateBookJson(text: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`The file is not valid JSON: ${(e as Error).message}`] };
  }

  const result = BookFileSchema.safeParse(data);
  if (result.success) return { ok: true, book: result.data };

  const errors = result.error.issues.map((issue) => {
    const where = formatPath(issue.path);
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  if (errors.length > MAX_ERRORS_SHOWN) {
    const hidden = errors.length - MAX_ERRORS_SHOWN;
    return { ok: false, errors: [...errors.slice(0, MAX_ERRORS_SHOWN), `…and ${hidden} more problem(s)`] };
  }
  return { ok: false, errors };
}
