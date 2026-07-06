// Self-hosted fonts (Fontsource), replacing the Google Fonts <link> that used
// to live in index.html. Bundling them means the app renders correctly offline
// and never pings Google on a cold load — and lets the CSP drop the Google
// allowlist entirely. Only the `latin` subset is imported (covers Norwegian
// æ/ø/å + English), and only the exact weights/styles the theme uses:
//   Cormorant Garamond (serif headings): 400/500/600 + italic 400/500
//   IBM Plex Mono (figures): 400/500/600
//   Inter (body): 400/500/600/700
// Keep this list in sync with --font-serif / --font-mono / --font-sans in index.css.

import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/cormorant-garamond/latin-500-italic.css';

import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';

import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
