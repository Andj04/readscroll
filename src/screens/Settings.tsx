import { useLocation, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import { useSettings } from '../hooks/data';
import { updateSettings } from '../lib/actions';
import type { ReadingMode, Theme } from '../lib/db';
import type { CardLength } from '../lib/model';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const MODES: { value: ReadingMode; label: string }[] = [
  { value: 'vertical', label: 'Vertical scroll' },
  { value: 'horizontal', label: 'Horizontal swipe' },
];

const LENGTHS: { value: CardLength; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

export default function SettingsScreen() {
  const settings = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="screen">
      <TopBar
        title="Settings"
        actions={
          // Go back to wherever the user came from (often the reader), or home if opened directly.
          <button className="btn btn-small" onClick={() => (location.key === 'default' ? navigate('/') : navigate(-1))}>
            Done
          </button>
        }
      />
      <main className="content">
        <h1 className="h1">Settings</h1>

        <section className="setting">
          <label className="setting-label" htmlFor="font-size">
            Font size <span className="muted">{settings.fontSize}px</span>
          </label>
          <input
            id="font-size"
            type="range"
            min={14}
            max={28}
            step={1}
            value={settings.fontSize}
            onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
          />
          <p className="card-text preview">
            Each card holds one short passage, so you can read a book a few minutes at a time.
          </p>
        </section>

        <section className="setting">
          <div className="setting-label">Theme</div>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.value}
                role="radio"
                aria-checked={settings.theme === t.value}
                className={settings.theme === t.value ? 'on' : ''}
                onClick={() => updateSettings({ theme: t.value })}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="setting">
          <div className="setting-label">Reading mode</div>
          <div className="segmented" role="radiogroup" aria-label="Reading mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={settings.readingMode === m.value}
                className={settings.readingMode === m.value ? 'on' : ''}
                onClick={() => updateSettings({ readingMode: m.value })}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            In both modes you can also tap the right half of the screen for the next card and the left half for the
            previous one. On a computer, the arrow keys and the space bar work too.
          </p>
        </section>

        <section className="setting">
          <div className="setting-label">Card length for new imports</div>
          <div className="segmented" role="radiogroup" aria-label="Card length">
            {LENGTHS.map((l) => (
              <button
                key={l.value}
                role="radio"
                aria-checked={(settings.cardLength ?? 'medium') === l.value}
                className={(settings.cardLength ?? 'medium') === l.value ? 'on' : ''}
                onClick={() => updateSettings({ cardLength: l.value })}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            Short: about 40 to 80 words. Medium: 80 to 150. Long: 150 to 250. To change a book already imported, use
            “Re-cut cards” on its chapter list.
          </p>
        </section>
      </main>
    </div>
  );
}
