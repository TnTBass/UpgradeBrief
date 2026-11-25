export type Theme = 'light' | 'dark'

export function initialTheme(): Theme {
  try {
    const savedTheme = window.localStorage.getItem('upgrade-brief-theme')
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
