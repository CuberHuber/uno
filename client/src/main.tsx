import { createRoot } from 'react-dom/client';
import App from './App';
import { initAnalytics } from './analytics';
import { LocaleProvider } from './i18n';
import { StoreProvider } from './store';
import './ds.css';
import './game.css';

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <LocaleProvider><StoreProvider><App /></StoreProvider></LocaleProvider>,
);
