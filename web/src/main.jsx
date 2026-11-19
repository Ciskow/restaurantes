import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dm-serif-display/latin-400.css';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Offline cache. Browsers only allow it over HTTPS (or on localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
