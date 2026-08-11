import { createRoot } from 'react-dom/client';
import App from './App';
import { StoreProvider } from './store';
import './ds.css';
import './game.css';

createRoot(document.getElementById('root')!).render(
  <StoreProvider><App /></StoreProvider>,
);
