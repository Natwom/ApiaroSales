import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { Plus, Trash2, Eye, Download, Landmark, TrendingUp, TrendingDown, Scale } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import Tabs from '../../components/common/Tabs'
import { COLORS } from '../../components/common/Charts'
import { Kpi, Card, MoneyBars, downloadCsv } from '../../components/common/Widgets'
import { useAuth } from '../../context/AuthContext'
import { formatKES, formatDate } from '../../utils/format'
import { apiError } from '../../hooks/useLookups'

const num = (v) => Number(v ?? 0)
const iso = (d) => d.toISOString().slice(0, 10)
const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense']
const EMPTY_JE = () => ({ entry_date: iso(new Date()), narration: '', lines: [{ account_code: '', debit: '', credit: '' }, { account_code: '', debit: '', credit: '' }] })

function Block({ title, rows, total, totalLabel }) {
  return (
    <div className="card p-5">
      <h3 className="font-semibold mb-3">{title}</h3>
      <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-800">
        {rows.length === 0 && <li className="py-2 text-slate-500">Nothing recorded.</li>}
        {rows.map((r) => (
          <li key={r.code} className="flex justify-between py-1.5"><span>{r.code} · {r.name}</span><span>{formatKES(r.balance)}</span></li>
        ))}
      </ul>
      <div className="flex justify-between font-semibold border-t pt-2 mt-2 text-sm"><span>{totalLabel}</span><span>{formatKES(total)}</span></div>
    </div>
  )
}

export default function AccountingPage() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const canPost = hasPermission('invoice.approve')
  const [tab, setTab] = useState('accounts')
  const [range, setRange] = useState({ from: '', to: '' })
  const [showAcct, setShowAcct] = useState(false)
  const [showJe, setShowJe] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [source, setSource] = useState('')

  const params = { ...(range.from && { date_from: range.from }), ...(range.to && { date_to: range.to }) }
  const { data: accts, isLoading, error: loadError } = useQuery({
    queryKey: ['accounting-accounts', range.from, range.to],
    queryFn: async () => (await api.get('/accounting/accounts', { params })).data,
  })
  const { data: journal } = useQuery({
    queryKey: ['accounting-journal'], queryFn: async () => (await api.get('/accounting/journal')).data,
  })

  const acctForm = useForm({ defaultValues: { code: '', name: '', account_type: 'expense' } })
  const jeForm = useForm({ defaultValues: EMPTY_JE() })
  const { fields, append, remove } = useFieldArray({ control: jeForm.control, name: 'lines' })
  const jeLines = jeForm.watch('lines')

  const rows = useMemo(() => (accts ?? []).map((a) => ({ ...a, d: num(a.debit), c: num(a.credit), bal: num(a.balance) })), [accts])
  const by = (type) => rows.filter((r) => r.account_type === type && (Math.abs(r.bal) > 0.004 || Math.abs(r.d) + Math.abs(r.c) > 0))
  const sumBal = (list) => list.reduce((s, r) => s + r.bal, 0)
  const code = (c) => rows.find((r) => r.code === c)?.bal ?? 0

  const revenue = sumBal(by('revenue')), expenses = sumBal(by('expense'))
  const profit = revenue - expenses
  const assets = sumBal(by('asset')), liabilities = sumBal(by('liability')), equity = sumBal(by('equity'))
  const totalD = rows.reduce((s, r) => s + r.d, 0), totalC = rows.reduce((s, r) => s + r.c, 0)
  const balanced = Math.abs(totalD - totalC) < 0.005

  const refresh = () => ['accounting-accounts', 'accounting-journal'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const acctMutation = useMutation({
    mutationFn: (p) => api.post('/accounting/accounts', p),
    onSuccess: () => { refresh(); setShowAcct(false); acctForm.reset(); setError(''); setNotice('Account added.') },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to add account')) },
  })
  const jeMutation = useMutation({
    mutationFn: (p) => api.post('/accounting/journal', p),
    onSuccess: (res) => { refresh(); setShowJe(false); jeForm.reset(EMPTY_JE()); setError(''); setNotice(`Journal entry ${res.data?.entry_no ?? ''} posted.`) },
    onError: (e) => { setNotice(''); setError(apiError(e, 'Failed to post entry')) },
  })

  const jeD = (jeLines ?? []).reduce((s, l) => s + num(l.debit), 0)
  const jeC = (jeLines ?? []).reduce((s, l) => s + num(l.credit), 0)
  const jeOk = jeD > 0 && Math.abs(jeD - jeC) < 0.005
  const onJe = (v) => {
    if (!jeOk) { setError('Debits and credits must be equal and greater than zero.'); return }
    jeMutation.mutate({
      entry_date: v.entry_date, narration: v.narration.trim(),
      lines: v.lines.filter((l) => l.account_code && (num(l.debit) > 0 || num(l.credit) > 0))
        .map((l) => ({ account_code: l.account_code, debit: String(num(l.debit)), credit: String(num(l.credit)) })),
    })
  }

  const exportTb = () =>
    downloadCsv(`trial-balance-${iso(new Date())}.csv`, ['Code', 'Name', 'Type', 'Debit', 'Credit', 'Balance'],
      rows.map((r) => [r.code, r.name, r.account_type, r.d.toFixed(2), r.c.toFixed(2), r.bal.toFixed(2)]))

  const entries = (journal ?? []).filter((e) => !source || e.source === source)
  const sel = (journal ?? []).find((e) => e.id === selectedId)
  const sources = [...new Set((journal ?? []).map((e) => e.source).filter(Boolean))]
  const pnlBars = [{ label: 'Revenue', value: revenue, color: COLORS.green }, { label: 'Expenses', value: expenses, color: COLORS.red }]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Accounting</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Chart of accounts, journal and financial statements. Invoices, payments, expenses and supplier payments post here automatically.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={exportTb}><Download size={16} /> Export trial balance</button>
          {canPost && <button className="btn-secondary" onClick={() => { setShowAcct((s) => !s); setError(''); setNotice('') }}><Plus size={16} /> Account</button>}
          {canPost && <button className="btn-primary" onClick={() => { setShowJe((s) => !s); setTab('journal'); setError(''); setNotice('') }}><Plus size={16} /> Journal entry</button>}
        </div>
      </div>

      {(error || loadError) && <div className="card p-3 text-sm text-red-500">{error || apiError(loadError)}</div>}
      {notice && <div className="card p-3 text-sm text-green-600">{notice}</div>}

      {showAcct && (
        <form onSubmit={acctForm.handleSubmit((v) => acctMutation.mutate({ code: v.code.trim(), name: v.name.trim(), account_type: v.account_type }))}
          className="card p-5 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div><label className="label">Code *</label><input className="input" placeholder="e.g. 5200" {...acctForm.register('code', { required: true })} /></div>
          <div className="md:col-span-2"><label className="label">Name *</label><input className="input" {...acctForm.register('name', { required: true })} /></div>
          <div><label className="label">Type *</label><select className="input" {...acctForm.register('account_type')}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="md:col-span-4 flex gap-2">
            <button type="submit" className="btn-primary" disabled={acctMutation.isPending}>Save account</button>
            <button type="button" className="btn-secondary" onClick={() => setShowAcct(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi icon={Landmark} label="Cash / bank" value={formatKES(code('1000'))} />
        <Kpi icon={Scale} tone="amber" label="Receivables" value={formatKES(code('1100'))} />
        <Kpi icon={Scale} tone="red" label="Payables" value={formatKES(code('2000'))} />
        <Kpi icon={TrendingUp} tone="green" label="Revenue" value={formatKES(revenue)} />
        <Kpi icon={profit >= 0 ? TrendingUp : TrendingDown} tone={profit >= 0 ? 'green' : 'red'} label="Net profit" value={formatKES(profit)} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label">From</label><input type="date" className="input" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
        {(range.from || range.to) && <button className="btn-secondary" onClick={() => setRange({ from: '', to: '' })}>Clear dates</button>}
        <span className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${balanced ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
          {balanced ? 'Books balance' : `Out of balance by ${formatKES(Math.abs(totalD - totalC))}`}
        </span>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'accounts', label: 'Trial balance' }, { key: 'journal', label: 'Journal' }, { key: 'statements', label: 'Financial statements' }]} />

      {tab === 'accounts' && (isLoading ? <div className="card h-48 animate-pulse" /> : (
        <div className="space-y-3">
          <DataTable rows={rows} emptyMessage="No accounts yet."
            columns={[
              { key: 'code', header: 'Code', sortable: true },
              { key: 'name', header: 'Account', sortable: true, render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'account_type', header: 'Type', render: (r) => <span className="capitalize">{r.account_type}</span> },
              { key: 'd', header: 'Debit', render: (r) => formatKES(r.d) },
              { key: 'c', header: 'Credit', render: (r) => formatKES(r.c) },
              { key: 'bal', header: 'Balance', render: (r) => <span className="font-semibold">{formatKES(r.bal)}</span> },
            ]} />
          <div className="card p-4 flex flex-wrap justify-between gap-4 text-sm font-semibold">
            <span>Total debits: {formatKES(totalD)}</span><span>Total credits: {formatKES(totalC)}</span>
          </div>
        </div>
      ))}

      {tab === 'journal' && (
        <div className="space-y-4">
          {showJe && (
            <form onSubmit={jeForm.handleSubmit(onJe)} className="card p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="label">Date *</label><input type="date" className="input" {...jeForm.register('entry_date', { required: true })} /></div>
                <div className="md:col-span-2"><label className="label">Narration *</label><input className="input" {...jeForm.register('narration', { required: true })} /></div>
              </div>
              {fields.map((f, idx) => (
                <div key={f.id} className="grid grid-cols-12 gap-2">
                  <div className="col-span-6">
                    <select className="input" {...jeForm.register(`lines.${idx}.account_code`)}>
                      <option value="">Account…</option>
                      {rows.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2"><input type="number" step="0.01" min="0" className="input" placeholder="Debit" {...jeForm.register(`lines.${idx}.debit`)} /></div>
                  <div className="col-span-3"><input type="number" step="0.01" min="0" className="input" placeholder="Credit" {...jeForm.register(`lines.${idx}.credit`)} /></div>
                  <div className="col-span-1"><button type="button" className="btn-secondary" disabled={fields.length <= 2} onClick={() => remove(idx)}><Trash2 size={14} /></button></div>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="btn-secondary" onClick={() => append({ account_code: '', debit: '', credit: '' })}><Plus size={14} /> Add line</button>
                <span className={`text-sm ${jeOk ? 'text-green-600' : 'text-slate-500'}`}>Debits {formatKES(jeD)} · Credits {formatKES(jeC)}{jeD > 0 && !jeOk ? ' · not balanced' : ''}</span>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={jeMutation.isPending || !jeOk}>{jeMutation.isPending ? 'Posting…' : 'Post entry'}</button>
                <button type="button" className="btn-secondary" onClick={() => setShowJe(false)}>Cancel</button>
              </div>
            </form>
          )}
          <div className="flex gap-2">
            <select className="input max-w-[220px]" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>{sources.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <DataTable rows={entries} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No journal entries yet."
            columns={[
              { key: 'entry_no', header: 'Entry', sortable: true },
              { key: 'entry_date', header: 'Date', sortable: true, render: (r) => formatDate(r.entry_date) },
              { key: 'narration', header: 'Narration' },
              { key: 'source', header: 'Source', render: (r) => <span className="capitalize">{String(r.source ?? '').replaceAll('_', ' ')}</span> },
              { key: 'total', header: 'Amount', render: (r) => formatKES(r.total) },
              { key: 'view', header: '', render: (r) => <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}><Eye size={14} /> View</button> },
            ]} />
        </div>
      )}

      {tab === 'statements' && (
        <div className="space-y-4 print-area">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <Block title="Income statement: revenue" rows={by('revenue')} total={revenue} totalLabel="Total revenue" />
              <Block title="Income statement: expenses" rows={by('expense')} total={expenses} totalLabel="Total expenses" />
              <div className={`card p-4 flex justify-between font-semibold ${profit >= 0 ? 'text-green-600' : 'text-red-500'}`}><span>Net profit</span><span>{formatKES(profit)}</span></div>
            </div>
            <div className="space-y-4">
              <Block title="Balance sheet: assets" rows={by('asset')} total={assets} totalLabel="Total assets" />
              <Block title="Balance sheet: liabilities" rows={by('liability')} total={liabilities} totalLabel="Total liabilities" />
              <Block title="Balance sheet: equity" rows={by('equity')} total={equity + profit} totalLabel="Equity incl. current profit" />
              <div className="card p-4 text-sm flex justify-between"><span>Assets − (Liabilities + Equity)</span>
                <span className={Math.abs(assets - liabilities - equity - profit) < 0.005 ? 'text-green-600' : 'text-red-500'}>{formatKES(assets - liabilities - equity - profit)}</span></div>
            </div>
          </div>
          <Card title="Revenue vs expenses"><MoneyBars rows={pnlBars} empty="No figures yet." /></Card>
          <button className="btn-secondary no-print" onClick={() => window.print()}>Print statements</button>
        </div>
      )}

      {sel && (
        <DetailPanel title={`Journal entry ${sel.entry_no}`} subtitle={formatDate(sel.entry_date)} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Source"><span className="capitalize">{String(sel.source ?? '').replaceAll('_', ' ')}</span></Field>
            <Field label="Reference">{sel.source_ref}</Field>
            <Field label="Status">{sel.status}</Field>
            <Field label="Narration">{sel.narration}</Field>
          </div>
          <DataTable rowKey="_n" rows={sel.lines.map((l, n) => ({ ...l, _n: n }))}
            columns={[
              { key: 'code', header: 'Code' }, { key: 'name', header: 'Account' },
              { key: 'debit', header: 'Debit', render: (r) => (num(r.debit) ? formatKES(r.debit) : '—') },
              { key: 'credit', header: 'Credit', render: (r) => (num(r.credit) ? formatKES(r.credit) : '—') },
            ]} />
        </DetailPanel>
      )}
    </div>
  )
}