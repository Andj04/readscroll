import type { BuildInput, BuiltChapter } from './build';
import type { ParsedBook } from './extract';
import { ImportError } from './types';
import type { WorkerRequest, WorkerResponse } from './worker';

// Main-thread side of the import worker. Each call starts a fresh worker and
// stops it when done, so a cancelled import frees its memory right away.

export interface ImportProgress {
  stage: string;
  done: number;
  total: number;
}

export interface Job<T> {
  promise: Promise<T>;
  cancel: () => void;
}

const OUR_TYPES = new Set(['progress', 'parsed', 'built', 'error']);

function run<T>(request: WorkerRequest, pick: (r: WorkerResponse) => T | undefined, onProgress: (p: ImportProgress) => void, transfer: Transferable[] = []): Job<T> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<T>((resolve, rej) => {
    reject = rej;
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      // pdf.js, loaded inside our worker, announces itself with its own "ready" message: ignore anything that is not ours.
      if (!msg || typeof msg !== 'object' || !OUR_TYPES.has((msg as { type?: string }).type ?? '')) return;
      if (msg.type === 'progress') {
        onProgress(msg);
        return;
      }
      worker.terminate();
      if (msg.type === 'error') rej(new ImportError(msg.code, msg.message));
      else {
        const result = pick(msg);
        if (result !== undefined) resolve(result);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      rej(new ImportError('corrupt', `The import stopped unexpectedly (${e.message || 'worker error'}).`));
    };
  });
  worker.postMessage(request, transfer);
  return {
    promise,
    cancel: () => {
      worker.terminate();
      reject(new Error('cancelled'));
    },
  };
}

export function parseFileInWorker(bytes: ArrayBuffer, fileName: string, onProgress: (p: ImportProgress) => void): Job<ParsedBook> {
  return run({ type: 'parse', bytes, fileName }, (r) => (r.type === 'parsed' ? r.book : undefined), onProgress, [bytes]);
}

export function buildInWorker(input: BuildInput, onProgress: (p: ImportProgress) => void): Job<BuiltChapter[]> {
  return run({ type: 'build', input }, (r) => (r.type === 'built' ? r.chapters : undefined), onProgress);
}
