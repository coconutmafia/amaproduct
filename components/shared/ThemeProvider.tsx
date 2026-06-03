'use client'

import * as React from 'react'

// Lightweight theme provider. Replaces `next-themes`, whose provider rendered
// its anti-flash <script> INSIDE a client component — which React 19 flags with
// "Encountered a script tag while rendering React component" on every re-render.
// Here the anti-flash script lives in the SERVER root layout (app/layout.tsx),
// the Next-sanctioned place for inline scripts, so no such warning is produced.
//
// Theme = a `light` / `dark` class on <html> (Tailwind dark variant keys off it).

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: Theme
  setTheme: (theme: Theme) => void
}

const STORAGE_KEY = 'theme'

const ThemeContext = React.createContext<ThemeContextValue>({
  theme: 'light',
  resolvedTheme: 'light',
  setTheme: () => {},
})

function applyTheme(theme: Theme) {
  const el = document.documentElement
  el.classList.remove('light', 'dark')
  el.classList.add(theme)
  el.style.colorScheme = theme
}

// Match whatever the server head-script already applied, so the toggle and the
// Sonner theme are correct on the very first client render (no dead first click).
function readInitialTheme(defaultTheme: Theme): Theme {
  if (typeof window === 'undefined') return defaultTheme
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* ignore */ }
  return document.documentElement.classList.contains('dark') ? 'dark' : defaultTheme
}

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  // Accepted for drop-in compatibility with the previous next-themes props; unused.
  attribute?: string
  enableSystem?: boolean
}

export function ThemeProvider({ children, defaultTheme = 'light' }: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => readInitialTheme(defaultTheme))

  // Keep <html> in sync (also covers the first client render).
  React.useEffect(() => { applyTheme(theme) }, [theme])

  // Cross-tab sync.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setThemeState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t)
    try { window.localStorage.setItem(STORAGE_KEY, t) } catch { /* ignore */ }
    applyTheme(t)
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: theme, setTheme }),
    [theme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext)
}
