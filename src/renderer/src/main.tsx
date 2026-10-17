import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/orbitron/500.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import 'katex/dist/katex.min.css'
/*
 * No highlight.js theme is imported.
 *
 * `highlight.js/styles/github-dark.css` used to be loaded here, which meant the syntax colours in every code block
 * were GitHub's dark ones in both themes -- unreadable on the light code card. Importing the light sheet as well
 * cannot work: the two declare the same `.hljs-*` rules and the second one would win everywhere. The palette is
 * written from the tokens instead, in styles/parts/07-thinking-orb-brand-markdown.css, so it follows the theme.
 */
// The colours, type sizes, spacing and radii, built from orbis-ui/tokens.json by scripts/build-orbis-ui.mjs -- the
// same file the browser's own pages and Chromium's window frame are built from. It comes before the stylesheet so
// the stylesheet can override a token where it has to, rather than the other way round.
import './styles/tokens.generated.css'
import './styles/index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
