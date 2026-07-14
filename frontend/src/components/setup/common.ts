export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportDateSuffix() {
  const now = new Date()

  const date =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')

  const time =
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')

  return `${date}-${time}`
}

export const formatErrorMessage = (error: unknown): string | null => {
  if (!error) return null
  if (typeof error === 'string') return error
  if (error instanceof Error) {
    if (typeof error.message === 'string') return error.message
    if (error.message && typeof error.message === 'object') {
      try {
        return JSON.stringify(error.message)
      } catch {
        return 'Request failed.'
      }
    }
    if (error.message) return String(error.message)
  }
  if (typeof error === 'object' && error !== null) {
    const responseMessage = (error as { response?: { data?: { message?: unknown; detail?: unknown } } }).response?.data
    const message = (error as { message?: unknown; detail?: unknown }).message
      ?? (error as { detail?: unknown }).detail
      ?? responseMessage?.message
      ?? responseMessage?.detail
    if (typeof message === 'string') return message
    if (Array.isArray(message)) return message.map((item) => String(item)).join(', ')
    if (message && typeof message === 'object') {
      try {
        return JSON.stringify(message)
      } catch {
        return 'Request failed.'
      }
    }
  }
  return 'Request failed.'
}
