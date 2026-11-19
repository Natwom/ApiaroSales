import { COLORS } from './Charts'
import { formatKES } from '../../utils/format'

export const TONES = {
  brand: 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200',
  green: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
}

export function Kpi({ icon: Icon, label, value, sub, tone = 'brand' }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={`rounded-lg p-2.5 ${TONES[tone]}`}><Icon size={18} /></div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-xl font-semibold truncate">{value}</div>
        {sub && <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

export function MoneyBars({ rows, color = COLORS.brand, empty = 'Nothing to show.' }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between text-xs mb-1 gap-2">
            <span className="truncate">{r.label}</span>
            <span className="font-semibold whitespace-nowrap">{formatKES(r.value)}</span>
          </div>
          <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-2 rounded" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function downloadCsv(filename, head, lines) {
  const csv = [head, ...lines]
    .map((l) => l.map((x) => `"${String(x ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}