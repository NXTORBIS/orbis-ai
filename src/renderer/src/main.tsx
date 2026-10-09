import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/orbitron/500.css'
import '@fontsource/orbitron/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github-dark.css'
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
