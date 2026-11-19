import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import Tabs from '../../components/common/Tabs'
import AreaChart from '../../components/common/AreaChart'
import { COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES } from '../../utils/format'
import { useOrganizations, useProducts, useWorkers, nameMap } from '../../hooks/useLookups'
import { Wallet, Banknote, AlertTriangle, FileText, Boxes, ClipboardList, TrendingUp } from 'lucide-react'

const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)

function useGuard(key, url, allowed, params) {
  return useQuery({ queryKey: key, queryFn: async () => (await api.get(url, params ? { params } : undefined)).data, enabled: !!allowed })
}
const group = (list, keyFn, init, add) => {
  const m = {}
  for (const x of list) { const k = keyFn(x); if (!m[k]) m[k] = { id: k, label: k, ...init() }; add(m[k], x) }
  return Object.values(m)
}

export default function ReportsPage() {
  const { hasPermission: can } = useAuth()
  const [tab, setTab] = useState('sales')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const inRange = (d) => { const s = String(d ?? '').slice(0, 10); return s && (!from || s >= from) && (!to || s <= to) }

  const { data: orgs } = useOrganizations()
  const { data: products } = useProducts()
  const { data: workers } = useWorkers()
  const { data: invoicesRaw } = useGuard(['invoices'], '/invoices', can('invoice.create'))
  const { data: lposRaw } = useGuard(['lpos'], '/lpos', can('lpo.create'))
  const { data: stockRaw } = useGuard(['stock-levels'], '/products/stock-levels', can('inventory.receive'))
  const { data: payablesRaw } = useGuard(['payables'], '/payables', can('payment.record'))
  const { data: acctsRaw } = useGuard(['accounting-accounts', from, to], '/accounting/accounts', can('report.export'),
    { ...(from && { date_from: from }), ...(to && { date_to: to }) })

  const orgNames = nameMap(orgs), productNames = nameMap(products), workerNames = nameMap(workers, 'full_name')
  const NoAccess = () => <div className="card p-6 text-sm text-slate-500">Your role cannot view the data for this report.</div>

  // ---- Sales
  const invoices = useMemo(() => (invoicesRaw ?? []).filter((i) => inRange(i.invoice_date)), [invoicesRaw, from, to]) // eslint-disable-line
  const salesByCustomer = group(invoices, (i) => orgNames[i.organization_id] ?? `Customer ${i.organization_id}`,
    () => ({ count: 0, invoiced: 0, paid: 0 }), (r, i) => { r.count++; r.invoiced += num(i.total); r.paid += num(i.paid_amount) })
    .map((r) => ({ ...r, owed: r.invoiced - r.paid })).sort((a, b) => b.invoiced - a.invoiced)
  const salesByProduct = group(invoices.flatMap((i) => i.items), (it) => productNames[it.product_id] ?? `Product ${it.product_id}`,
    () => ({ qty: 0, value: 0 }), (r, it) => { r.qty += num(it.quantity); r.value += num(it.line_total) }).sort((a, b) => b.value - a.value)
  const salesByMonth = group(invoices, (i) => String(i.invoice_date).slice(0, 7), () => ({ a: 0, b: 0 }),
    (r, i) => { r.a += num(i.total); r.b += num(i.paid_amount) }).sort((a, b) => a.label.localeCompare(b.label))
  const invoicedTotal = invoices.reduce((s, i) => s + num(i.total), 0)
  const paidTotal = invoices.reduce((s, i) => s + num(i.paid_amount), 0)

  // ---- LPOs
  const lpos = (lposRaw ?? []).filter((l) => !from && !to ? true : inRange(l.issue_date)).map((l) => ({
    ...l, id: l.id, customer: orgNames[l.organization_id] ?? '…', worker: workerNames[l.worker_id] ?? '—',
    pct: l.total_authorized_qty ? Math.round((l.total_collected_qty / l.total_authorized_qty) * 100) : 0,
  }))

  // ---- Stock
  const stock = (stockRaw ?? []).map((s) => ({ ...s, id: s.product_id, cost: num(s.purchase_price), value: s.available * num(s.purchase_price), retail: s.available * num(s.selling_price) }))
  const stockValue = stock.reduce((s, r) => s + r.value, 0)

  // ---- Procurement
  const pos = (payablesRaw ?? []).filter((p) => inRange(p.order_date))
  const bySupplier = group(pos, (p) => p.supplier, () => ({ count: 0, ordered: 0, received: 0, paid: 0 }),
    (r, p) => { r.count++; r.ordered += num(p.total); r.received += num(p.received_value); r.paid += num(p.paid) })
    .map((r) => ({ ...r, owed: r.received - r.paid })).sort((a, b) => b.ordered - a.ordered)

  // ---- P&L
  const accts = (acctsRaw ?? []).map((a) => ({ ...a, bal: num(a.balance) }))
  const rev = accts.filter((a) => a.account_type === 'revenue'), exp = accts.filter((a) => a.account_type === 'expense')
  const revTotal = rev.reduce((s, a) => s + a.bal, 0), expTotal = exp.reduce((s, a) => s + a.bal, 0)

  const exports = {
    sales: () => ['sales-by-customer', ['Customer', 'Invoices', 'Invoiced', 'Paid', 'Owed'], salesByCustomer.map((r) => [r.label, r.count, r.invoiced.toFixed(2), r.paid.toFixed(2), r.owed.toFixed(2)])],
    lpo: () => ['lpo-utilisation', ['Customer', 'Worker', 'LPO', 'Authorized units', 'Collected units', 'Utilisation %', 'Value left', 'Status'],
      lpos.map((l) => [l.customer, l.worker, l.customer_lpo_no, l.total_authorized_qty, l.total_collected_qty, l.pct, num(l.remaining_value).toFixed(2), l.status])],
    stock: () => ['stock-valuation', ['Product', 'SKU', 'In stock', 'Cost', 'Value at cost', 'Value at selling price'],
      stock.map((s) => [s.name, s.sku, s.available, s.cost.toFixed(2), s.value.toFixed(2), s.retail.toFixed(2)])],
    procurement: () => ['procurement', ['Supplier', 'POs', 'Ordered', 'Received', 'Paid', 'Owed'], bySupplier.map((r) => [r.label, r.count, r.ordered.toFixed(2), r.received.toFixed(2), r.paid.toFixed(2), r.owed.toFixed(2)])],
    pnl: () => ['profit-and-loss', ['Code', 'Account', 'Type', 'Amount'], [...rev, ...exp].map((a) => [a.code, a.name, a.account_type, a.bal.toFixed(2)])],
  }
  const doExport = () => { const [n, h, l] = exports[tab](); downloadCsv(`${n}-${iso(new Date())}.csv`, h, l) }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports & Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Pick a report, set a date range, then export to CSV or print.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={doExport}><Download size={16} /> Export CSV</button>
          <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print</button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 no-print">
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {(from || to) && <button className="btn-secondary" onClick={() => { setFrom(''); setTo('') }}>Clear dates</button>}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'sales', label: 'Sales' }, { key: 'lpo', label: 'LPO utilisation' }, { key: 'stock', label: 'Stock valuation' },
        { key: 'procurement', label: 'Procurement' }, { key: 'pnl', label: 'Profit & loss' },
      ]} />

      <div className="print-area space-y-4">
        {tab === 'sales' && (!can('invoice.create') ? <NoAccess /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi icon={FileText} label="Invoices" value={invoices.length} />
              <Kpi icon={Wallet} label="Invoiced" value={formatKES(invoicedTotal)} />
              <Kpi icon={Banknote} tone="green" label="Paid" value={formatKES(paidTotal)} />
              <Kpi icon={AlertTriangle} tone="red" label="Not paid" value={formatKES(invoicedTotal - paidTotal)} />
            </div>
            <Card title="Invoiced vs paid by month">
              <AreaChart data={salesByMonth.map((m) => ({ label: m.label, a: m.a, b: m.b }))} height={200}
                series={[{ key: 'a', label: 'Invoiced', color: COLORS.brand }, { key: 'b', label: 'Paid', color: COLORS.green }]} />
            </Card>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div><h2 className="font-semibold mb-2">By customer</h2>
                <DataTable rows={salesByCustomer} emptyMessage="No invoices in this period."
                  columns={[{ key: 'label', header: 'Customer', sortable: true }, { key: 'count', header: 'Invoices' },
                    { key: 'invoiced', header: 'Invoiced', sortable: true, render: (r) => formatKES(r.invoiced) },
                    { key: 'paid', header: 'Paid', render: (r) => formatKES(r.paid) },
                    { key: 'owed', header: 'Owed', render: (r) => <span className={r.owed > 0.004 ? 'text-red-500' : ''}>{formatKES(r.owed)}</span> }]} /></div>
              <div><h2 className="font-semibold mb-2">By product</h2>
                <DataTable rows={salesByProduct} emptyMessage="No sales in this period."
                  columns={[{ key: 'label', header: 'Product', sortable: true }, { key: 'qty', header: 'Units', sortable: true },
                    { key: 'value', header: 'Sales value', sortable: true, render: (r) => formatKES(r.value) }]} /></div>
            </div>
          </>
        ))}

        {tab === 'lpo' && (!can('lpo.create') ? <NoAccess /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi icon={FileText} label="LPOs" value={lpos.length} />
              <Kpi icon={Wallet} label="Authorized value" value={formatKES(lpos.reduce((s, l) => s + num(l.authorized_total), 0))} />
              <Kpi icon={Boxes} tone="amber" label="Value still to collect" value={formatKES(lpos.filter((l) => ['approved', 'partially_fulfilled'].includes(l.status)).reduce((s, l) => s + num(l.remaining_value), 0))} />
              <Kpi icon={TrendingUp} tone="green" label="Exhausted" value={lpos.filter((l) => l.status === 'fully_fulfilled').length} />
            </div>
            <DataTable rows={lpos} emptyMessage="No LPOs in this period."
              columns={[
                { key: 'customer', header: 'Customer', sortable: true }, { key: 'worker', header: 'Worker', sortable: true },
                { key: 'customer_lpo_no', header: 'LPO No.', sortable: true },
                { key: 'total_authorized_qty', header: 'Authorized units' }, { key: 'total_collected_qty', header: 'Collected units' },
                { key: 'pct', header: 'Used', sortable: true, render: (r) => (
                  <div className="w-28"><div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden"><div className="h-2 bg-brand-500" style={{ width: `${r.pct}%` }} /></div><div className="text-[10px] text-slate-500">{r.pct}%</div></div>) },
                { key: 'remaining_value', header: 'Value left', render: (r) => formatKES(r.remaining_value) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
          </>
        ))}

        {tab === 'stock' && (!can('inventory.receive') ? <NoAccess /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi icon={Boxes} label="Products" value={stock.length} />
              <Kpi icon={Boxes} label="Units in stock" value={stock.reduce((s, r) => s + r.available, 0)} />
              <Kpi icon={Wallet} tone="green" label="Value at cost" value={formatKES(stockValue)} />
              <Kpi icon={Wallet} label="Value at selling price" value={formatKES(stock.reduce((s, r) => s + r.retail, 0))} />
            </div>
            <DataTable rows={stock} rowKey="product_id" emptyMessage="No products."
              columns={[
                { key: 'name', header: 'Product', sortable: true }, { key: 'sku', header: 'SKU' },
                { key: 'available', header: 'In stock', sortable: true },
                { key: 'cost', header: 'Cost price', render: (r) => formatKES(r.cost) },
                { key: 'value', header: 'Value at cost', sortable: true, render: (r) => formatKES(r.value) },
                { key: 'retail', header: 'Value at selling price', render: (r) => formatKES(r.retail) },
              ]} />
          </>
        ))}

        {tab === 'procurement' && (!can('payment.record') ? <NoAccess /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi icon={ClipboardList} label="Purchase orders" value={pos.length} />
              <Kpi icon={Wallet} label="Ordered" value={formatKES(bySupplier.reduce((s, r) => s + r.ordered, 0))} />
              <Kpi icon={Boxes} tone="green" label="Received" value={formatKES(bySupplier.reduce((s, r) => s + r.received, 0))} />
              <Kpi icon={AlertTriangle} tone="red" label="Still owed" value={formatKES(bySupplier.reduce((s, r) => s + r.owed, 0))} />
            </div>
            <Card title="Spend by supplier"><MoneyBars rows={bySupplier.slice(0, 6).map((r) => ({ label: r.label, value: r.ordered }))} color={COLORS.amber} empty="No purchase orders in this period." /></Card>
            <DataTable rows={bySupplier} emptyMessage="No purchase orders in this period."
              columns={[
                { key: 'label', header: 'Supplier', sortable: true }, { key: 'count', header: 'POs' },
                { key: 'ordered', header: 'Ordered', render: (r) => formatKES(r.ordered) },
                { key: 'received', header: 'Received', render: (r) => formatKES(r.received) },
                { key: 'paid', header: 'Paid', render: (r) => formatKES(r.paid) },
                { key: 'owed', header: 'Owed', render: (r) => <span className={r.owed > 0.004 ? 'text-red-500' : ''}>{formatKES(r.owed)}</span> },
              ]} />
          </>
        ))}

        {tab === 'pnl' && (!can('report.export') ? <NoAccess /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <Kpi icon={TrendingUp} tone="green" label="Revenue" value={formatKES(revTotal)} />
              <Kpi icon={Wallet} tone="red" label="Expenses" value={formatKES(expTotal)} />
              <Kpi icon={TrendingUp} tone={revTotal - expTotal >= 0 ? 'green' : 'red'} label="Net profit" value={formatKES(revTotal - expTotal)} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div><h2 className="font-semibold mb-2">Revenue</h2><DataTable rows={rev} emptyMessage="No revenue recorded."
                columns={[{ key: 'code', header: 'Code' }, { key: 'name', header: 'Account' }, { key: 'bal', header: 'Amount', render: (r) => formatKES(r.bal) }]} /></div>
              <div><h2 className="font-semibold mb-2">Expenses</h2><DataTable rows={exp} emptyMessage="No expenses recorded."
                columns={[{ key: 'code', header: 'Code' }, { key: 'name', header: 'Account' }, { key: 'bal', header: 'Amount', render: (r) => formatKES(r.bal) }]} /></div>
            </div>
            <p className="text-xs text-slate-500">Profit is taken from the ledger. Cost of goods sold is not posted automatically yet, so profit is shown before cost of goods.</p>
          </>
        ))}
      </div>
    </div>
  )
}