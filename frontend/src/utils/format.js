// Centralized KSh formatting — en-KE locale, Africa/Nairobi
export function formatKES(value) {
  const num = Number(value ?? 0)
  return `KSh ${num.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'Africa/Nairobi',
  })
}

export const DOC_STATUSES = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  pending_verification: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  approved: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  partially_fulfilled: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  fully_fulfilled: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  unpaid: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  partially_paid: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  fully_paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  verified: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  reversed: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  expired: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  cancelled: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
}