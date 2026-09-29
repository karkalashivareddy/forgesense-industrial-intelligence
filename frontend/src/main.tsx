import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const host = document.getElementById('root');
if (!host) throw new Error('[ForgeSense] Missing #root mount node.');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
