// Themes. The choice is kept on the device (so it applies before anyone signs in) and, for whoever
// is signed in, on the server, so it follows that person to their other devices.

export const THEMES = [
  { id: 'tomo', label: 'Tomo' },
  { id: 'tomo-escuro', label: 'Tomo escuro' },
];
export const DEFAULT_THEME = 'tomo';
const KEY = 'bora-comer-tema'; // also read by the inline script in index.html, before the page draws

const known = (id) => THEMES.some((t) => t.id === id);

export function loadTheme() {
  try {
    const id = localStorage.getItem(KEY);
    if (known(id)) return id;
  } catch { /* storage unavailable */ }
  return DEFAULT_THEME;
}

/** Applies a theme to the page and remembers it on this device. */
export function applyTheme(id) {
  const theme = known(id) ? id : DEFAULT_THEME;
  if (theme === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable */ }
  return theme;
}

export const isTheme = known;

// The theme chosen while nobody is signed in, kept apart from the people's own themes, so signing
// out brings back this device's choice (the default if it never had one).
const DEVICE_KEY = 'bora-comer-tema-aparelho';

export function loadDeviceTheme() {
  try {
    const id = localStorage.getItem(DEVICE_KEY);
    if (known(id)) return id;
  } catch { /* storage unavailable */ }
  return DEFAULT_THEME;
}

export function saveDeviceTheme(id) {
  try { localStorage.setItem(DEVICE_KEY, id); } catch { /* storage unavailable */ }
}
