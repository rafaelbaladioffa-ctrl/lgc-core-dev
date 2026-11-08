import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/axis-tokens.css';
import './styles/app.css';
import './styles/pages.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
