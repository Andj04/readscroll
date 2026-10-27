// Book data model used by the app.
// For now this is the shape books were stored in before (they came from JSON files).

export interface Card {
  id: string;
  number: number;
  page: number;
  title: string | null;
  text: string;
  mood?: unknown;
}

export interface Chapter {
  number: number;
  title: string;
  cards: Card[];
  quiz?: unknown[];
}

export interface BookFile {
  schema_version: 1;
  book: {
    id: string;
    title: string;
    author: string;
    language: string;
    license: string;
    source_url: string | null;
  };
  chapters: Chapter[];
}
