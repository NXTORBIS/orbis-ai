/** Application entry point. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './ui/theme.css';
import './ui/components.css';
import { registerAiAdapter } from './ai/registry';
import { createOrbisAiAdapter, type ChatApi } from './host/orbisAi';

// Inside Orbis the assistant is Orion, through the same chat pipeline; standalone there is no adapter.
const orbis = (globalThis as unknown as { api?: ChatApi }).api;
if (orbis && typeof orbis.sendChat === 'function') registerAiAdapter(createOrbisAiAdapter(orbis));

const container = document.getElementById('root');
if (!container) throw new Error('The root element is missing from the page.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
