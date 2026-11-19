import { useQuery } from '@tanstack/react-query'
import api from '../services/api'

const fetcher = (url) => async () => (await api.get(url)).data

export const useOrganizations = () => useQuery({ queryKey: ['organizations'], queryFn: fetcher('/organizations') })
export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: fetcher('/products') })
export const useWorkers = () => useQuery({ queryKey: ['workers'], queryFn: fetcher('/workers') })
export const useLpos = () => useQuery({ queryKey: ['lpos'], queryFn: fetcher('/lpos') })
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: fetcher('/orders') })
export const useInvoices = () => useQuery({ queryKey: ['invoices'], queryFn: fetcher('/invoices') })
export const useWarehouses = () => useQuery({ queryKey: ['warehouses'], queryFn: fetcher('/products/warehouses') })

export const nameMap = (list, key = 'name') =>
  Object.fromEntries((list ?? []).map((x) => [x.id, x[key]]))

export function apiError(e, fallback = 'Request failed') {
  const d = e?.response?.data?.detail
  if (!d) return e?.message ?? fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d.map((x) => `${(x.loc ?? []).slice(1).join('.')}: ${x.msg}`).join('; ')
  }
  return JSON.stringify(d)
}