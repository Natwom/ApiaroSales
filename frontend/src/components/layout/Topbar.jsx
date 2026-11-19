import { useEffect, useRef, useState } from 'react'
import { Menu, Search, Bell, Moon, Sun, LogOut, ChevronRight, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useLocation, Link } from 'react-router-dom'

const CRUMB_NAMES = {
  '': 'Dashboard', organizations: 'Organizations', 'world-vision': 'World Vision',
  workers: 'Workers', lpos: 'LPOs', orders: 'Orders', inventory: 'Inventory',
  suppliers: 'Suppliers', procurement: 'Procurement', receiving: 'Receiving',
  collections: 'Collections', deliveries: 'Deliveries', invoices: 'Invoices',
  payments: 'Payments', receivables: 'Receivables', payables: 'Payables',
  accounting: 'Accounting', expenses: 'Expenses', reports: 'Reports',
  users: 'Users & Roles', audit: 'Audit Logs', settings: 'Settings', login: 'Login',
}

export default function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth()
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'))
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  const location = useLocation()
  const crumbs = location.pathname.split('/').filter(Boolean)

  // Press "/" anywhere to jump to the search box
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target?.isContentEditable) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <header className="h-16 bg-white dark:bg-navy-900 border-b border-slate-200 dark:border-slate-800
                       flex items-center gap-3 px-4 lg:px-6 sticky top-0 z-20">
      <button className="lg:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onMenuClick}>
        <Menu size={20} />
      </button>

      <nav className="hidden md:flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
        <Link to="/" className="hover:text-brand-600">Home</Link>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={14} />
            <span className={i === crumbs.length - 1 ? 'text-slate-900 dark:text-white font-medium' : ''}>
              {CRUMB_NAMES[c] ?? c}
            </span>
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="search-wrap hidden sm:block !w-64 focus-within:!w-80 transition-all duration-200">
        <Search size={16} className="search-icon" />
        <input
          ref={searchRef}
          className="search-input"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
        />
        {query ? (
          <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border
                          border-slate-200 dark:border-slate-700 px-1.5 text-[10px] font-medium
                          text-slate-400 dark:text-slate-500">
            /
          </kbd>
        )}
      </div>

      <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 relative">
        <Bell size={19} />
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-500" />
      </button>

      <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
        {dark ? <Sun size={19} /> : <Moon size={19} />}
      </button>

      <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-700">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium leading-tight">{user?.full_name}</p>
          <p className="text-xs text-slate-400">{user?.roles?.[0]}</p>
        </div>
        <button onClick={logout} title="Logout"
                className="p-2 rounded-lg hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30">
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}