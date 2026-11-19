import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import api from '../../services/api'
import DataTable from './DataTable'
import StatusBadge from './StatusBadge'
import { formatKES, formatDate } from '../../utils/format'

const MONEY = /(amount|total|balance|price|cost|paid|value|outstanding)/i
const DATE = /(date|_at)$/i

function titleCase(key) {
  const s = key.replaceAll('_', ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildColumns(sample) {
  if (!sample) return []
  return Object.keys(sample)
    .filter((k) => k !== 'id' && !k.endsWith('_id'))
    .filter((k) => sample[k] === null || typeof sample[k] !== 'object')
    .slice(0, 8)
    .map((key) => ({
      key,
      header: titleCase(key),
      sortable: true,
      render: (row) => {
        const v = row[key]
        if (v === null || v === undefined || v === '') return '—'
        if (key === 'status' || key.endsWith('_status')) return <StatusBadge status={v} />
        if (typeof v === 'boolean') return v ? 'Yes' : 'No'
        if (MONEY.test(key) && !Number.isNaN(Number(v))) return formatKES(v)
        if (DATE.test(key)) return formatDate(v)
        return String(v)
      },
    }))
}

export default function ResourcePage({ title, subtitle, endpoint }) {
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['resource', endpoint],
    queryFn: async () => (await api.get(endpoint)).data,
  })

  const rows = Array.isArray(data) ? data : data?.items ?? data?.results ?? []
  const columns = buildColumns(rows[0])
  const q = search.trim().toLowerCase()
  const filtered = q
    ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
    : rows

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 w-full sm:w-auto">
          <div className="search-wrap sm:w-80">
            <Search size={16} className="search-icon" />
            <input
              className="search-input"
              placeholder={`Search ${title.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
            />
            {search && (
              <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          {q && !isLoading && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {filtered.length} of {rows.length} shown
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="card p-4 text-sm text-red-500">
          Could not load <code>{endpoint}</code>:{' '}
          {error.response?.data?.detail
            ? JSON.stringify(error.response.data.detail)
            : error.message}
        </div>
      )}

      {isLoading ? (
        <div className="card h-48 animate-pulse" />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={q ? `No ${title.toLowerCase()} match "${search}".` : `No ${title.toLowerCase()} found.`}
        />
      )}
    </div>
  )
}