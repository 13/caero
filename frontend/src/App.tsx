import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { useMe } from './api/hooks'
import AddProduct from './pages/AddProduct'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import ProductDetail from './pages/ProductDetail'
import Setup from './pages/Setup'

function NavBar() {
  const location = useLocation()

  const navLink = (to: string, label: string) => (
    <Link
      to={to}
      className={`text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${
        location.pathname === to
          ? 'bg-indigo-100 text-indigo-700'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link to="/" className="font-bold text-gray-900 text-lg">
          Caero
        </Link>
        <div className="flex items-center gap-1">
          {navLink('/', 'Dashboard')}
          {navLink('/add', 'Add product')}
          {navLink('/setup', 'Settings')}
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  const { data: user, isLoading } = useMe()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-indigo-500 border-t-transparent" />
      </div>
    )
  }

  // If not authenticated and not in single-user mode, redirect to login
  if (!user) {
    return <Login />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/add" element={<AddProduct />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/setup" element={<Setup />} />
      </Routes>
    </div>
  )
}
