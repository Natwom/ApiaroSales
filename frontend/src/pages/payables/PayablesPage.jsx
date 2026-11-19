import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Download, Wallet, Truck, CheckCircle2, ClipboardList } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import AreaChart from '../../components/common/AreaChart'
import { COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { formatKES, formatDate } from '../../utils/format'
import { apiError } from '../../hooks/useLookups'

const METHODS = ['bank_transfer', 'mpesa_manual', 'cash', 'cheque', 'other']
const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)
const label = (m) => String(m).replaceAll('_', ' ')
const EMPTY = () => ({ po_id: '', amount: '', payment_date: iso(new Date()), method: 'bank_transfer', reference: '', notes: '' })

export default function PayablesPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState('owing')
  const [months, setMonths] = useState(6)

  const { data: pos, isLoading, error: loadError } = useQuery({
    queryKey: ['payables'], queryFn: async () => (await api.get('/payables')).data,
  })
  const { data: payments } = useQuery({
    queryKey: ['payables-payments'], queryFn: async () => (await api.get('/payables/payments')).data,
  })
  const { register, handleSubmit, watch, setValue, reset } = useForm({ defaultValues: EMPTY() })
  const poId = watch('po_id')
  const amount = num(watch('amount'))

  const rows = useMemo(() => (pos ?? []).map((p) => ({ ...p, out: num(p.outstanding) })), [pos])
  const owing = rows.filter((r) => r.out > 0.004)
  const chosen = rows.find((r) => String(r.id) === String(poId))

  const filtered = rows
    .filter((r) => only !== 'owing' || r.out > 0.004)
    .filter((r) => !search.trim() || [r.internal_ref, r.supplier].some((x) => String(x).toLowerCase().includes(search.trim().toLowerCase())))

  const received = rows.reduce((s, r) => s + num(r.received_value), 0)
  const paid = rows.reduce((s, r) => s + num(r.paid), 0)
  const owed = owing.reduce((s, r) => s + r.out, 0)
  const notReceived = rows.filter((r) => ['approved', 'partially_received'].includes(r.status))
    .reduce((s, r) => s + (num(r.total) - num(r.received_value)), 0)

  const bySupplier = Object.entries(owing.reduce((m, r) => ({ ...m, [r.supplier]: (m[r.supplier] ?? 0) + r.out }), {}))
    .map(([l, value]) => ({ label: l, value })).sort((a, b) => b.value - a.value).slice(0, 6)

  const chart = useMemo(() => {
    const now = new Date(); const b = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      b.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-KE', { month: 'short' }), a: 0 })
    }
    for (const p of payments ?? []) { const x = b.find((m) => m.key === String(p.payment_date).slice(0, 7)); if (x) x.a += num(p.amount) }
    return b
  }, [payments, months])

  const refresh = () => ['payables', 'payables-payments', 'accounting-accounts', 'accounting-journal', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const mutation = useMutation({
    mutationFn: (p) => api.post('/payables/payments', p),
    onSuccess: (res) => { refresh(); setShowForm(false); reset(EMPTY()); setError(''); setNotice(`Payment ${res.data?.internal_ref ?? ''} recorded and posted to the books.`) },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to record payment')) },
  })

  const payFor = (r) => {
    setShowForm(true); setError(''); setNotice('')
    reset({ ...EMPTY(), po_id: String(r.id), amount: r.out.toFixed(2) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const onSubmit = (v) => {
    if (chosen && amount > chosen.out + 0.001) { setError(`Only ${formatKES(chosen.out)} is owed on this purchase order.`); return }
    mutation.mutate({ po_id: Number(v.po_id), amount: String(v.amount), payment_date: v.payment_date, method: v.method, reference: v.reference || null, notes: v.notes || null })
  }

  const exportCsv = () =>
    downloadCsv(`payables-${iso(new Date())}.csv`,
      ['PO', 'Supplier', 'Order date', 'Status', 'Ordered', 'Received value', 'Paid', 'Owed'],
      filtered.map((r) => [r.internal_ref, r.supplier, r.order_date, r.status, num(r.total).toFixed(2), num(r.received_value).toFixed(2), num(r.paid).toFixed(2), r.out.toFixed(2)]))

  const columns = [
    { key: 'internal_ref', header: 'PO', sortable: true },
    { key: 'supplier', header: 'Supplier', sortable: true, render: (r) => <span className="font-medium">{r.supplier}</span> },
    { key: 'order_date', header: 'Ordered', render: (r) => formatDate(r.order_date) },
    { key: 'status', header: 'PO status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'total', header: 'Ordered value', render: (r) => formatKES(r.total) },
    { key: 'received_value', header: 'Goods received', render: (r) => formatKES(r.received_value) },
    { key: 'paid', header: 'Paid', render: (r) => <span className="text-green-600">{formatKES(r.paid)}</span> },
    { key: 'out', header: 'We owe', sortable: true, render: (r) => <span className={r.out > 0.004 ? 'text-red-500 font-semibold' : 'text-slate-400'}>{formatKES(r.out)}</span> },
    { key: 'actions', header: '', render: (r) => r.out > 0.004 && <button className="btn-primary" onClick={() => payFor(r)}>Pay</button> },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payables</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">What you owe suppliers: value of goods received on purchase orders, less payments made.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}><Plus size={16} /> Record Supplier Payment</button>
        </div>
      </div>

      {(error || loadError) && <div className="card p-3 text-sm text-red-500">{error || apiError(loadError)}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="label">Purchase order *</label>
            <select className="input" {...register('po_id', {
              required: true,
              onChange: (e) => { const r = rows.find((x) => String(x.id) === e.target.value); if (r) setValue('amount', r.out.toFixed(2)) },
            })}>
              <option value="">Select…</option>
              {owing.map((r) => <option key={r.id} value={r.id}>{r.internal_ref} — {r.supplier} — owed {formatKES(r.out)}</option>)}
            </select>
            {owing.length === 0 && <p className="text-xs text-amber-600 mt-1">Nothing is owed. Receive goods on an approved purchase order first.</p>}
          </div>
          <div><label className="label">Payment date *</label><input type="date" className="input" {...register('payment_date', { required: true })} /></div>
          <div>
            <label className="label">Amount (KSh) *</label>
            <input type="number" step="0.01" min="0.01" className="input" {...register('amount', { required: true })} />
            {chosen && <p className={`text-xs mt-1 ${amount > chosen.out + 0.001 ? 'text-red-500' : 'text-slate-500'}`}>Owed on this PO: {formatKES(chosen.out)}</p>}
          </div>
          <div><label className="label">Method *</label><select className="input" {...register('method')}>{METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</select></div>
          <div><label className="label">Reference</label><input className="input" placeholder="Transfer / cheque no." {...register('reference')} /></div>
          <div className="md:col-span-3"><label className="label">Notes</label><input className="input" {...register('notes')} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={mutation.isPending} className="btn-primary">{mutation.isPending ? 'Saving…' : 'Record payment'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Wallet} tone="red" label="Owed to suppliers" value={formatKES(owed)} sub={`${owing.length} purchase orders`} />
        <Kpi icon={ClipboardList} label="Goods received (value)" value={formatKES(received)} />
        <Kpi icon={CheckCircle2} tone="green" label="Paid to suppliers" value={formatKES(paid)} />
        <Kpi icon={Truck} tone="amber" label="Ordered, not yet received" value={formatKES(notReceived)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Owed by supplier"><MoneyBars rows={bySupplier} color={COLORS.red} empty="You owe no supplier anything." /></Card>
        <Card title="Supplier payments per month" action={
          <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
          </select>}>
          <AreaChart data={chart} height={190} series={[{ key: 'a', label: 'Paid', color: COLORS.green }]} />
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search PO or supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={only} onChange={(e) => setOnly(e.target.value)}>
          <option value="owing">With a balance</option><option value="">All purchase orders</option>
        </select>
      </div>
      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered} emptyMessage="Nothing is owed to suppliers." />
      )}

      <div>
        <h2 className="font-semibold mb-2">Payment history</h2>
        <DataTable rows={payments ?? []} emptyMessage="No supplier payments yet."
          columns={[
            { key: 'internal_ref', header: 'Payment' },
            { key: 'payment_date', header: 'Date', render: (r) => formatDate(r.payment_date) },
            { key: 'supplier', header: 'Supplier' },
            { key: 'po_ref', header: 'PO' },
            { key: 'method', header: 'Method', render: (r) => <span className="capitalize">{label(r.method)}</span> },
            { key: 'reference', header: 'Reference' },
            { key: 'amount', header: 'Amount', render: (r) => <span className="font-medium">{formatKES(r.amount)}</span> },
          ]} />
      </div>
    </div>
  )
}