import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { LayoutDashboard, Menu, Moon, Plus, Settings, Sun, X, LogOut } from 'lucide-react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { logoutClient, useMe } from './api/hooks'
import { Toaster } from 'react-hot-toast'
import CaeroBrand from './components/CaeroBrand'
import Login from './pages/Login'

// Route-level code splitting — keeps recharts and the big pages out of the
// initial bundle.
const AddProduct = lazy(() => import('./pages/AddProduct'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const ProductDetail = lazy(() => import('./pages/ProductDetail'))
const Setup = lazy(() => import('./pages/Setup'))

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
    </div>
  )
}

type Theme = 'light' | 'dark'

function applyThemeHeadAssets(theme: Theme) {
  const isDark = theme === 'dark'
  const pngFavicon = document.getElementById('app-favicon-png') as HTMLLinkElement | null
  const svgFavicon = document.getElementById('app-favicon-svg') as HTMLLinkElement | null
  const appleTouchIcon = document.getElementById('app-apple-touch-icon') as HTMLLinkElement | null
  const themeColor = document.getElementById('app-theme-color') as HTMLMetaElement | null

  if (pngFavicon) {
    pngFavicon.href = isDark ? '/favicon-96x96.png' : '/favicon-96x96.png'
  }
  if (svgFavicon) {
    svgFavicon.href = isDark ? '/favicon.svg' : '/favicon.svg'
  }
  if (appleTouchIcon) {
    appleTouchIcon.href = isDark ? '/apple-touch-icon.png' : '/apple-touch-icon.png'
  }
  if (themeColor) {
    themeColor.content = isDark ? '#030712' : '#ffffff'
  }
}

function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Ignore localStorage access issues and fallback to system preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function NavBar({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const location = useLocation()
  // The menu is "open for a specific path" — navigating away makes the
  // comparison false, so it closes without an effect.
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null)
  const menuOpen = menuOpenPath === location.pathname
  const setMenuOpen = (open: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof open === 'function' ? open(menuOpen) : open
    setMenuOpenPath(next ? location.pathname : null)
  }

  const navLink = (to: string, label: string, ariaLabel?: string, icon?: ReactNode) => (
    <Link
      to={to}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
        location.pathname === to
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {icon}
      {label}
    </Link>
  )

  const dashboardIcon = <LayoutDashboard aria-hidden="true" className="h-4 w-4" />

  return (
    <nav className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-2">
        <div className="h-14 flex items-center justify-between">
          <Link to="/" className="text-lg">
            <CaeroBrand logoSizeClassName="h-10 w-10" />
          </Link>
          <div className="hidden sm:flex items-center flex-wrap gap-1">
            {navLink('/', 'Dashboard', undefined, dashboardIcon)}
            <Link
              to="/add"
              aria-label="Add product"
              className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
                location.pathname === '/add'
                  ? 'bg-indigo-700 text-white shadow-sm'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
              }`}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add
            </Link>
            <button
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <Link
              to="/setup"
              title="Settings"
              aria-label="Settings"
              className={`p-2 rounded-lg transition-colors ${
                location.pathname === '/setup'
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Settings className="h-5 w-5" />
            </Link>
            <button
              onClick={() => {
                logoutClient()
                window.location.reload()
              }}
              title="Logout"
              aria-label="Logout"
              className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            title="Toggle menu"
            aria-label="Toggle menu"
            className="sm:hidden p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="sm:hidden mt-2 flex flex-col items-stretch gap-1">
            {navLink('/', 'Dashboard', undefined, dashboardIcon)}
            <Link
              to="/add"
              aria-label="Add product"
              className={`inline-flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
                location.pathname === '/add'
                  ? 'bg-indigo-700 text-white shadow-sm'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
              }`}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add
            </Link>
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={onToggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <Link
                to="/setup"
                title="Settings"
                aria-label="Settings"
                className={`p-2 rounded-lg transition-colors ${
                  location.pathname === '/setup'
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Settings className="h-5 w-5" />
              </Link>
              <button
                onClick={() => {
                  logoutClient()
                  window.location.reload()
                }}
                title="Logout"
                aria-label="Logout"
                className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

export default function App() {
  const { data: user, isLoading } = useMe()
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    applyThemeHeadAssets(theme)
    try {
      localStorage.setItem('theme', theme)
    } catch {
      // Ignore localStorage access issues.
    }
  }, [theme])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  // If not authenticated and not in single-user mode, redirect to login
  if (!user) {
    return <Login />
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <Toaster position="bottom-right" />
      <NavBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddProduct />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/setup" element={<Setup />} />
        </Routes>
      </Suspense>
    </div>
  )
}
