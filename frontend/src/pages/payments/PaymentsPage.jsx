import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { Plus, Trash2, Eye, Download, Banknote, CheckCircle2, Hourglass, Undo2, CalendarDays } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { Donut, COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import {
  useInvoices, useOrders, useWorkers, useOrganizations, nameMap, apiError,
} from '../../hooks/useLookups'

const METHODS = ['mpesa_manual', 'bank_transfer', 'cash', 'cheque', 'other']
const DAY = 86400000
const num = (v) => Number(v ?? 0)
const today = () => new Date().toISOString().slice(0, 10)
const label = (m) => String(m).replaceAll('_', ' ')
const EMPTY = () => ({
  organization_id: '', payment_date: today(), method: 'mpesa_manual',
  transaction_ref: '', amount: '', description: '',
  allocations: [{ invoice_id: '', amount: '' }],
})

export default function PaymentsPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const [search, setSearch] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [range, setRange] = useState('all')
  const [months, setMonths] = useState(6)

  const { data: payments, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => (await api.get('/payments/customer')).data,
  })
  const { data: invoices } = useInvoices()
  const { data: orders } = useOrders()
  const { data: workers } = useWorkers()
  const { data: orgs } = useOrganizations()

  const { register, handleSubmit, control, watch, setValue, reset } = useForm({ defaultValues: EMPTY() })
  const { fields, append, remove } = useFieldArray({ control, name: 'allocations' })
  const orgId = watch('organization_id')
  const formAmount = num(watch('amount'))
  const formAllocs = watch('allocations')

  const orgNames = nameMap(orgs)
  const invoiceRefs = nameMap(invoices, 'internal_ref')
  const workerNames = nameMap(workers, 'full_name')
  const outstanding = (i) => num(i.total) - num(i.paid_amount)

  const workersFor = (p) => {
    const names = new Set()
    p.allocations.forEach((a) => {
      const inv = (invoices ?? []).find((i) => i.id === a.invoice_id)
      const o = (orders ?? []).find((x) => x.id === inv?.order_id)
      if (o?.worker_id && workerNames[o.worker_id]) names.add(workerNames[o.worker_id])
    })
    return [...names].join(', ') || '—'
  }

  const enriched = useMemo(
    () => (payments ?? []).map((p) => ({
      ...p,
      customer: orgNames[p.organization_id] ?? '…',
      worker: workersFor(p),
      allocated: p.allocations.reduce((s, a) => s + num(a.amount), 0),
      invoices_text: p.allocations.map((a) => invoiceRefs[a.invoice_id] ?? a.invoice_id).join(', ') || '—',
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [payments, orgs, invoices, orders, workers],
  )

  const filtered = enriched
    .filter((p) => !customerFilter || String(p.organization_id) === customerFilter)
    .filter((p) => !statusFilter || p.status === statusFilter)
    .filter((p) => !methodFilter || p.method === methodFilter)
    .filter((p) => range === 'all' || Date.now() - new Date(`${p.payment_date}T00:00:00`).getTime() <= Number(range) * DAY)
    .filter((p) => {
      const q = search.trim().toLowerCase()
      return !q || [p.internal_ref, p.transaction_ref, p.customer, p.worker, p.invoices_text, p.method]
        .some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  // ---------- KPIs ----------
  const sum = (list) => list.reduce((s, p) => s + num(p.amount), 0)
  const verified = filtered.filter((p) => p.status === 'verified')
  const pending = filtered.filter((p) => p.status === 'pending_verification')
  const bad = filtered.filter((p) => ['rejected', 'reversed'].includes(p.status))
  const monthKey = new Date().toISOString().slice(0, 7)
  const thisMonth = sum(verified.filter((p) => String(p.payment_date).startsWith(monthKey)))

  // ---------- charts ----------
  const chartData = useMemo(() => {
    const now = new Date()
    const b = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      b.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-KE', { month: 'short' }),
        a: 0, b: 0,
      })
    }
    filtered.forEach((p) => {
      const x = b.find((m) => m.key === String(p.payment_date).slice(0, 7))
      if (!x) return
      if (p.status === 'verified') x.a += num(p.amount)
      if (p.status === 'pending_verification') x.b += num(p.amount)
    })
    return b
  }, [filtered, months])

  const statusDonut = [
    { label: 'Verified', value: verified.length, color: COLORS.green },
    { label: 'Awaiting', value: pending.length, color: COLORS.amber },
    { label: 'Rejected / reversed', value: bad.length, color: COLORS.red },
  ]
  const byMethod = Object.entries(
    verified.reduce((m, p) => ({ ...m, [label(p.method)]: (m[label(p.method)] ?? 0) + num(p.amount) }), {}),
  ).map(([l, value]) => ({ label: l, value })).sort((a, b) => b.value - a.value)
  const byCustomer = Object.entries(
    verified.reduce((m, p) => ({ ...m, [p.customer]: (m[p.customer] ?? 0) + num(p.amount) }), {}),
  ).map(([l, value]) => ({ label: l, value })).sort((a, b) => b.value - a.value).slice(0, 5)

  // ---------- form ----------
  const openInvoices = (invoices ?? []).filter(
    (i) => String(i.organization_id) === String(orgId) && i.status !== 'fully_paid',
  )
  const allocTotal = (formAllocs ?? []).reduce((s, a) => s + num(a.amount), 0)
  const unallocated = formAmount - allocTotal

  const refreshAll = () => {
    ;['payments', 'invoices', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  }

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/payments/customer', payload),
    onSuccess: (res) => {
      refreshAll(); setShowForm(false); reset(EMPTY()); setError('')
      setNotice(`Payment ${res.data?.internal_ref ?? ''} recorded. It must be verified before invoices change.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to record payment')) },
  })

  const actionMutation = useMutation({
    mutationFn: ({ id, action, approve, reason }) =>
      api.post(`/payments/customer/${id}/${action}`, { approve, reason: reason || null }),
    onSuccess: (_r, v) => {
      refreshAll(); setError('')
      setNotice(v.action === 'reverse' ? 'Payment reversed.' : v.approve ? 'Payment verified and applied to invoices.' : 'Payment rejected.')
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Action failed')) },
  })

  const ask = (text) => {
    const reason = window.prompt(`${text} — reason (required):`)
    return reason && reason.trim() ? reason.trim() : null
  }
  const onVerify = (p) => actionMutation.mutate({ id: p.id, action: 'verify', approve: true, reason: 'Verified' })
  const onReject = (p) => { const r = ask('Reject payment'); if (r) actionMutation.mutate({ id: p.id, action: 'verify', approve: false, reason: r }) }
  const onReverse = (p) => { const r = ask('Reverse payment'); if (r) actionMutation.mutate({ id: p.id, action: 'reverse', approve: true, reason: r }) }

  const onSubmit = (v) => {
    if (allocTotal > formAmount + 0.001) {
      setError('Allocations are more than the payment amount.')
      return
    }
    createMutation.mutate({
      organization_id: Number(v.organization_id),
      payment_date: v.payment_date,
      method: v.method,
      transaction_ref: v.transaction_ref.trim(),
      amount: String(v.amount),
      description: v.description || null,
      allocations: v.allocations
        .filter((a) => a.invoice_id && Number(a.amount) > 0)
        .map((a) => ({ invoice_id: Number(a.invoice_id), amount: String(a.amount) })),
    })
  }

  const exportCsv = () =>
    downloadCsv(`payments-${today()}.csv`,
      ['Reference', 'Date', 'Customer', 'Worker', 'Method', 'Transaction Ref', 'Amount', 'Allocated to', 'Status'],
      filtered.map((p) => [p.internal_ref, p.payment_date, p.customer, p.worker, label(p.method),
        p.transaction_ref, num(p.amount).toFixed(2), p.invoices_text, p.status]))

  const actionButtons = (r) => (
    <>
      {r.status === 'pending_verification' && hasPermission('payment.verify') && (
        <>
          <button className="btn-primary" disabled={actionMutation.isPending} onClick={() => onVerify(r)}>Verify</button>
          <button className="btn-secondary" disabled={actionMutation.isPending} onClick={() => onReject(r)}>Reject</button>
        </>
      )}
      {r.status === 'verified' && hasPermission('payment.reverse') && (
        <button className="btn-secondary" disabled={actionMutation.isPending} onClick={() => onReverse(r)}>Reverse</button>
      )}
    </>
  )

  const columns = [
    { key: 'internal_ref', header: 'Reference', sortable: true },
    { key: 'payment_date', header: 'Date', sortable: true, render: (r) => formatDate(r.payment_date) },
    { key: 'customer', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.customer}</span> },
    { key: 'worker', header: 'Worker' },
    { key: 'method', header: 'Method', render: (r) => <span className="capitalize">{label(r.method)}</span> },
    { key: 'transaction_ref', header: 'Transaction Ref' },
    { key: 'amount', header: 'Amount', sortable: true, render: (r) => <span className="font-semibold">{formatKES(r.amount)}</span> },
    { key: 'invoices_text', header: 'Allocated to' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: '',
      render: (r) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button className="btn-secondary" onClick={() => setSelectedId(r.id)}><Eye size={14} /> View</button>
          {actionButtons(r)}
        </div>
      ),
    },
  ]

  const pay = enriched.find((p) => p.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Record a payment, then have a different user verify it. Only verified payments reduce invoice balances.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('payment.record') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> Record Payment
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {pending.length > 0 && hasPermission('payment.verify') && statusFilter !== 'pending_verification' && (
        <div className="card p-4 border-l-4 border-l-amber-500 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            <b>{pending.length}</b> payment{pending.length > 1 ? 's' : ''} worth <b>{formatKES(sum(pending))}</b> waiting for verification.
          </span>
          <button className="btn-secondary" onClick={() => setStatusFilter('pending_verification')}>Show them</button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Customer *</label>
            <select className="input" {...register('organization_id', {
              required: true,
              onChange: () => setValue('allocations', [{ invoice_id: '', amount: '' }]),
            })}>
              <option value="">Select…</option>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Payment date *</label>
            <input type="date" className="input" {...register('payment_date', { required: true })} />
          </div>
          <div>
            <label className="label">Method *</label>
            <select className="input" {...register('method')}>
              {METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Transaction reference * (unique)</label>
            <input className="input" placeholder="e.g. M-Pesa code" {...register('transaction_ref', { required: true })} />
          </div>
          <div>
            <label className="label">Amount (KSh) *</label>
            <input type="number" step="0.01" min="0.01" className="input" {...register('amount', { required: true })} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" {...register('description')} />
          </div>

          <div className="md:col-span-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="label">Allocate to invoices</div>
              {orgId && openInvoices.length === 0 && (
                <span className="text-xs text-amber-600">This customer has no unpaid invoices.</span>
              )}
            </div>
            {fields.map((f, idx) => (
              <div key={f.id} className="grid grid-cols-12 gap-2">
                <div className="col-span-7">
                  <select className="input"
                    {...register(`allocations.${idx}.invoice_id`, {
                      onChange: (e) => {
                        const inv = openInvoices.find((i) => String(i.id) === e.target.value)
                        if (!inv) return
                        const room = formAmount - allocTotal
                        const give = formAmount > 0 && room > 0 ? Math.min(room, outstanding(inv)) : outstanding(inv)
                        setValue(`allocations.${idx}.amount`, give.toFixed(2))
                      },
                    })}>
                    <option value="">Invoice…</option>
                    {openInvoices.map((i) => {
                      const o = (orders ?? []).find((x) => x.id === i.order_id)
                      const w = o?.worker_id ? workerNames[o.worker_id] : null
                      return (
                        <option key={i.id} value={i.id}>
                          {i.internal_ref}{w ? ` — ${w}` : ''} — outstanding {formatKES(outstanding(i))}
                        </option>
                      )
                    })}
                  </select>
                </div>
                <div className="col-span-4">
                  <input type="number" step="0.01" min="0" className="input" placeholder="Amount"
                    {...register(`allocations.${idx}.amount`)} />
                </div>
                <div className="col-span-1">
                  <button type="button" className="btn-secondary" disabled={fields.length === 1} onClick={() => remove(idx)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn-secondary" onClick={() => append({ invoice_id: '', amount: '' })}>
                <Plus size={14} /> Add allocation
              </button>
              <span className={`text-sm ${unallocated < -0.001 ? 'text-red-500' : 'text-slate-500'}`}>
                Allocated {formatKES(allocTotal)} of {formatKES(formAmount)}
                {unallocated > 0.001 && ` · ${formatKES(unallocated)} not allocated`}
                {unallocated < -0.001 && ' · over-allocated'}
              </span>
            </div>
          </div>

          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">
              {createMutation.isPending ? 'Saving…' : 'Record Payment'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search reference, customer, transaction…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[200px]" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="">All customers</option>
          {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="input max-w-[190px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending_verification">Awaiting verification</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
          <option value="reversed">Reversed</option>
        </select>
        <select className="input max-w-[170px]" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
          <option value="">All methods</option>
          {METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}
        </select>
        <select className="input max-w-[150px]" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="all">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Banknote} label="Payments" value={filtered.length} />
        <Kpi icon={CheckCircle2} tone="green" label="Verified total" value={formatKES(sum(verified))} sub={`${verified.length} payments`} />
        <Kpi icon={Hourglass} tone="amber" label="Awaiting verification" value={formatKES(sum(pending))} sub={`${pending.length} payments`} />
        <Kpi icon={CalendarDays} label="Received this month" value={formatKES(thisMonth)} />
        <Kpi icon={Undo2} tone="red" label="Rejected / reversed" value={bad.length} sub={formatKES(sum(bad))} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Money received per month" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
            </select>
          }>
          <AreaChart data={chartData} height={210} series={[
            { key: 'a', label: 'Verified', color: COLORS.green },
            { key: 'b', label: 'Awaiting verification', color: COLORS.amber },
          ]} />
        </Card>
        <Card title="Payments by status">
          <Donut centerLabel="payments" segments={statusDonut} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Verified by method"><MoneyBars rows={byMethod} color={COLORS.brand} empty="No verified payments yet." /></Card>
        <Card title="Top paying customers"><MoneyBars rows={byCustomer} color={COLORS.green} empty="No verified payments yet." /></Card>
      </div>

      {isLoading ? (
        <div className="card h-48 animate-pulse" />
      ) : (
        <DataTable columns={columns} rows={filtered}
          onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No payments match." />
      )}

      {pay && (
        <DetailPanel title={`Payment receipt ${pay.internal_ref}`} subtitle={`${pay.customer} · ${formatKES(pay.amount)}`}
          onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{pay.customer}</Field>
            <Field label="Worker">{pay.worker}</Field>
            <Field label="Status"><StatusBadge status={pay.status} /></Field>
            <Field label="Payment date">{formatDate(pay.payment_date)}</Field>
            <Field label="Method"><span className="capitalize">{label(pay.method)}</span></Field>
            <Field label="Transaction ref">{pay.transaction_ref}</Field>
            <Field label="Amount"><span className="font-semibold">{formatKES(pay.amount)}</span></Field>
            <Field label="Unallocated">{formatKES(num(pay.amount) - pay.allocated)}</Field>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Allocated to invoices</h3>
            <DataTable rowKey="invoice_id" rows={pay.allocations} emptyMessage="No allocations."
              columns={[
                { key: 'invoice_id', header: 'Invoice', render: (r) => invoiceRefs[r.invoice_id] ?? r.invoice_id },
                { key: 'amount', header: 'Amount applied', render: (r) => formatKES(r.amount) },
                {
                  key: 'inv_total', header: 'Invoice total',
                  render: (r) => { const i = (invoices ?? []).find((x) => x.id === r.invoice_id); return i ? formatKES(i.total) : '—' },
                },
                {
                  key: 'inv_out', header: 'Invoice outstanding',
                  render: (r) => { const i = (invoices ?? []).find((x) => x.id === r.invoice_id); return i ? formatKES(outstanding(i)) : '—' },
                },
                {
                  key: 'inv_status', header: 'Invoice status',
                  render: (r) => { const i = (invoices ?? []).find((x) => x.id === r.invoice_id); return i ? <StatusBadge status={i.status} /> : '—' },
                },
              ]} />
          </div>

          {pay.status === 'pending_verification' && (
            <p className="text-sm text-amber-600">Awaiting verification. Invoice balances don't change until it is verified.</p>
          )}

          <div className="grid grid-cols-2 gap-10 pt-6 text-xs text-slate-500">
            <div className="border-t border-slate-400 pt-1">Received by (Apiaro)</div>
            <div className="border-t border-slate-400 pt-1">Paid by (name and signature)</div>
          </div>

          <div className="flex gap-2 no-print">{actionButtons(pay)}</div>
        </DetailPanel>
      )}
    </div>
  )
}