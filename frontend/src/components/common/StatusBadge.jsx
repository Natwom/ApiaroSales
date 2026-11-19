import { DOC_STATUSES } from '../../utils/format'

export default function StatusBadge({ status }) {
  const cls = DOC_STATUSES[status] ?? DOC_STATUSES.draft
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status?.replaceAll('_', ' ')}
    </span>
  )
}