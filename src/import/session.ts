import { useSyncExternalStore } from 'react';
import { parseFileInWorker, type ImportProgress } from './client';
import type { ParsedBook } from './extract';
import { ImportError, type ImportErrorCode } from './types';

// The import in progress, kept in memory only (nothing is saved before the user confirms).
// A tiny store so the library, the progress view and the review screen share it.

export type ImportState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string; progress: ImportProgress | null }
  | { status: 'error'; fileName: string; code: ImportErrorCode; message: string }
  | { status: 'review'; fileName: string; parsed: ParsedBook };

let state: ImportState = { status: 'idle' };
let cancelCurrent: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: ImportState) {
  state = next;
  listeners.forEach((l) => l());
}

export function useImportState(): ImportState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function startImport(file: File): Promise<void> {
  cancelCurrent?.();
  set({ status: 'parsing', fileName: file.name, progress: null });
  const bytes = await file.arrayBuffer();
  const job = parseFileInWorker(bytes, file.name, (progress) => {
    if (state.status === 'parsing') set({ ...state, progress });
  });
  cancelCurrent = job.cancel;
  try {
    const parsed = await job.promise;
    set({ status: 'review', fileName: file.name, parsed });
  } catch (e) {
    if ((e as Error).message === 'cancelled') return;
    const err = e instanceof ImportError ? e : new ImportError('corrupt', 'This file could not be read.');
    set({ status: 'error', fileName: file.name, code: err.code, message: err.message });
  } finally {
    cancelCurrent = null;
  }
}

export function cancelImport(): void {
  cancelCurrent?.();
  cancelCurrent = null;
  set({ status: 'idle' });
}

export function finishImport(): void {
  set({ status: 'idle' });
}
