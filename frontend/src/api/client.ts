// Base API URL — empty string means same origin (works in prod and via Vite proxy in dev)
const BASE = ''

function stringifyApiErrorDetail(detail: unknown): string | null {
  if (!detail) return null
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return String(item)
        const value = (item as { msg?: unknown; message?: unknown; detail?: unknown }).msg
          ?? (item as { msg?: unknown; message?: unknown; detail?: unknown }).message
          ?? (item as { msg?: unknown; message?: unknown; detail?: unknown }).detail
        return typeof value === 'string' ? value : JSON.stringify(item)
      })
      .filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  if (typeof detail === 'object') {
    const nested = detail as { message?: unknown; detail?: unknown; error?: unknown }
    const value = nested.message ?? nested.detail ?? nested.error
    if (typeof value === 'string') return value
    if (value) return stringifyApiErrorDetail(value) ?? JSON.stringify(detail)
    try {
      return JSON.stringify(detail)
    } catch {
      return null
    }
  }
  return String(detail)
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const message = stringifyApiErrorDetail(err?.detail ?? err?.message ?? err?.error) ?? res.statusText
    throw new ApiError(message, res.status)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export default apiFetch
