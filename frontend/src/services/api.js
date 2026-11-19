import axios from 'axios'

// In production set VITE_API_URL (e.g. https://apiarosales-api.onrender.com).
// In local dev leave it unset: the Vite proxy forwards /api to localhost:8000.
const API_ROOT = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
export const API_BASE = `${API_ROOT}/api/v1`

const api = axios.create({ baseURL: API_BASE })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && original && !original._retry
        && !original.url.includes('/auth/')) {
      original._retry = true
      try {
        const refresh = localStorage.getItem('refresh_token')
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token: refresh })
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        original.headers.Authorization = `Bearer ${data.access_token}`
        return api(original)
      } catch {
        localStorage.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default api