import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ensurePersistentStorage } from './backup/persistence';

// Request eviction protection on startup. Best-effort; the app works either way.
void ensurePersistentStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
