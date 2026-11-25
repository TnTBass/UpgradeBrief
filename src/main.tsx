import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import NotFoundPreview from './NotFoundPreview'
import { initializeAnalytics } from './lib/analytics'
import { initialTheme } from './lib/theme'
import './styles.css'

const is404Preview = /^\/404-preview\/?$/.test(window.location.pathname)

if (is404Preview) {
  document.title = '404 | Upgrade Brief'
  document.documentElement.dataset.theme = initialTheme()
} else {
  initializeAnalytics()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {is404Preview ? <NotFoundPreview /> : <App />}
  </StrictMode>,
)
