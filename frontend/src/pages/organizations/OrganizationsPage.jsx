import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Eye, Download, Building2, Users, Receipt, AlertTriangle } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import StatusBadge from '../../components/common/StatusBadge'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import { Donut, COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import {
  useOrganizations, useLpos, useOrders, useWorkers, useInvoices, apiError,
} from '../../hooks/useLookups'

const TYPES = ['NGO', 'Government', 'Company', 'School', 'Hospital', 'Hotel', 'Restaurant', 'Retailer', 'Wholesaler', 'Individual', 'Other']
const PALETTE = [COLORS.brand, COLORS.green, COLORS.amber, COLORS.red, COLORS.slate, '#6366f1', '#14b8a6', '#f97316']
const EMPTY = {
  name: '', org_type: 'NGO', registration_no: '', contact_person: '', phone: '', email: '',
  physical_address: '', billing_address: '', delivery_address: '', notes: '',
}
const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)

export default function OrganizationsPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const { data: orgs, isLoading } = useOrganizations()
  const { data: lpos } = useLpos()
  const { data: orders } = useOrders()
  const { data: workers } = useWorkers()
  const { data: invoices } = useInvoices()
  const { register, handleSubmit, reset } = useForm({ defaultValues: EMPTY })

  const mutation = useMutation({
    mutationFn: (payload) => api.post('/organizations', payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['organizations'] })
      setShowForm(false); reset(EMPTY); setError('')
      setNotice(`${res.data?.name ?? 'Organization'} added.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to save organization')) },
  })

  const rows = useMemo(() => (orgs ?? []).map((o) => {
    const inv = (invoices ?? []).filter((i) => i.organization_id === o.id)
    const invoiced = inv.reduce((s, i) => s + num(i.total), 0)
    const paid = inv.reduce((s, i) => s + num(i.paid_amount), 0)
    return {
      ...o,
      lpoCount: (lpos ?? []).filter((l) => l.organization_id === o.id).length,
      workerCount: (workers ?? []).filter((w) => w.organization_id === o.id).length,
      orderCount: (orders ?? []).filter((x) => x.organization_id === o.id).length,
      invoiced, paid, owed: invoiced - paid,
    }
  }), [orgs, lpos, workers, orders, invoices])

  const filtered = rows
    .filter((o) => !typeFilter || o.org_type === typeFilter)
    .filter((o) => {
      const q = search.trim().toLowerCase()
      return !q || [o.name, o.contact_person, o.email, o.phone, o.registration_no].some((x) => String(x ?? '').toLowerCase().includes(q))
    })

  const typeCounts = Object.entries(filtered.reduce((m, o) => ({ ...m, [o.org_type]: (m[o.org_type] ?? 0) + 1 }), {}))
    .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }))
  const topInvoiced = filtered.filter((o) => o.invoiced > 0).sort((a, b) => b.invoiced - a.invoiced).slice(0, 5)
    .map((o) => ({ label: o.name, value: o.invoiced }))
  const topOwing = filtered.filter((o) => o.owed > 0).sort((a, b) => b.owed - a.owed).slice(0, 5)
    .map((o) => ({ label: o.name, value: o.owed }))

  const totalOwed = filtered.reduce((s, o) => s + o.owed, 0)
  const onSubmit = (v) => mutation.mutate(Object.fromEntries(
    Object.entries(v).map(([k, val]) => [k, typeof val === 'string' ? (val.trim() === '' && k !== 'name' && k !== 'org_type' ? null : val.trim()) : val]),
  ))

  const exportCsv = () =>
    downloadCsv(`customers-${iso(new Date())}.csv`,
      ['Name', 'Type', 'Contact', 'Phone', 'Email', 'LPOs', 'Workers', 'Orders', 'Invoiced', 'Paid', 'Owed', 'Status'],
      filtered.map((o) => [o.name, o.org_type, o.contact_person ?? '', o.phone ?? '', o.email ?? '', o.lpoCount, o.workerCount,
        o.orderCount, o.invoiced.toFixed(2), o.paid.toFixed(2), o.owed.toFixed(2), o.status]))

  const columns = [
    { key: 'name', header: 'Customer', sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'org_type', header: 'Type', sortable: true },
    { key: 'contact_person', header: 'Contact' },
    { key: 'phone', header: 'Phone' },
    { key: 'workerCount', header: 'Workers', sortable: true },
    { key: 'lpoCount', header: 'LPOs', sortable: true },
    { key: 'invoiced', header: 'Invoiced', sortable: true, render: (r) => formatKES(r.invoiced) },
    { key: 'owed', header: 'Owes', sortable: true, render: (r) => <span className={r.owed > 0 ? 'text-red-500 font-medium' : ''}>{formatKES(r.owed)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'view', header: '', render: (r) => <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}><Eye size={14} /> View</button> },
  ]

  const sel = rows.find((o) => o.id === selectedId)
  const selWorkers = sel ? (workers ?? []).filter((w) => w.organization_id === sel.id) : []
  const selLpos = sel ? (lpos ?? []).filter((l) => l.organization_id === sel.id) : []
  const selInvoices = sel ? (invoices ?? []).filter((i) => i.organization_id === sel.id) : []
  const workerNames = Object.fromEntries((workers ?? []).map((w) => [w.id, w.full_name]))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Organizations you supply: NGOs, government, companies, schools, hospitals and more.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('organization.create') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New Organization
            </button>
          )}
        </div>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{error}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="label">Name *</label><input className="input" {...register('name', { required: true })} /></div>
          <div>
            <label className="label">Type</label>
            <select className="input" {...register('org_type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div><label className="label">Registration No.</label><input className="input" {...register('registration_no')} /></div>
          <div><label className="label">Contact person</label><input className="input" {...register('contact_person')} /></div>
          <div><label className="label">Phone</label><input className="input" {...register('phone')} /></div>
          <div><label className="label">Email</label><input type="email" className="input" {...register('email')} /></div>
          <div><label className="label">Physical address</label><input className="input" {...register('physical_address')} /></div>
          <div><label className="label">Billing address</label><input className="input" {...register('billing_address')} /></div>
          <div><label className="label">Delivery address</label><input className="input" {...register('delivery_address')} /></div>
          <div className="md:col-span-3"><label className="label">Notes</label><input className="input" {...register('notes')} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={mutation.isPending} className="btn-primary">{mutation.isPending ? 'Saving…' : 'Save Organization'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name, contact, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[180px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={Building2} label="Customers" value={filtered.length} />
        <Kpi icon={Users} label="Workers registered" value={filtered.reduce((s, o) => s + o.workerCount, 0)} />
        <Kpi icon={Receipt} tone="green" label="Total invoiced" value={formatKES(filtered.reduce((s, o) => s + o.invoiced, 0))} />
        <Kpi icon={AlertTriangle} tone="red" label="Owed to you" value={formatKES(totalOwed)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Customers by type"><Donut centerLabel="customers" segments={typeCounts} /></Card>
        <Card title="Top customers by invoiced"><MoneyBars rows={topInvoiced} color={COLORS.brand} empty="No invoices yet." /></Card>
        <Card title="Who owes the most"><MoneyBars rows={topOwing} color={COLORS.red} empty="Nobody owes anything." /></Card>
      </div>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable columns={columns} rows={filtered} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No organizations match." />
      )}

      {sel && (
        <DetailPanel title={sel.name} subtitle={`${sel.org_type}${sel.registration_no ? ` · Reg ${sel.registration_no}` : ''}`} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Contact person">{sel.contact_person}</Field>
            <Field label="Phone">{sel.phone}</Field>
            <Field label="Email">{sel.email}</Field>
            <Field label="Status"><StatusBadge status={sel.status} /></Field>
            <Field label="Physical address">{sel.physical_address}</Field>
            <Field label="Billing address">{sel.billing_address}</Field>
            <Field label="Delivery address">{sel.delivery_address}</Field>
            <Field label="Notes">{sel.notes}</Field>
            <Field label="Invoiced">{formatKES(sel.invoiced)}</Field>
            <Field label="Paid"><span className="text-green-600">{formatKES(sel.paid)}</span></Field>
            <Field label="Owes"><span className={sel.owed > 0 ? 'text-red-500 font-semibold' : ''}>{formatKES(sel.owed)}</span></Field>
            <Field label="Orders">{sel.orderCount}</Field>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Workers</h3>
            <DataTable rows={selWorkers} emptyMessage="No workers."
              columns={[
                { key: 'full_name', header: 'Name' }, { key: 'employee_no', header: 'Employee No.' },
                { key: 'collection_authorized', header: 'Can collect', render: (r) => (r.collection_authorized ? 'Yes' : 'No') },
                { key: 'auth_expiry_date', header: 'Authorization expires', render: (r) => formatDate(r.auth_expiry_date) },
              ]} />
          </div>
          <div>
            <h3 className="font-semibold mb-2">LPOs</h3>
            <DataTable rows={selLpos} emptyMessage="No LPOs."
              columns={[
                { key: 'customer_lpo_no', header: 'LPO No.' },
                { key: 'worker_id', header: 'Worker', render: (r) => workerNames[r.worker_id] ?? '—' },
                { key: 'authorized_total', header: 'Authorized', render: (r) => formatKES(r.authorized_total) },
                { key: 'remaining_value', header: 'Value left', render: (r) => formatKES(r.remaining_value) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
          </div>
          <div>
            <h3 className="font-semibold mb-2">Invoices</h3>
            <DataTable rows={selInvoices} emptyMessage="No invoices."
              columns={[
                { key: 'internal_ref', header: 'Invoice' },
                { key: 'invoice_date', header: 'Date', render: (r) => formatDate(r.invoice_date) },
                { key: 'total', header: 'Total', render: (r) => formatKES(r.total) },
                { key: 'paid_amount', header: 'Paid', render: (r) => formatKES(r.paid_amount) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
          </div>
        </DetailPanel>
      )}
    </div>
  )
}