import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/cormorant-garamond/latin-300-italic.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/manrope/latin-300.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';

import '@/styles/index.css';
import { App } from '@/app/App';
import { SettingsApp } from '@/auto/SettingsApp';
import { OverlayApp } from '@/auto/OverlayApp';

const container = document.getElementById('root');

if (!container) {
  throw new Error('AfterGlowV2 could not find its root element.');
}

const mode = new URLSearchParams(window.location.search).get('mode');

createRoot(container).render(
  <StrictMode>
    {mode === 'overlay' ? <OverlayApp /> : mode === 'settings' ? <SettingsApp /> : <App />}
  </StrictMode>,
);
