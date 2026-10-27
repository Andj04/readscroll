import type { Settings } from './db';

// Settings live in IndexedDB, which loads asynchronously. A copy of the
// display settings is kept in localStorage only to avoid a flash on startup.
const CACHE_KEY = 'reading-cards:display';

export function applyDisplaySettings(s: Pick<Settings, 'theme' | 'fontSize'>): void {
  const root = document.documentElement;
  if (s.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  root.style.setProperty('--reading-size', `${s.fontSize}px`);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ theme: s.theme, fontSize: s.fontSize }));
  } catch {
    // Storage can be blocked (private mode); the app still works without the cache.
  }
}

export function applyCachedTheme(): void {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (cached && typeof cached.fontSize === 'number') applyDisplaySettings(cached);
  } catch {
    // Ignore: defaults from CSS are used.
  }
}
