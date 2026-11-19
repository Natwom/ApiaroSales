import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Building2, Globe2, Users, FileText, ShoppingCart,
  Package, Truck, ClipboardList, Archive, MapPinned, FileCheck, Banknote,
  Receipt, ArrowLeftRight, BookOpen, Wallet, BarChart3, ShieldCheck,
  ScrollText, Settings, Boxes, LogOut,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/organizations', label: 'Customers', icon: Building2, perm: 'organization.create' },
  { to: '/world-vision', label: 'World Vision', icon: Globe2 },
  { to: '/workers', label: 'Workers', icon: Users, perm: 'worker.create' },
  { to: '/lpos', label: 'LPOs', icon: FileText, perm: 'lpo.create' },
  { to: '/orders', label: 'Orders', icon: ShoppingCart, perm: 'order.create' },
  { to: '/inventory', label: 'Inventory', icon: Package, perm: 'inventory.receive' },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, perm: 'inventory.receive' },
  { to: '/procurement', label: 'Procurement', icon: ClipboardList, perm: 'inventory.receive' },
  { to: '/receiving', label: 'Receiving', icon: Archive, perm: 'inventory.receive' },
  { to: '/collections', label: 'Collections', icon: MapPinned, perm: 'collection.issue' },
  { to: '/deliveries', label: 'Deliveries', icon: Boxes, perm: 'delivery.confirm' },
  { to: '/invoices', label: 'Invoices', icon: FileCheck, perm: 'invoice.create' },
  { to: '/payments', label: 'Payments', icon: Banknote, perm: 'payment.record' },
  { to: '/receivables', label: 'Receivables', icon: Receipt, perm: 'invoice.create' },
  { to: '/payables', label: 'Payables', icon: ArrowLeftRight, perm: 'payment.record' },
  { to: '/accounting', label: 'Accounting', icon: BookOpen, perm: 'report.export' },
  { to: '/expenses', label: 'Expenses', icon: Wallet, perm: 'expense.create' },
  { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'report.export' },
  { to: '/users', label: 'Users & Roles', icon: ShieldCheck, perm: 'user.manage' },
  { to: '/audit', label: 'Audit Logs', icon: ScrollText, perm: 'report.export' },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ open, onClose }) {
  const { user, hasPermission, logout } = useAuth()
  const items = NAV.filter((n) => !n.perm || hasPermission(n.perm))

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={onClose} />
      )}
      <aside className={`fixed z-40 inset-y-0 left-0 w-64 bg-navy-900 dark:bg-navy-950 text-slate-300
                         flex flex-col transform transition-transform lg:translate-x-0
                         ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-16 shrink-0 flex items-center px-5 border-b border-navy-800">
          <img src="/logo-full-light.svg" alt="APIARO" className="h-12 w-auto" />
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto py-4 px-3 space-y-0.5">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-brand-600/20 text-white font-medium'
                    : 'hover:bg-navy-800 hover:text-white'
                }`}>
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className="shrink-0 border-t border-navy-800 p-3 flex items-center gap-3">
            <div className="h-8 w-8 shrink-0 rounded-full bg-brand-600/30 text-white grid place-items-center text-sm font-semibold">
              {(user.full_name ?? user.email ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white truncate">{user.full_name ?? user.email}</div>
              <div className="text-xs text-slate-500 truncate">{user.email}</div>
            </div>
            <button onClick={logout} title="Sign out" aria-label="Sign out"
              className="rounded-lg p-2 text-slate-400 hover:bg-navy-800 hover:text-white">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </aside>
    </>
  )
}