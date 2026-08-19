import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './analytics';
import { initErrorReporting } from './errors';
import { LocaleProvider } from './i18n';
import { unlockAudio } from './sound';
import { StoreProvider } from './store';
import './ds.css';
import './game.css';

initAnalytics();
initErrorReporting();

// Audio starts at the first gesture and never before it: browsers refuse to run an
// AudioContext otherwise, and one created on load is a suspended context nobody
// resumes. One listener, at the root, so no screen has to remember to do it.
for (const ev of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(ev, unlockAudio, { once: true, passive: true });
}

createRoot(document.getElementById('root')!).render(
  <LocaleProvider><StoreProvider><App /></StoreProvider></LocaleProvider>,
);
