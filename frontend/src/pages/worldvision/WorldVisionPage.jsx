import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye, Download, Receipt, Banknote, AlertTriangle, Hourglass, FileText, Users } from 'lucide-react'
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
  useOrganizations, useLpos, useOrders, useWorkers, useInvoices, useProducts, nameMap,
} from '../../hooks/useLookups'

const num = (v) => Number(v ?? 0)
const outstandingOf = (i) => num(i.total) - num(i.paid_amount)

function Progress({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="w-32">
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden"><div className="h-2 rounded bg-brand-500" style={{ width: `${pct}%` }} /></div>
      <div className="text-[10px] text-slate-500 mt-0.5">{done} of {total} units ({pct}%)</div>
    </div>
  )
}

export default function WorldVisionPage() {
  const { hasPermission } = useAuth()
  const [view, setView] = useState(null) // { type: 'lpo'|'invoice'|'payment', id }
  const [invFilter, setInvFilter] = useState('')
  const [workerFilter, setWorkerFilter] = useState('')
  const [months, setMonths] = useState(6)

  const { data: orgs, isLoading } = useOrganizations()
  const { data: lpos } = useLpos()
  const { data: orders } = useOrders()
  const { data: workers } = useWorkers()
  const { data: invoices } = useInvoices()
  const { data: products } = useProducts()
  const { data: payments } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => (await api.get('/payments/customer')).data,
    enabled: hasPermission('payment.record'),
  })

  const org = (orgs ?? []).find((o) => /world\s*vision/i.test(o.name))

  if (isLoading) return <div className="card h-48 animate-pulse" />
  if (!org) {
    return (
      <div className="card p-10 text-center space-y-2">
        <h1 className="text-xl font-semibold">World Vision Workspace</h1>
        <p className="text-sm text-slate-500">No organization named “World Vision” exists yet.</p>
        <Link to="/organizations" className="btn-primary inline-flex">Create it under Customers</Link>
      </div>
    )
  }

  const mine = (r) => r.organization_id === org.id
  const myLpos = (lpos ?? []).filter(mine)
  const myOrders = (orders ?? []).filter(mine)
  const myWorkers = (workers ?? []).filter(mine)
  const myInvoices = (invoices ?? []).filter(mine)
  const myPayments = (payments ?? []).filter(mine)

  const workerNames = nameMap(workers, 'full_name')
  const productNames = nameMap(products)
  const lpoNos = nameMap(lpos, 'customer_lpo_no')
  const orderRefs = nameMap(orders, 'internal_ref')
  const invoiceRefs = nameMap(invoices, 'internal_ref')

  const workerIdOfInvoice = (inv) => {
    const o = myOrders.find((x) => x.id === inv.order_id)
    if (o?.worker_id) return o.worker_id
    return myLpos.find((x) => x.id === inv.lpo_id)?.worker_id ?? null
  }
  const workerOfInvoice = (inv) => workerNames[workerIdOfInvoice(inv)] ?? '—'
  const workersOfPayment = (p) => {
    const names = new Set()
    p.allocations.forEach((a) => {
      const inv = myInvoices.find((i) => i.id === a.invoice_id)
      const n = inv ? workerNames[workerIdOfInvoice(inv)] : null
      if (n) names.add(n)
    })
    return [...names].join(', ') || '—'
  }

  const byWorker = (r, wid) => !workerFilter || String(wid) === workerFilter
  const invoiced = myInvoices.reduce((s, i) => s + num(i.total), 0)
  const paid = myInvoices.reduce((s, i) => s + num(i.paid_amount), 0)
  const unpaid = invoiced - paid
  const pending = myPayments.filter((p) => p.status === 'pending_verification').reduce((s, p) => s + num(p.amount), 0)
  const valueLeft = myLpos.filter((l) => ['approved', 'partially_fulfilled'].includes(l.status))
    .reduce((s, l) => s + num(l.remaining_value), 0)
  const rate = invoiced > 0 ? Math.round((paid / invoiced) * 100) : 0

  const now = new Date()
  const buckets = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-KE', { month: 'short' }), a: 0, b: 0 })
  }
  myInvoices.forEach((i) => {
    const x = buckets.find((m) => m.key === String(i.invoice_date).slice(0, 7))
    if (x) { x.a += num(i.total); x.b += num(i.paid_amount) }
  })

  const workerRows = myWorkers.map((w) => {
    const wInv = myInvoices.filter((i) => workerIdOfInvoice(i) === w.id)
    const inv = wInv.reduce((s, i) => s + num(i.total), 0)
    const pd = wInv.reduce((s, i) => s + num(i.paid_amount), 0)
    const wl = myLpos.filter((l) => l.worker_id === w.id)
    return {
      id: w.id, full_name: w.full_name, employee_no: w.employee_no,
      lpos: wl.length, orders: myOrders.filter((o) => o.worker_id === w.id).length,
      collected: wl.reduce((s, l) => s + (l.total_collected_qty ?? 0), 0),
      authorized: wl.reduce((s, l) => s + (l.total_authorized_qty ?? 0), 0),
      invoiced: inv, paid: pd, unpaid: inv - pd,
    }
  })
  const owedByWorker = workerRows.filter((r) => r.unpaid > 0).sort((a, b) => b.unpaid - a.unpaid).map((r) => ({ label: r.full_name, value: r.unpaid }))
  const invDonut = [
    { label: 'Not paid', value: myInvoices.filter((i) => i.status === 'unpaid').length, color: COLORS.red },
    { label: 'Part paid', value: myInvoices.filter((i) => i.status === 'partially_paid').length, color: COLORS.amber },
    { label: 'Fully paid', value: myInvoices.filter((i) => i.status === 'fully_paid').length, color: COLORS.green },
  ]

  const lpoRows = myLpos.map((l) => ({ ...l, worker: workerNames[l.worker_id] ?? '—' })).filter((l) => byWorker(l, l.worker_id))
  const invoiceRows = myInvoices
    .map((i) => ({ ...i, worker: workerOfInvoice(i), outstanding: outstandingOf(i) }))
    .filter((i) => !invFilter || i.status === invFilter)
    .filter((i) => byWorker(i, workerIdOfInvoice(i)))
  const paymentRows = myPayments.map((p) => ({ ...p, worker: workersOfPayment(p) }))
  const orderRows = myOrders.map((o) => ({ ...o, worker: workerNames[o.worker_id] ?? '—' })).filter((o) => byWorker(o, o.worker_id))

  const exportCsv = () =>
    downloadCsv(`world-vision-invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Invoice', 'Worker', 'LPO No.', 'Date', 'Total', 'Paid', 'Not paid', 'Status'],
      invoiceRows.map((i) => [i.internal_ref, i.worker, i.lpo_id ? lpoNos[i.lpo_id] ?? '' : '', i.invoice_date,
        num(i.total).toFixed(2), num(i.paid_amount).toFixed(2), i.outstanding.toFixed(2), i.status]))

  const viewBtn = (type) => (r) => (
    <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setView({ type, id: r.id }) }}><Eye size={14} /> View</button>
  )
  const vLpo = view?.type === 'lpo' ? myLpos.find((l) => l.id === view.id) : null
  const vInv = view?.type === 'invoice' ? myInvoices.find((i) => i.id === view.id) : null
  const vPay = view?.type === 'payment' ? myPayments.find((p) => p.id === view.id) : null
  const close = () => setView(null)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {[org.contact_person, org.phone, org.email].filter(Boolean).join(' · ') || 'Customer workspace'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="input max-w-[200px]" value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)}>
            <option value="">All workers</option>
            {myWorkers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
          </select>
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export invoices</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Receipt} label="Total invoiced" value={formatKES(invoiced)} />
        <Kpi icon={Banknote} tone="green" label="Paid (verified)" value={formatKES(paid)} sub={`${rate}% of invoiced`} />
        <Kpi icon={AlertTriangle} tone="red" label="Not paid" value={formatKES(unpaid)} />
        <Kpi icon={Hourglass} tone="amber" label="Paid, awaiting verification" value={formatKES(pending)} />
        <Kpi icon={FileText} label="LPOs" value={myLpos.length} sub={`${formatKES(valueLeft)} still to collect`} />
        <Kpi icon={FileText} label="Orders" value={myOrders.length} />
        <Kpi icon={Users} label="Workers" value={myWorkers.length} />
        <Kpi icon={FileText} label="LPO value authorized" value={formatKES(myLpos.reduce((s, l) => s + num(l.authorized_total), 0))} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Invoiced vs paid per month" className="lg:col-span-2"
          action={
            <select className="input max-w-[130px]" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={3}>Last 3 months</option><option value={6}>Last 6 months</option><option value={12}>Last 12 months</option>
            </select>
          }>
          <AreaChart data={buckets} height={210} series={[{ key: 'a', label: 'Invoiced', color: COLORS.brand }, { key: 'b', label: 'Paid', color: COLORS.green }]} />
        </Card>
        <Card title="Invoices by status"><Donut centerLabel="invoices" segments={invDonut} /></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Who owes what (by worker)"><MoneyBars rows={owedByWorker} color={COLORS.red} empty="No unpaid invoices." /></Card>
        <Card title="Per worker: paid and not paid">
          <DataTable rows={workerRows} emptyMessage="No workers registered."
            columns={[
              { key: 'full_name', header: 'Worker', sortable: true },
              { key: 'invoiced', header: 'Invoiced', render: (r) => formatKES(r.invoiced) },
              { key: 'paid', header: 'Paid', render: (r) => <span className="text-green-600">{formatKES(r.paid)}</span> },
              { key: 'unpaid', header: 'Not paid', render: (r) => <span className={r.unpaid > 0 ? 'text-red-500' : ''}>{formatKES(r.unpaid)}</span> },
            ]} />
        </Card>
      </div>

      <section>
        <h2 className="font-semibold mb-2">LPOs and their workers</h2>
        <DataTable rows={lpoRows} emptyMessage="No LPOs for this customer." onRowClick={(r) => setView({ type: 'lpo', id: r.id })}
          columns={[
            { key: 'customer_lpo_no', header: 'LPO No.', sortable: true },
            { key: 'worker', header: 'Worker', sortable: true, render: (r) => <span className="font-medium">{r.worker}</span> },
            { key: 'issue_date', header: 'Issued', render: (r) => formatDate(r.issue_date) },
            { key: 'authorized_total', header: 'Authorized', render: (r) => formatKES(r.authorized_total) },
            { key: 'progress', header: 'Collected', render: (r) => <Progress done={r.total_collected_qty ?? 0} total={r.total_authorized_qty ?? 0} /> },
            { key: 'remaining_value', header: 'Value left', render: (r) => formatKES(r.remaining_value) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'view', header: '', render: viewBtn('lpo') },
          ]} />
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="font-semibold">Invoices</h2>
          <select className="input max-w-[200px]" value={invFilter} onChange={(e) => setInvFilter(e.target.value)}>
            <option value="">All invoices</option><option value="unpaid">Not paid</option>
            <option value="partially_paid">Partially paid</option><option value="fully_paid">Fully paid</option>
          </select>
        </div>
        <DataTable rows={invoiceRows} emptyMessage="No invoices match." onRowClick={(r) => setView({ type: 'invoice', id: r.id })}
          columns={[
            { key: 'internal_ref', header: 'Invoice', sortable: true },
            { key: 'worker', header: 'Worker', sortable: true },
            { key: 'lpo_id', header: 'LPO No.', render: (r) => (r.lpo_id ? lpoNos[r.lpo_id] ?? r.lpo_id : '—') },
            { key: 'invoice_date', header: 'Date', render: (r) => formatDate(r.invoice_date) },
            { key: 'total', header: 'Total', render: (r) => formatKES(r.total) },
            { key: 'paid_amount', header: 'Paid', render: (r) => <span className="text-green-600">{formatKES(r.paid_amount)}</span> },
            { key: 'outstanding', header: 'Not paid', sortable: true, render: (r) => <span className={r.outstanding > 0 ? 'text-red-500' : ''}>{formatKES(r.outstanding)}</span> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'view', header: '', render: viewBtn('invoice') },
          ]} />
      </section>

      <section>
        <h2 className="font-semibold mb-2">Payments</h2>
        {!hasPermission('payment.record') ? (
          <p className="text-sm text-slate-500">You don't have permission to view payments.</p>
        ) : (
          <DataTable rows={paymentRows} emptyMessage="No payments recorded for this customer." onRowClick={(r) => setView({ type: 'payment', id: r.id })}
            columns={[
              { key: 'internal_ref', header: 'Payment', sortable: true },
              { key: 'worker', header: 'Worker' },
              { key: 'payment_date', header: 'Date', render: (r) => formatDate(r.payment_date) },
              { key: 'method', header: 'Method', render: (r) => r.method.replaceAll('_', ' ') },
              { key: 'transaction_ref', header: 'Transaction Ref' },
              { key: 'amount', header: 'Amount', render: (r) => formatKES(r.amount) },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'view', header: '', render: viewBtn('payment') },
            ]} />
        )}
      </section>

      <section>
        <h2 className="font-semibold mb-2">Orders</h2>
        <DataTable rows={orderRows} emptyMessage="No orders for this customer."
          columns={[
            { key: 'internal_ref', header: 'Order', sortable: true },
            { key: 'worker', header: 'Worker', sortable: true },
            { key: 'lpo_id', header: 'LPO No.', render: (r) => (r.lpo_id ? lpoNos[r.lpo_id] ?? r.lpo_id : '—') },
            { key: 'total', header: 'Total', render: (r) => formatKES(r.total) },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />
      </section>

      {vLpo && (
        <DetailPanel title={`LPO ${vLpo.customer_lpo_no}`} subtitle={`${org.name} — ${workerNames[vLpo.worker_id] ?? 'no worker'} (${vLpo.internal_ref})`} onClose={close}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{org.name}</Field>
            <Field label="Worker (owner)">{workerNames[vLpo.worker_id]}</Field>
            <Field label="Status"><StatusBadge status={vLpo.status} /></Field>
            <Field label="Issued">{formatDate(vLpo.issue_date)}</Field>
            <Field label="Expires">{formatDate(vLpo.expiry_date)}</Field>
            <Field label="Authorized">{formatKES(vLpo.authorized_total)}</Field>
            <Field label="Value left to collect">{formatKES(vLpo.remaining_value)}</Field>
            <Field label="Units left">{`${vLpo.total_remaining_qty ?? 0} of ${vLpo.total_authorized_qty ?? 0}`}</Field>
          </div>
          <DataTable rowKey="id" rows={vLpo.items}
            columns={[
              { key: 'product_id', header: 'Product', render: (r) => productNames[r.product_id] ?? r.product_id },
              { key: 'authorized_qty', header: 'Authorized' }, { key: 'ordered_qty', header: 'Ordered' },
              { key: 'collected_qty', header: 'Collected' }, { key: 'remaining_qty', header: 'Left' },
              { key: 'unit_price', header: 'Unit price', render: (r) => formatKES(r.unit_price) },
            ]} />
          <div>
            <h3 className="font-semibold mb-2">Invoices on this LPO</h3>
            <DataTable rows={myInvoices.filter((i) => i.lpo_id === vLpo.id)} emptyMessage="No invoices raised on this LPO yet."
              columns={[
                { key: 'internal_ref', header: 'Invoice' },
                { key: 'total', header: 'Total', render: (r) => formatKES(r.total) },
                { key: 'paid_amount', header: 'Paid', render: (r) => formatKES(r.paid_amount) },
                { key: 'outstanding', header: 'Not paid', render: (r) => formatKES(outstandingOf(r)) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
          </div>
        </DetailPanel>
      )}

      {vInv && (
        <DetailPanel title={`Invoice ${vInv.internal_ref}`} subtitle={`${org.name} — ${workerOfInvoice(vInv)}`} onClose={close}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{org.name}</Field>
            <Field label="Worker">{workerOfInvoice(vInv)}</Field>
            <Field label="Status"><StatusBadge status={vInv.status} /></Field>
            <Field label="Invoice date">{formatDate(vInv.invoice_date)}</Field>
            <Field label="Due date">{formatDate(vInv.due_date)}</Field>
            <Field label="Order">{vInv.order_id ? orderRefs[vInv.order_id] ?? `#${vInv.order_id}` : null}</Field>
            <Field label="LPO No.">{vInv.lpo_id ? lpoNos[vInv.lpo_id] ?? `#${vInv.lpo_id}` : null}</Field>
          </div>
          <DataTable rowKey="_n" rows={vInv.items.map((i, n) => ({ ...i, _n: n }))}
            columns={[
              { key: 'product_id', header: 'Product', render: (r) => productNames[r.product_id] ?? r.product_id },
              { key: 'quantity', header: 'Qty' },
              { key: 'unit_price', header: 'Unit price', render: (r) => formatKES(r.unit_price) },
              { key: 'line_total', header: 'Line total', render: (r) => formatKES(r.line_total) },
            ]} />
          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatKES(vInv.subtotal)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>{formatKES(vInv.tax_amount)}</span></div>
            <div className="flex justify-between font-semibold border-t pt-1"><span>Total</span><span>{formatKES(vInv.total)}</span></div>
            <div className="flex justify-between text-green-600"><span>Paid</span><span>{formatKES(vInv.paid_amount)}</span></div>
            <div className="flex justify-between font-semibold text-red-500"><span>Not paid</span><span>{formatKES(outstandingOf(vInv))}</span></div>
          </div>
          {hasPermission('payment.record') && (
            <div>
              <h3 className="font-semibold mb-2">Payments applied</h3>
              <DataTable emptyMessage="No payments recorded against this invoice."
                rows={myPayments.filter((p) => p.allocations.some((a) => a.invoice_id === vInv.id))
                  .map((p) => ({ ...p, applied: p.allocations.filter((a) => a.invoice_id === vInv.id).reduce((s, a) => s + num(a.amount), 0) }))}
                columns={[
                  { key: 'internal_ref', header: 'Payment' },
                  { key: 'payment_date', header: 'Date', render: (r) => formatDate(r.payment_date) },
                  { key: 'transaction_ref', header: 'Transaction Ref' },
                  { key: 'applied', header: 'Applied', render: (r) => formatKES(r.applied) },
                  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]} />
            </div>
          )}
        </DetailPanel>
      )}

      {vPay && (
        <DetailPanel title={`Payment ${vPay.internal_ref}`} subtitle={`${org.name} — ${workersOfPayment(vPay)}`} onClose={close}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Customer">{org.name}</Field>
            <Field label="Worker">{workersOfPayment(vPay)}</Field>
            <Field label="Status"><StatusBadge status={vPay.status} /></Field>
            <Field label="Date">{formatDate(vPay.payment_date)}</Field>
            <Field label="Method"><span className="capitalize">{vPay.method.replaceAll('_', ' ')}</span></Field>
            <Field label="Transaction ref">{vPay.transaction_ref}</Field>
            <Field label="Amount">{formatKES(vPay.amount)}</Field>
          </div>
          <DataTable rowKey="invoice_id" rows={vPay.allocations} emptyMessage="No allocations."
            columns={[
              { key: 'invoice_id', header: 'Invoice', render: (r) => invoiceRefs[r.invoice_id] ?? r.invoice_id },
              { key: 'amount', header: 'Amount applied', render: (r) => formatKES(r.amount) },
            ]} />
          {vPay.status === 'pending_verification' && <p className="text-sm text-amber-600">Awaiting verification. Invoice balances don't change until it is verified.</p>}
        </DetailPanel>
      )}
    </div>
  )
}