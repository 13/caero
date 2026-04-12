import { useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { logoutClient, useMe } from './api/hooks'
import AddProduct from './pages/AddProduct'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import ProductDetail from './pages/ProductDetail'
import Setup from './pages/Setup'

type Theme = 'light' | 'dark'

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

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
        location.pathname === to
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-2 sm:h-14 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <Link to="/" className="font-bold text-gray-900 dark:text-gray-100 text-lg">
          Caero
        </Link>
        <div className="flex w-full sm:w-auto items-center justify-end flex-wrap gap-1">
          {navLink('/', 'Dashboard')}
          {navLink('/add', 'Add product')}
          {navLink('/setup', 'Settings')}
          <button
            onClick={onToggleTheme}
            className="text-sm font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
          >
            {theme === 'dark' ? '☀ Light' : '🌙 Dark'}
          </button>
          <button
            onClick={() => {
              logoutClient()
              window.location.reload()
            }}
            className="text-sm font-medium px-3 py-1.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-800"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  const { data: user, isLoading } = useMe()
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
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
      <NavBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/add" element={<AddProduct />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/setup" element={<Setup />} />
      </Routes>
    </div>
  )
}
