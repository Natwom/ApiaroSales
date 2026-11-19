import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AppLayout from '../layouts/AppLayout'
import LoginPage from '../pages/auth/LoginPage'
import DashboardPage from '../pages/dashboard/DashboardPage'
import OrganizationsPage from '../pages/organizations/OrganizationsPage'
import LposPage from '../pages/lpos/LposPage'
import OrdersPage from '../pages/orders/OrdersPage'
import CollectionsPage from '../pages/collections/CollectionsPage'
import InvoicesPage from '../pages/invoices/InvoicesPage'
import PaymentsPage from '../pages/payments/PaymentsPage'
import WorkersPage from '../pages/workers/WorkersPage'
import InventoryPage from '../pages/inventory/InventoryPage'
import WorldVisionPage from '../pages/worldvision/WorldVisionPage'
import SuppliersPage from '../pages/suppliers/SuppliersPage'
import ProcurementPage from '../pages/procurement/ProcurementPage'
import DeliveriesPage from '../pages/deliveries/DeliveriesPage'
import ReceivablesPage from '../pages/receivables/ReceivablesPage'
import PayablesPage from '../pages/payables/PayablesPage'
import ExpensesPage from '../pages/expenses/ExpensesPage'
import AccountingPage from '../pages/accounting/AccountingPage'
import ReportsPage from '../pages/reports/ReportsPage'
import UsersPage from '../pages/users/UsersPage'
import AuditPage from '../pages/audit/AuditPage'
import SettingsPage from '../pages/settings/SettingsPage'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen grid place-items-center">Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

function NotFound() {
  return (
    <div className="card p-10 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Use the menu on the left to find what you need.</p>
    </div>
  )
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Protected><AppLayout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="organizations" element={<OrganizationsPage />} />
        <Route path="world-vision" element={<WorldVisionPage />} />
        <Route path="workers" element={<WorkersPage />} />
        <Route path="lpos" element={<LposPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="receiving" element={<InventoryPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="procurement" element={<ProcurementPage />} />
        <Route path="collections" element={<CollectionsPage />} />
        <Route path="deliveries" element={<DeliveriesPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="receivables" element={<ReceivablesPage />} />
        <Route path="payables" element={<PayablesPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="accounting" element={<AccountingPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}