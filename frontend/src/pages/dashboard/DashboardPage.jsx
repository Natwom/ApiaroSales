import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Users, FileText, Banknote, Receipt, AlertTriangle, RefreshCw, ArrowRight,
  Plus, PackagePlus, ShoppingCart, CheckCircle2, TrendingUp,
} from 'lucide-react'
import api from '../../services/api'
import StatusBadge from '../../components/common/StatusBadge'
import AreaChart from '../../components/common/AreaChart'
import { Donut, TrendChart, COLORS } from '../../components/common/Charts'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import { useOrganizations, useWorkers, nameMap } from '../../hooks/useLookups'

const num = (v) => Number(v ?? 0)
const outstandingOf = (i) => num(i.total) - num(i.paid_amount)
const parseDay = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`)
const DAY = 86400000

function useGuarded(key, url, allowed, params) {
  return useQuery({
    queryKey: key,
    queryFn: async () => (await api.get(url, params ? { params } : undefined)).data,
    enabled: !!allowed,
  })
}

const TONES = {
  brand: 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200',
  green: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
}

function Kpi({ icon: Icon, label, value, sub, tone = 'brand' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={`rounded-lg p-2.5 ${TONES[tone]}`}><Icon size={18} /></div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-xl font-semibold truncate">{value}</div>
        {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function Card({ title, action, children, className = '' }) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function MoneyBars({ rows, color = COLORS.brand, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-xs mb-1 gap-2">
            <span className="truncate">{r.label}</span>
            <span className="font-semibold whitespace-nowrap">{formatKES(r.value)}</span>
          </div>
          <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-2 rounded" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function DashboardPage() {
  const qc = useQueryClient()
  const { user, hasPermission: can } = useAuth()
  const [months, setMonths] = useState(6)

  const summaryQ = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await api.get('/dashboard/summary')).data,
  })
  const { data: orgs } = useOrganizations()
  const { data: workers } = useWorkers()
  const { data: invoicesRaw } = useGuarded(['invoices'], '/invoices', can('invoice.create'))
  const { data: ordersRaw } = useGuarded(['orders'], '/orders', can('order.create'))
  const { data: lposRaw } = useGuarded(['lpos'], '/lpos', can('lpo.create'))
  const { data: paymentsRaw } = useGuarded(['payments'], '/payments/customer', can('payment.record'))
  const { data: stockRaw } = useGuarded(['stock-levels'], '/products/stock-levels', can('inventory.receive'))
  const { data: trend } = useGuarded(['stock-trend', 14], '/products/stock-trend', can('inventory.receive'), { days: 14 })

  const summary = summaryQ.data
  const invoices = invoicesRaw ?? []
  const orders = ordersRaw ?? []
  const lpos = lposRaw ?? []
  const payments = paymentsRaw ?? []
  const stock = stockRaw ?? []

  const orgNames = nameMap(orgs)
  const workerNames = nameMap(workers, 'full_name')

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // ---------- Revenue by month ----------
  const buckets = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets.push({
      key,
      label: d.toLocaleDateString('en-KE', { month: 'short', ...(d.getMonth() === 0 || i === months - 1 ? { year: '2-digit' } : {}) }),
      invoiced: 0,
      received: 0,
    })
  }
  const bucketOf = (s) => buckets.find((b) => b.key === String(s).slice(0, 7))
  invoices.forEach((i) => { const b = bucketOf(i.invoice_date); if (b) b.invoiced += num(i.total) })
  payments.filter((p) => p.status === 'verified')
    .forEach((p) => { const b = bucketOf(p.payment_date); if (b) b.received += num(p.amount) })
  const chartData = buckets.map((b) => ({ label: b.label, a: b.invoiced, b: b.received }))
  const rangeInvoiced = buckets.reduce((s, b) => s + b.invoiced, 0)
  const rangeReceived = buckets.reduce((s, b) => s + b.received, 0)

  // ---------- Totals ----------
  const totalInvoiced = num(summary?.total_invoiced)
  const totalPaid = num(summary?.total_paid)
  const outstanding = num(summary?.outstanding_balance)
  const collectionRate = totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0

  // ---------- Receivables aging ----------
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }
  let overdueCount = 0, overdueAmount = 0
  invoices.forEach((i) => {
    const out = outstandingOf(i)
    if (out <= 0) return
    const days = i.due_date ? Math.floor((today - parseDay(i.due_date)) / DAY) : 0
    if (days <= 0) aging.current += out
    else {
      overdueCount += 1
      overdueAmount += out
      if (days <= 30) aging.d30 += out
      else if (days <= 60) aging.d60 += out
      else if (days <= 90) aging.d90 += out
      else aging.d90p += out
    }
  })
  const agingRows = [
    { label: 'Not yet due', value: aging.current, color: COLORS.green },
    { label: '1–30 days overdue', value: aging.d30, color: COLORS.amber },
    { label: '31–60 days overdue', value: aging.d60, color: '#f97316' },
    { label: '61–90 days overdue', value: aging.d90, color: COLORS.red },
    { label: 'Over 90 days', value: aging.d90p, color: '#991b1b' },
  ]

  // ---------- Status breakdowns ----------
  const count = (list, pred) => list.filter(pred).length
  const invoiceDonut = [
    { label: 'Not paid', value: count(invoices, (i) => i.status === 'unpaid'), color: COLORS.red },
    { label: 'Part paid', value: count(invoices, (i) => i.status === 'partially_paid'), color: COLORS.amber },
    { label: 'Fully paid', value: count(invoices, (i) => i.status === 'fully_paid'), color: COLORS.green },
  ]
  const lpoDonut = [
    { label: 'Awaiting approval', value: count(lpos, (l) => ['submitted', 'under_review'].includes(l.status)), color: COLORS.slate },
    { label: 'Open', value: count(lpos, (l) => l.status === 'approved'), color: COLORS.brand },
    { label: 'Part collected', value: count(lpos, (l) => l.status === 'partially_fulfilled'), color: COLORS.amber },
    { label: 'Exhausted', value: count(lpos, (l) => l.status === 'fully_fulfilled'), color: COLORS.green },
  ]

  // ---------- Top customers owing ----------
  const owing = {}
  invoices.forEach((i) => { owing[i.organization_id] = (owing[i.organization_id] ?? 0) + outstandingOf(i) })
  const topOwing = Object.entries(owing)
    .map(([id, value]) => ({ label: orgNames[id] ?? `Customer ${id}`, value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  // ---------- LPO balances ----------
  const openLpos = lpos
    .filter((l) => ['approved', 'partially_fulfilled'].includes(l.status))
    .sort((a, b) => num(b.remaining_value) - num(a.remaining_value))
    .slice(0, 5)

  // ---------- Needs attention ----------
  const expiring = lpos.filter((l) => {
    if (!l.expiry_date || !['approved', 'partially_fulfilled'].includes(l.status)) return false
    const d = Math.ceil((parseDay(l.expiry_date) - today) / DAY)
    return d >= 0 && d <= 14
  })
  const awaitingCollection = orders.filter(
    (o) => ['approved', 'partially_fulfilled'].includes(o.status) && o.items.some((i) => i.remaining_qty > 0),
  )
  const stockAlerts = stock.filter((s) => s.low_stock)
  const attention = [
    { label: 'LPOs awaiting approval', n: count(lpos, (l) => ['submitted', 'under_review'].includes(l.status)), to: '/lpos', ok: can('lpo.approve'), tone: 'amber' },
    { label: 'Orders awaiting approval', n: count(orders, (o) => o.status === 'pending_approval'), to: '/orders', ok: can('order.approve'), tone: 'amber' },
    { label: 'Payments to verify', n: count(payments, (p) => p.status === 'pending_verification'), to: '/payments', ok: can('payment.verify'), tone: 'amber' },
    { label: 'Orders waiting for collection', n: awaitingCollection.length, to: '/collections', ok: can('collection.issue'), tone: 'brand' },
    { label: `Overdue invoices (${formatKES(overdueAmount)})`, n: overdueCount, to: '/invoices', ok: can('invoice.create'), tone: 'red' },
    { label: 'LPOs expiring within 14 days', n: expiring.length, to: '/lpos', ok: can('lpo.create'), tone: 'amber' },
    { label: 'Products low or out of stock', n: stockAlerts.length, to: '/inventory', ok: can('inventory.receive'), tone: 'red' },
  ].filter((a) => a.ok && a.n > 0)

  // ---------- Recent activity ----------
  const activity = [
    ...invoices.map((i) => ({ id: `i${i.id}`, type: 'Invoice', ref: i.internal_ref, date: i.invoice_date, amount: i.total, status: i.status, org: i.organization_id, to: '/invoices' })),
    ...payments.map((p) => ({ id: `p${p.id}`, type: 'Payment', ref: p.internal_ref, date: p.payment_date, amount: p.amount, status: p.status, org: p.organization_id, to: '/payments' })),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8)

  const refreshAll = () => qc.invalidateQueries()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const updated = summaryQ.dataUpdatedAt
    ? new Date(summaryQ.dataUpdatedAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })
    : ''

  if (summaryQ.isLoading) {
    return (
      <div className="space-y-4">
        <div className="card h-16 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="card h-24 animate-pulse" />)}
        </div>
      </div>
    )
  }

  const quick = [
    { label: 'New LPO', to: '/lpos', icon: FileText, ok: can('lpo.create') },
    { label: 'New Order', to: '/orders', icon: ShoppingCart, ok: can('order.create') },
    { label: 'Record Payment', to: '/payments', icon: Banknote, ok: can('payment.record') },
    { label: 'Receive Stock', to: '/inventory', icon: PackagePlus, ok: can('inventory.receive') },
  ].filter((q) => q.ok)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{greeting}{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Apiaro Contractors and Supplies Ltd — all figures in KSh
            {updated && ` · updated ${updated}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <Link key={q.label} to={q.to} className="btn-secondary"><q.icon size={15} /> {q.label}</Link>
          ))}
          <button className="btn-primary" onClick={refreshAll}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi icon={FileText} tone="amber" label="Active LPO value" value={formatKES(summary?.active_lpo_value)}
          sub={`${summary?.active_lpos ?? 0} active of ${summary?.total_lpos ?? 0} LPOs`} />
        <Kpi icon={Receipt} label="Total invoiced" value={formatKES(totalInvoiced)}
          sub={`${summary?.total_orders ?? 0} orders placed`} />
        <Kpi icon={Banknote} tone="green" label="Collected (verified)" value={formatKES(totalPaid)}
          sub={`${collectionRate}% of invoiced`} />
        <Kpi icon={AlertTriangle} tone="red" label="Outstanding" value={formatKES(outstanding)}
          sub={overdueCount > 0 ? `${formatKES(overdueAmount)} overdue` : 'Nothing overdue'} />
        <Kpi icon={Building2} label="Customers" value={summary?.organizations ?? 0} />
        <Kpi icon={Users} label="Registered workers" value={summary?.workers ?? 0} />
        <Kpi icon={ShoppingCart} tone="amber" label="Pending collections" value={summary?.pending_collections ?? 0}
          sub="Approved orders not yet collected" />
        <Kpi icon={TrendingUp} tone="green" label="Verified payments" value={formatKES(summary?.verified_payments_total)} />
      </div>

      {/* Attention + revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Needs your attention" className="lg:col-span-1">
          {attention.length === 0 ? (
            <p className="text-sm text-green-600 flex items-center gap-2"><CheckCircle2 size={16} /> All clear. Nothing is waiting on you.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {attention.map((a) => (
                <li key={a.label}>
                  <Link to={a.to} className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded px-1 -mx-1">
                    <span className="text-sm">{a.label}</span>
                    <span className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[a.tone]}`}>{a.n}</span>
                      <ArrowRight size={14} className="text-slate-400" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Revenue: invoiced vs received" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
            </select>
          }>
          {can('invoice.create') ? (
            <>
              <AreaChart data={chartData} series={[
                { key: 'a', label: 'Invoiced', color: COLORS.brand },
                { key: 'b', label: 'Received (verified)', color: COLORS.green },
              ]} />
              <div className="flex gap-6 text-sm mt-3">
                <span>Invoiced: <b>{formatKES(rangeInvoiced)}</b></span>
                <span>Received: <b className="text-green-600">{formatKES(rangeReceived)}</b></span>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Your role cannot view invoices.</p>
          )}
        </Card>
      </div>

      {/* Donuts + aging */}
      {can('invoice.create') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Invoices by status"><Donut centerLabel="invoices" segments={invoiceDonut} /></Card>
          <Card title="LPOs by status"><Donut centerLabel="LPOs" segments={lpoDonut} /></Card>
          <Card title="Money owed by age"><MoneyBars rows={agingRows} empty="No unpaid invoices." /></Card>
        </div>
      )}

      {/* Customers + LPO balances */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Top customers by amount owed"
          action={<Link to="/world-vision" className="text-xs text-brand-600 hover:underline">World Vision workspace</Link>}>
          <MoneyBars rows={topOwing} color={COLORS.red} empty="No customer owes anything right now." />
        </Card>

        <Card title="LPO balances (goods still to collect)"
          action={<Link to="/lpos" className="text-xs text-brand-600 hover:underline">All LPOs</Link>}>
          {openLpos.length === 0 ? (
            <p className="text-sm text-slate-500">No active LPOs.</p>
          ) : (
            <ul className="space-y-3.5">
              {openLpos.map((l) => {
                const pct = l.total_authorized_qty
                  ? Math.round((l.total_collected_qty / l.total_authorized_qty) * 100) : 0
                return (
                  <li key={l.id}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">
                        <b>{orgNames[l.organization_id] ?? l.organization_id}</b>
                        <span className="text-slate-500"> · {l.customer_lpo_no} · {workerNames[l.worker_id] ?? 'no worker'}</span>
                      </span>
                      <span className="whitespace-nowrap font-semibold">{formatKES(l.remaining_value)}</span>
                    </div>
                    <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden mt-1.5">
                      <div className="h-2 rounded bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {l.total_collected_qty} of {l.total_authorized_qty} units collected ({pct}%)
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Stock */}
      {can('inventory.receive') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Stock movement, last 14 days" className="lg:col-span-2"
            action={<Link to="/inventory" className="text-xs text-brand-600 hover:underline">Open inventory</Link>}>
            <TrendChart data={trend ?? []} />
          </Card>
          <Card title="Low-stock alerts" className="border-l-4 border-l-amber-500">
            {stockAlerts.length === 0 ? (
              <p className="text-sm text-green-600 flex items-center gap-2"><CheckCircle2 size={16} /> Every product is above its reorder level.</p>
            ) : (
              <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-800">
                {stockAlerts.slice(0, 7).map((s) => (
                  <li key={s.product_id} className="flex items-center justify-between py-2 gap-2">
                    <span className="truncate"><b>{s.name}</b> <span className="text-slate-500">({s.sku})</span></span>
                    <span className={`whitespace-nowrap text-xs font-semibold rounded-full px-2 py-0.5 ${s.available <= 0 ? TONES.red : TONES.amber}`}>
                      {s.available <= 0 ? 'Out' : `${s.available} left`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Recent activity */}
      {activity.length > 0 && (
        <Card title="Recent activity">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-4">Type</th><th className="pr-4">Reference</th><th className="pr-4">Customer</th>
                  <th className="pr-4">Date</th><th className="pr-4">Amount</th><th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 pr-4"><Link to={a.to} className="hover:underline">{a.type}</Link></td>
                    <td className="pr-4">{a.ref}</td>
                    <td className="pr-4">{orgNames[a.org] ?? a.org}</td>
                    <td className="pr-4">{formatDate(a.date)}</td>
                    <td className="pr-4 font-medium">{formatKES(a.amount)}</td>
                    <td><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}