import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus, Eye, Download, Truck, CheckCircle2, Clock } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import { Donut, HBars, COLORS } from '../../components/common/Charts'
import { Kpi, Card, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { apiError } from '../../hooks/useLookups'

const EMPTY = { name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '' }
const orNull = (v) => (v === '' || v === undefined ? null : v)
const PALETTE = [COLORS.brand, COLORS.green, COLORS.amber, COLORS.red, COLORS.slate, '#6366f1']

export default function SuppliersPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [search, setSearch] = useState('')

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  })
  const { register, handleSubmit, reset } = useForm({ defaultValues: EMPTY })

  const mutation = useMutation({
    mutationFn: (p) => api.post('/suppliers', p),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      setShowForm(false); reset(EMPTY); setError(''); setNotice(`${res.data?.name ?? 'Supplier'} added.`)
    },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to save supplier')) },
  })

  const onSubmit = (v) =>
    mutation.mutate({
      name: v.name.trim(), contact_person: orNull(v.contact_person), phone: orNull(v.phone),
      email: orNull(v.email), address: orNull(v.address), payment_terms: orNull(v.payment_terms),
    })

  const all = data ?? []
  const filtered = useMemo(() => all.filter((s) => {
    const q = search.trim().toLowerCase()
    return !q || [s.name, s.contact_person, s.phone, s.email, s.payment_terms].some((x) => String(x ?? '').toLowerCase().includes(q))
  }), [all, search])

  const terms = Object.entries(filtered.reduce((m, s) => ({ ...m, [s.payment_terms || 'Not set']: (m[s.payment_terms || 'Not set'] ?? 0) + 1 }), {}))
    .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }))
  const status = [
    { label: 'Active', value: filtered.filter((s) => s.status === 'active').length, color: COLORS.green },
    { label: 'Inactive', value: filtered.filter((s) => s.status !== 'active').length, color: COLORS.slate },
  ]

  const exportCsv = () =>
    downloadCsv(`suppliers-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Contact', 'Phone', 'Email', 'Payment terms', 'Address', 'Status'],
      filtered.map((s) => [s.name, s.contact_person ?? '', s.phone ?? '', s.email ?? '', s.payment_terms ?? '', s.address ?? '', s.status]))

  const sel = all.find((s) => s.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Suppliers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Vendors you buy goods from.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
          {hasPermission('inventory.receive') && (
            <button className="btn-primary" onClick={() => { setShowForm((s) => !s); setError(''); setNotice('') }}>
              <Plus size={16} /> New Supplier
            </button>
          )}
        </div>
      </div>

      {(error || loadError) && <div className="card p-3 text-sm text-red-500">{error || apiError(loadError)}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="label">Name *</label><input className="input" {...register('name', { required: true })} /></div>
          <div><label className="label">Contact person</label><input className="input" {...register('contact_person')} /></div>
          <div><label className="label">Phone</label><input className="input" {...register('phone')} /></div>
          <div><label className="label">Email</label><input type="email" className="input" {...register('email')} /></div>
          <div><label className="label">Payment terms</label><input className="input" placeholder="e.g. 30 days" {...register('payment_terms')} /></div>
          <div><label className="label">Address</label><input className="input" {...register('address')} /></div>
          <div className="md:col-span-3 flex gap-2">
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save Supplier'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <input className="input max-w-xs" placeholder="Search name, contact, terms…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Kpi icon={Truck} label="Suppliers" value={filtered.length} />
        <Kpi icon={CheckCircle2} tone="green" label="Active" value={status[0].value} />
        <Kpi icon={Clock} tone="amber" label="Without payment terms" value={filtered.filter((s) => !s.payment_terms).length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Suppliers by status"><Donut centerLabel="suppliers" segments={status} /></Card>
        <Card title="Payment terms"><HBars rows={terms.map(({ label, value }) => ({ label, value }))} empty="No suppliers yet." /></Card>
      </div>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable rows={filtered} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No suppliers match."
          columns={[
            { key: 'name', header: 'Supplier', sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
            { key: 'contact_person', header: 'Contact' },
            { key: 'phone', header: 'Phone' },
            { key: 'email', header: 'Email' },
            { key: 'payment_terms', header: 'Terms' },
            { key: 'status', header: 'Status', render: (r) => <span className="capitalize">{r.status}</span> },
            { key: 'view', header: '', render: (r) => <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}><Eye size={14} /> View</button> },
          ]} />
      )}

      {sel && (
        <DetailPanel title={sel.name} subtitle="Supplier" onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Contact person">{sel.contact_person}</Field>
            <Field label="Phone">{sel.phone}</Field>
            <Field label="Email">{sel.email}</Field>
            <Field label="Payment terms">{sel.payment_terms}</Field>
            <Field label="Address">{sel.address}</Field>
            <Field label="Status"><span className="capitalize">{sel.status}</span></Field>
          </div>
        </DetailPanel>
      )}
    </div>
  )
}