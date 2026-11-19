import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye, Download, Wallet, AlertTriangle, Clock, Users } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import { COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import { useOrganizations, useInvoices, nameMap } from '../../hooks/useLookups'

const DAY = 86400000
const num = (v) => Number(v ?? 0)
const parseDay = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`)
const iso = (d) => d.toISOString().slice(0, 10)

export default function ReceivablesPage() {
  const { hasPermission } = useAuth()
  const canPay = hasPermission('payment.record')
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const { data: invoices, isLoading } = useInvoices()
  const { data: orgs } = useOrganizations()
  const { data: payments } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => (await api.get('/payments/customer')).data,
    enabled: canPay,
  })
  const orgNames = nameMap(orgs)

  const today = new Date(); today.setHours(0, 0, 0, 0)

  const rows = useMemo(() => {
    const m = {}
    for (const inv of invoices ?? []) {
      if (!m[inv.organization_id]) {
        m[inv.organization_id] = {
          id: inv.organization_id, customer: orgNames[inv.organization_id] ?? '…',
          invoiced: 0, paid: 0, outstanding: 0, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, open: 0, oldest: 0,
        }
      }
      const r = m[inv.organization_id]
      const out = num(inv.total) - num(inv.paid_amount)
      r.invoiced += num(inv.total)
      r.paid += num(inv.paid_amount)
      if (out > 0.004) {
        r.outstanding += out
        r.open += 1
        const days = inv.due_date ? Math.floor((today - parseDay(inv.due_date)) / DAY) : 0
        if (days <= 0) r.current += out
        else {
          r.oldest = Math.max(r.oldest, days)
          if (days <= 30) r.d30 += out
          else if (days <= 60) r.d60 += out
          else if (days <= 90) r.d90 += out
          else r.d90p += out
        }
      }
    }
    return Object.values(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, orgs])

  const filtered = rows
    .filter((r) => r.outstanding > 0.004 || !only)
    .filter((r) => only !== 'overdue' || r.oldest > 0)
    .filter((r) => !search.trim() || r.customer.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.outstanding - a.outstanding)

  const sum = (k) => filtered.reduce((s, r) => s + r[k], 0)
  const total = sum('outstanding')
  const overdue = sum('d30') + sum('d60') + sum('d90') + sum('d90p')
  const aging = [
    { label: 'Not yet due', value: sum('current'), color: COLORS.green },
    { label: '1–30 days overdue', value: sum('d30'), color: COLORS.amber },
    { label: '31–60 days overdue', value: sum('d60'), color: '#f97316' },
    { label: '61–90 days overdue', value: sum('d90'), color: COLORS.red },
    { label: 'Over 90 days', value: sum('d90p'), color: '#991b1b' },
  ]
  const top = filtered.filter((r) => r.outstanding > 0).slice(0, 6).map((r) => ({ label: r.customer, value: r.outstanding }))

  const sel = rows.find((r) => r.id === selectedId)
  const statement = useMemo(() => {
    if (!sel) return []
    const invs = (invoices ?? []).filter((i) => i.organization_id === sel.id)
    const lines = invs.map((i) => ({
      key: `i${i.id}`, date: String(i.invoice_date).slice(0, 10), ref: i.internal_ref,
      desc: `Invoice${i.due_date ? ` (due ${formatDate(i.due_date)})` : ''}`, debit: num(i.total), credit: 0,
    }))
    if (canPay) {
      const ids = new Set(invs.map((i) => i.id))
      for (const p of payments ?? []) {
        if (p.status !== 'verified' || p.organization_id !== sel.id) continue
        const applied = p.allocations.filter((a) => ids.has(a.invoice_id)).reduce((s, a) => s + num(a.amount), 0)
        if (applied > 0) lines.push({
          key: `p${p.id}`, date: String(p.payment_date).slice(0, 10), ref: p.internal_ref,
          desc: `Payment (${p.method.replaceAll('_', ' ')}) ${p.transaction_ref}`, debit: 0, credit: applied,
        })
      }
    } else {
      const paid = invs.reduce((s, i) => s + num(i.paid_amount), 0)
      if (paid > 0) lines.push({ key: 'paid', date: iso(new Date()), ref: '', desc: 'Payments received (verified)', debit: 0, credit: paid })
    }
    lines.sort((a, b) => a.date.localeCompare(b.date))
    let bal = 0
    return lines.map((l) => { bal += l.debit - l.credit; return { ...l, balance: bal } })
  }, [sel, invoices, payments, canPay])

  const exportCsv = () =>
    downloadCsv(`receivables-${iso(new Date())}.csv`,
      ['Customer', 'Open invoices', 'Invoiced', 'Paid', 'Not yet due', '1-30', '31-60', '61-90', '90+', 'Outstanding'],
      filtered.map((r) => [r.customer, r.open, r.invoiced.toFixed(2), r.paid.toFixed(2), r.current.toFixed(2),
        r.d30.toFixed(2), r.d60.toFixed(2), r.d90.toFixed(2), r.d90p.toFixed(2), r.outstanding.toFixed(2)]))

  const money = (k, cls = '') => (r) => <span className={r[k] > 0.004 ? cls : 'text-slate-400'}>{formatKES(r[k])}</span>
  const columns = [
    { key: 'customer', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'open', header: 'Open invoices', sortable: true },
    { key: 'current', header: 'Not yet due', render: money('current') },
    { key: 'd30', header: '1–30 days', render: money('d30', 'text-amber-600') },
    { key: 'd60', header: '31–60', render: money('d60', 'text-orange-600') },
    { key: 'd90', header: '61–90', render: money('d90', 'text-red-500') },
    { key: 'd90p', header: '90+', render: money('d90p', 'text-red-700 font-semibold') },
    { key: 'outstanding', header: 'Total owed', sortable: true, render: (r) => <span className="font-semibold">{formatKES(r.outstanding)}</span> },
    { key: 'view', header: '', render: (r) => <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}><Eye size={14} /> Statement</button> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Receivables</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Money customers owe you, aged by invoice due date. Click a customer for a printable statement.</p>
        </div>
        <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[190px]" value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="">All customers</option>
          <option value="owing">Owing only</option>
          <option value="overdue">Overdue only</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Wallet} tone="red" label="Total receivable" value={formatKES(total)} />
        <Kpi icon={AlertTriangle} tone="red" label="Overdue" value={formatKES(overdue)} sub={total > 0 ? `${Math.round((overdue / total) * 100)}% of receivable` : ''} />
        <Kpi icon={Clock} tone="green" label="Not yet due" value={formatKES(sum('current'))} />
        <Kpi icon={Users} label="Customers owing" value={filtered.filter((r) => r.outstanding > 0.004).length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Receivables by age"><MoneyBars rows={aging} empty="Nothing is owed." /></Card>
        <Card title="Largest balances"><MoneyBars rows={top} color={COLORS.red} empty="Nobody owes anything." /></Card>
      </div>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No customers match." />
      )}

      {sel && (
        <DetailPanel title={`Statement of account: ${sel.customer}`} subtitle={`As at ${formatDate(new Date())}`} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Total invoiced">{formatKES(sel.invoiced)}</Field>
            <Field label="Total paid"><span className="text-green-600">{formatKES(sel.paid)}</span></Field>
            <Field label="Balance due"><span className="text-red-500 font-semibold">{formatKES(sel.outstanding)}</span></Field>
            <Field label="Oldest overdue">{sel.oldest > 0 ? `${sel.oldest} days` : 'None'}</Field>
          </div>
          <DataTable rows={statement} rowKey="key" emptyMessage="No transactions."
            columns={[
              { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
              { key: 'ref', header: 'Reference' },
              { key: 'desc', header: 'Description' },
              { key: 'debit', header: 'Charges', render: (r) => (r.debit ? formatKES(r.debit) : '—') },
              { key: 'credit', header: 'Payments', render: (r) => (r.credit ? <span className="text-green-600">{formatKES(r.credit)}</span> : '—') },
              { key: 'balance', header: 'Balance', render: (r) => <span className="font-medium">{formatKES(r.balance)}</span> },
            ]} />
          <div className="grid grid-cols-5 gap-2 text-xs">
            {[['Not yet due', sel.current], ['1–30', sel.d30], ['31–60', sel.d60], ['61–90', sel.d90], ['90+', sel.d90p]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-slate-100 dark:bg-slate-800 p-2"><div className="text-slate-500">{l}</div><div className="font-semibold">{formatKES(v)}</div></div>
            ))}
          </div>
          {canPay && sel.outstanding > 0.004 && (
            <div className="no-print"><Link to="/payments" className="btn-primary inline-flex">Record a payment</Link></div>
          )}
        </DetailPanel>
      )}
    </div>
  )
}