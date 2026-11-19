import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, Download, ScrollText, CalendarDays, Users, Layers } from 'lucide-react'
import api from '../../services/api'
import DataTable from '../../components/common/DataTable'
import DetailPanel, { Field } from '../../components/common/DetailPanel'
import AreaChart from '../../components/common/AreaChart'
import { HBars, COLORS } from '../../components/common/Charts'
import { Kpi, Card, downloadCsv } from '../../components/common/Widgets'
import { apiError } from '../../hooks/useLookups'

const DAY = 86400000
const dayKey = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
const stamp = (v) => v ? new Date(v).toLocaleString('en-KE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Nairobi' }) : '—'
const pretty = (s) => { if (!s) return null; try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }
const TONE = { create: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300', approve: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300', verify: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300', reject: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300', reverse: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300', fail: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' }
const ActionPill = ({ a }) => <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${TONE[a] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{a}</span>

export default function AuditPage() {
  const [search, setSearch] = useState('')
  const [moduleF, setModuleF] = useState('')
  const [actionF, setActionF] = useState('')
  const [userF, setUserF] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const { data, isLoading, error } = useQuery({ queryKey: ['audit'], queryFn: async () => (await api.get('/audit', { params: { limit: 1000 } })).data, staleTime: 0 })
  const all = data ?? []

  const modules = [...new Set(all.map((a) => a.module))].sort()
  const actions = [...new Set(all.map((a) => a.action))].sort()
  const usersList = [...new Set(all.map((a) => a.user))].sort()

  const rows = useMemo(() => all
    .filter((a) => !moduleF || a.module === moduleF)
    .filter((a) => !actionF || a.action === actionF)
    .filter((a) => !userF || a.user === userF)
    .filter((a) => !from || dayKey(a.created_at) >= from)
    .filter((a) => !to || dayKey(a.created_at) <= to)
    .filter((a) => !search.trim() || [a.record_ref, a.reason, a.user, a.module, a.action].some((x) => String(x ?? '').toLowerCase().includes(search.trim().toLowerCase()))),
  [all, moduleF, actionF, userF, from, to, search])

  const today = dayKey(new Date())
  const byModule = Object.entries(rows.reduce((m, a) => ({ ...m, [a.module]: (m[a.module] ?? 0) + 1 }), {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6)
  const byUser = Object.entries(rows.reduce((m, a) => ({ ...m, [a.user]: (m[a.user] ?? 0) + 1 }), {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6)
  const trend = useMemo(() => {
    const m = {}; rows.forEach((a) => { const k = dayKey(a.created_at); m[k] = (m[k] ?? 0) + 1 })
    return Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.now() - (13 - i) * DAY); return { label: d.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', timeZone: 'Africa/Nairobi' }), a: m[dayKey(d)] ?? 0 } })
  }, [rows])

  const exportCsv = () =>
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, ['When', 'User', 'Action', 'Module', 'Record', 'Reason'],
      rows.map((a) => [stamp(a.created_at), a.user, a.action, a.module, a.record_ref ?? '', a.reason ?? '']))

  const sel = all.find((a) => a.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Logs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">A record of who did what and when. Showing the latest 1,000 events.</p>
        </div>
        <button className="btn-secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button>
      </div>

      {error && <div className="card p-3 text-sm text-red-500">{apiError(error)}</div>}

      <div className="flex flex-wrap items-end gap-2">
        <input className="input max-w-xs" placeholder="Search record, reason, user…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-[170px]" value={moduleF} onChange={(e) => setModuleF(e.target.value)}><option value="">All modules</option>{modules.map((m) => <option key={m}>{m}</option>)}</select>
        <select className="input max-w-[150px]" value={actionF} onChange={(e) => setActionF(e.target.value)}><option value="">All actions</option>{actions.map((m) => <option key={m}>{m}</option>)}</select>
        <select className="input max-w-[190px]" value={userF} onChange={(e) => setUserF(e.target.value)}><option value="">All users</option>{usersList.map((m) => <option key={m}>{m}</option>)}</select>
        <input type="date" className="input max-w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input max-w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi icon={ScrollText} label="Events" value={rows.length} />
        <Kpi icon={CalendarDays} tone="green" label="Today" value={rows.filter((a) => dayKey(a.created_at) === today).length} />
        <Kpi icon={Users} label="Active users" value={new Set(rows.map((a) => a.user)).size} />
        <Kpi icon={Layers} tone="amber" label="Modules touched" value={new Set(rows.map((a) => a.module)).size} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Events per day (14 days)" className="lg:col-span-2"><AreaChart data={trend} height={190} format={(v) => String(Math.round(v))} series={[{ key: 'a', label: 'Events', color: COLORS.brand }]} /></Card>
        <div className="space-y-4">
          <Card title="By module"><HBars rows={byModule} empty="No events." /></Card>
          <Card title="By user"><HBars rows={byUser} color={COLORS.green} empty="No events." /></Card>
        </div>
      </div>

      {isLoading ? <div className="card h-48 animate-pulse" /> : (
        <DataTable rows={rows} onRowClick={(r) => setSelectedId(r.id)} emptyMessage="No events match."
          columns={[
            { key: 'created_at', header: 'When', sortable: true, render: (r) => stamp(r.created_at) },
            { key: 'user', header: 'User', sortable: true },
            { key: 'action', header: 'Action', render: (r) => <ActionPill a={r.action} /> },
            { key: 'module', header: 'Module', sortable: true },
            { key: 'record_ref', header: 'Record' },
            { key: 'reason', header: 'Reason' },
            { key: 'view', header: '', render: (r) => <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id) }}><Eye size={14} /> View</button> },
          ]} />
      )}

      {sel && (
        <DetailPanel title={`${sel.action} · ${sel.module}`} subtitle={sel.record_ref ?? ''} onClose={() => setSelectedId(null)}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="When">{stamp(sel.created_at)}</Field>
            <Field label="User">{sel.user}</Field>
            <Field label="Action"><ActionPill a={sel.action} /></Field>
            <Field label="Record">{sel.record_ref}</Field>
            <Field label="Reason">{sel.reason}</Field>
          </div>
          {pretty(sel.old_values) && <div><h3 className="font-semibold mb-1">Before</h3><pre className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-xs overflow-x-auto">{pretty(sel.old_values)}</pre></div>}
          {pretty(sel.new_values) && <div><h3 className="font-semibold mb-1">Details / after</h3><pre className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3 text-xs overflow-x-auto">{pretty(sel.new_values)}</pre></div>}
          {!pretty(sel.old_values) && !pretty(sel.new_values) && <p className="text-sm text-slate-500">No extra details were recorded for this event.</p>}
        </DetailPanel>
      )}
    </div>
  )
}