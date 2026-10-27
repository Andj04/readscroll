import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { applyCachedTheme } from './lib/theme';
import './styles/theme.css';
import './styles/global.css';

// Apply the last known theme before the first paint, so dark mode does not flash white.
applyCachedTheme();

// Service worker: caches the app so it opens offline, and updates itself in the background.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
