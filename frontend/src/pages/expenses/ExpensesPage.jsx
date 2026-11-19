import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Eye, Download, Wallet, Clock, CalendarDays, Tags } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import { apiError } from '../../hooks/useLookups'

const METHODS = ['cash', 'mpesa_manual', 'bank_transfer', 'cheque', 'other']
const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)
const label = (m) => String(m).replaceAll('_', ' ')
const EMPTY = () => ({ category_id: '', description: '', amount: '', expense_date: iso(new Date()), method: 'cash' })

export default function ExpensesPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const canDecide = hasPermission('invoice.approve')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [months, setMonths] = useState(6)
  const [newCat, setNewCat] = useState('')

  const { data: expenses, isLoading, error: loadError } = useQuery({ queryKey: ['expenses'], queryFn: async () => (await api.get('/expenses')).data })
  const { data: cats } = useQuery({ queryKey: ['expense-categories'], queryFn: async () => (await api.get('/expenses/categories')).data })
  const { register, handleSubmit, reset } = useForm({ defaultValues: EMPTY() })

  const refresh = () => ['expenses', 'expense-categories', 'accounting-accounts', 'accounting-journal'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const bad = (f) => (e) => { setNotice(''); setError(apiError(e, f)) }

  const createMutation = useMutation({
    mutationFn: (p) => api.post('/expenses', p),
    onSuccess: (res) => { refresh(); setShowForm(false); reset(EMPTY()); setError(''); setNotice(`Expense ${res.data?.internal_ref ?? ''} recorded. A different user must approve it.`) },
    onError: bad('Failed to record expense'),
  })
  const decideMutation = useMutation({
    mutationFn: ({ id, approve, reason }) => api.post(`/expenses/${id}/decide`, { approve, reason: reason || null }),
    onSuccess: (_r, v) => { refresh(); setError(''); setNotice(v.approve ? 'Expense approved and posted to the books.' : 'Expense rejected.') },
    onError: bad('Action failed'),
  })
  const catMutation = useMutation({
    mutationFn: (name) => api.post('/expenses/categories', { name }),
    onSuccess: () => { refresh(); setNewCat(''); setError(''); setNotice('Category added.') },
    onError: bad('Failed to add category'),
  })

  const onReject = (e) => {
    const reason = window.prompt('Reject expense — reason (required):')
    if (reason && reason.trim()) decideMutation.mutate({ id: e.id, approve: false, reason: reason.trim() })
  }
  const onSubmit = (v) => createMutation.mutate({ category_id: Number(v.category_id), description: v.description.trim(), amount: String(v.amount), expense_date: v.expense_date, method: v.method })

  const rows = useMemo(() => (expenses ?? []).map((e) => ({ ...e, amt: num(e.amount) })), [expenses])
  const filtered = rows
    .filter((e) => !statusFilter || e.status === statusFilter)
    .filter((e) => !catFilter || String(e.category_id) === catFilter)
    .filter((e) => !search.trim() || [e.internal_ref, e.description, e.category, e.recorded_by].some((x) => String(x ?? '').toLowerCase().includes(search.trim().toLowerCase())))

  const approved = filtered.filter((e) => e.status === 'approved')
  const pending = filtered.filter((e) => e.status === 'pending_approval')
  const monthKey = iso(new Date()).slice(0, 7)
  const thisMonth = approved.filter((e) => String(e.expense_date).startsWith(monthKey)).reduce((s, e) => s + e.amt, 0)
  const byCat = Object.entries(approved.reduce((m, e) => ({ ...m, [e.category ?? '—']: (m[e.category ?? '—'] ?? 0) + e.amt }), {}))
    .map(([l, value]) => ({ label: l, value })).sort((a, b) => b.value - a.value).slice(0, 6)

  const chart = useMemo(() => {
    const now = new Date(); const b = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      b.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-KE', { month: 'short' }), a: 0 })
    }
    approved.forEach((e) => { const x = b.find((m) => m.key === String(e.expense_date).slice(0, 7)); if (x) x.a += e.amt })
    return b
  }, [approved, months])

  const exportCsv = () =>
    downloadCsv(`expenses-${iso(new Date())}.csv`, ['Reference', 'Date', 'Category', 'Description', 'Method', 'Amount', 'Recorded by', 'Status'],
      filtered.map((e) => [e.internal_ref, e.expense_date, e.category ?? '', e.description, label(e.method), e.amt.toFixed(2), e.recorded_by ?? '', e.status]))

  const decideButtons = (e) => e.status === 'pending_approval' && canDecide && (
    <>
      <button className="btn-primary" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ id: e.id, approve: true })}>Approve</button>
      <button className="btn-secondary" disabled={decideMutation.isPending} onClick={() => onReject(e)}>Reject</button>
    </>
  )

  const columns = [
    { key: 'internal_ref', header: 'Reference', sortable: true },
    { key: 'expense_date', header: 'Date', sortable: true, render: (r) => formatDate(r.expense_date) },
    { key: 'category', header: 'Category', sortable: true },
    { key: 'description', header: 'Description' },
    { key: 'method', header: 'Method', render: (r) => <span className="capitalize">{label(r.method)}</span> },
    { key: 'amt', header: 'Amount', sortable: true, render: (r) => <span className="font-semibold">{formatKES(r.amt)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'actions', header: '', render: (r) => (
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <button className="btn-secondary" onClick={() => setSelectedId(r.id)}><Eye size={14} /> View</button>
        {decideButtons(r)}
      </div>) },
  ]

  const sel = rows.find((e) => e.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Record business expenses. A different user approves each one, which posts it to the books.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}><Plus size={16} /> New Expense</button>
        </div>
      </div>

      {(error || loadError) && <div className="card p-3 text-sm text-red-500">{error || apiError(loadError)}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {pending.length > 0 && canDecide && statusFilter !== 'pending_approval' && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm"><b>{pending.length}</b> expense{pending.length > 1 ? 's' : ''} worth <b>{formatKES(pending.reduce((s, e) => s + e.amt, 0))}</b> waiting for approval.</span>
          <button className="btn-secondary" onClick={() => setStatusFilter('pending_approval')}>Show them</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Category *</label>
            <select className="input" {...register('category_id', { required: true })}>
              <option value="">Select…</option>
              {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-2 mt-2">
              <input className="input" placeholder="New category…" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <button type="button" className="btn-secondary" disabled={!newCat.trim() || catMutation.isPending} onClick={() => catMutation.mutate(newCat.trim())}><Tags size={14} /> Add</button>
            </div>
          </div>
          <div className="md:col-span-2"><label className="label">Description *</label><input className="input" placeholder="e.g. Fuel for delivery truck" {...register('description', { required: true })} /></div>
          <div><label className="label">Amount (KSh) *</label><input type="number" step="0.01" min="0.01" className="input" {...register('amount', { required: true })} /></div>
          <div><label className="label">Date *</label><input type="date" className="input" {...register('expense_date', { required: true })} /></div>
          <div><label className="label">Paid by</label><select className="input" {...register('method')}>{METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">{createMutation.isPending ? 'Saving…' : 'Save expense'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search expenses…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[190px]" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">All categories</option>{(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input max-w-[190px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option><option value="pending_approval">Awaiting approval</option>
          <option value="approved">Approved</option><option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Wallet} label="Approved expenses" value={formatKES(approved.reduce((s, e) => s + e.amt, 0))} sub={`${approved.length} records`} />
        <Kpi icon={CalendarDays} tone="amber" label="This month" value={formatKES(thisMonth)} />
        <Kpi icon={Clock} tone="amber" label="Awaiting approval" value={pending.length} sub={formatKES(pending.reduce((s, e) => s + e.amt, 0))} />
        <Kpi icon={Tags} label="Categories" value={(cats ?? []).length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Approved expenses per month" className="lg:col-span-2" action={
          <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
          </select>}>
          <AreaChart data={chart} height={200} series={[{ key: 'a', label: 'Expenses', color: COLORS.red }]} />
        </Card>
        <Card title="By category"><MoneyBars rows={byCat} color={COLORS.amber} empty="No approved expenses yet." /></Card>
      </div>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No expenses yet." />
      )}

      {sel && (
        <DetailPanel title={`Expense voucher ${sel.internal_ref}`} subtitle={sel.category} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Category">{sel.category}</Field>
            <Field label="Date">{formatDate(sel.expense_date)}</Field>
            <Field label="Amount"><span className="font-semibold">{formatKES(sel.amt)}</span></Field>
            <Field label="Status"><StatusBadge status={sel.status} /></Field>
            <Field label="Paid by"><span className="capitalize">{label(sel.method)}</span></Field>
            <Field label="Recorded by">{sel.recorded_by}</Field>
            <Field label="Approved by">{sel.approved_by}</Field>
            <Field label="Description">{sel.description}</Field>
          </div>
          <div className="grid grid-cols-2 gap-10 pt-8 text-xs text-slate-500">
            <div className="border-t border-slate-400 pt-1">Prepared by</div>
            <div className="border-t border-slate-400 pt-1">Approved by</div>
          </div>
          <div className="flex gap-2 no-print">{decideButtons(sel)}</div>
        </DetailPanel>
      )}
    </div>
  )
}