import { buildChapters, type BuildInput, type BuiltChapter } from './build';
import { parseBook, type ParsedBook } from './extract';
import { ImportError, type ImportErrorCode } from './types';

// Web Worker: all the parsing and card cutting runs here, off the main thread.
// The file never leaves the device: no network request is made.

export type WorkerRequest =
  | { type: 'parse'; bytes: ArrayBuffer; fileName: string }
  | { type: 'build'; input: BuildInput };

export type WorkerResponse =
  | { type: 'progress'; stage: string; done: number; total: number }
  | { type: 'parsed'; book: ParsedBook }
  | { type: 'built'; chapters: BuiltChapter[] }
  | { type: 'error'; code: ImportErrorCode; message: string };

const post = (msg: WorkerResponse) => (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'parse') {
      const book = await parseBook(new Uint8Array(msg.bytes), msg.fileName, (stage, done, total) =>
        post({ type: 'progress', stage, done, total }),
      );
      post({ type: 'parsed', book });
    } else if (msg.type === 'build') {
      post({ type: 'progress', stage: 'Cutting cards', done: 0, total: 1 });
      post({ type: 'built', chapters: buildChapters(msg.input) });
    }
  } catch (err) {
    if (err instanceof ImportError) post({ type: 'error', code: err.code, message: err.message });
    else post({ type: 'error', code: 'corrupt', message: `This file could not be read (${(err as Error)?.message ?? 'unknown error'}).` });
  }
};
