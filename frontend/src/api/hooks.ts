import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiFetch from './client'
import type {
  AdminUserCreate,
  AdminUserPasswordUpdate,
  Alert,
  AlertCreate,
  AppSettings,
  AppSettingsIn,
  CheckResult,
  ChangePasswordRequest,
  DataExportPayload,
  JobOut,
  NotificationDefaultsUpdate,
  PriceHistory,
  PriceHistoryCreate,
  Product,
  ProductCreate,
  ProductStatistics,
  ProductUpdate,
  SelectorDefault,
  SelectorDefaultIn,
  SparklinePoint,
  SystemInfoOut,
  TestEmailRequest,
  TestNotificationResponse,
  TestTelegramRequest,
  Token,
  UiSettings,
  User,
  UserDataExportPayload,
} from './types'

// ── Auth ──────────────────────────────────────────────────────────────────────

export function useMe() {
  return useQuery<User>({
    queryKey: ['me'],
    queryFn: () => apiFetch<User>('/api/auth/me'),
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation<Token, Error, { username: string; password: string }>({
    mutationFn: ({ username, password }) => {
      const form = new URLSearchParams()
      form.append('username', username)
      form.append('password', password)
      return apiFetch<Token>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })
    },
    onSuccess: (data) => {
      localStorage.setItem('token', data.access_token)
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function logoutClient() {
  // Revoke all server-side sessions, then drop the local token. keepalive lets
  // the request survive the page reload that callers trigger right after.
  const token = localStorage.getItem('token')
  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
  }
  localStorage.removeItem('token')
}

export function useRegister() {
  return useMutation<User, Error, { username: string; password: string }>({
    mutationFn: (body) =>
      apiFetch<User>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export function useRegisterEnabled() {
  return useQuery<{ enabled: boolean }>({
    queryKey: ['register-enabled'],
    queryFn: () => apiFetch<{ enabled: boolean }>('/api/auth/register-enabled'),
    retry: false,
  })
}

export function useUpdateStarred() {
  const qc = useQueryClient()
  return useMutation<User, Error, number[]>({
    mutationFn: (starred_product_ids) =>
      apiFetch<User>('/api/auth/me/starred', {
        method: 'PATCH',
        body: JSON.stringify({ starred_product_ids }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

// ── Products ──────────────────────────────────────────────────────────────────

export function useProducts() {
  return useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: () => apiFetch<Product[]>('/api/products'),
  })
}

export function useProduct(id: number) {
  return useQuery<Product>({
    queryKey: ['products', id],
    queryFn: () => apiFetch<Product>(`/api/products/${id}`),
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation<Product, Error, ProductCreate>({
    mutationFn: (body) =>
      apiFetch<Product>('/api/products', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}

export function useUpdateProduct(id: number) {
  const qc = useQueryClient()
  return useMutation<Product, Error, ProductUpdate>({
    mutationFn: (body) =>
      apiFetch<Product>(`/api/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['products', id] })
    },
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (id) => apiFetch<void>(`/api/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}

export function useProductStats(id: number) {
  return useQuery<ProductStatistics>({
    queryKey: ['product-stats', id],
    queryFn: () => apiFetch<ProductStatistics>(`/api/products/${id}/stats`),
  })
}

export function useCheckProduct() {
  const qc = useQueryClient()
  return useMutation<CheckResult, Error, number>({
    mutationFn: (id) =>
      apiFetch<CheckResult>(`/api/products/${id}/check`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['products', id] })
      qc.invalidateQueries({ queryKey: ['prices', id] })
      qc.invalidateQueries({ queryKey: ['product-stats', id] })
    },
  })
}

export function useDownloadAllImages() {
  const qc = useQueryClient()
  return useMutation<{ status: string; message: string }, Error, void>({
    mutationFn: () =>
      apiFetch<{ status: string; message: string }>('/api/products/download-all-images', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

export function useCheckAllProducts() {
  const qc = useQueryClient()
  return useMutation<{ status: string; message: string }, Error, void>({
    mutationFn: () =>
      apiFetch<{ status: string; message: string }>('/api/products/check-all', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

// ── Prices ────────────────────────────────────────────────────────────────────

export function usePrices(productId: number, from?: string, to?: string) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString() ? `?${params.toString()}` : ''

  return useQuery<PriceHistory[]>({
    queryKey: ['prices', productId, from, to],
    queryFn: () => apiFetch<PriceHistory[]>(`/api/products/${productId}/prices${qs}`),
  })
}

function invalidatePriceQueries(qc: ReturnType<typeof useQueryClient>, productId: number) {
  qc.invalidateQueries({ queryKey: ['prices', productId] })
  qc.invalidateQueries({ queryKey: ['products'] })
  qc.invalidateQueries({ queryKey: ['products', productId] })
  qc.invalidateQueries({ queryKey: ['product-stats', productId] })
}

export function useCreatePrice(productId: number) {
  const qc = useQueryClient()
  return useMutation<PriceHistory, Error, PriceHistoryCreate>({
    mutationFn: (body) =>
      apiFetch<PriceHistory>(`/api/products/${productId}/prices`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidatePriceQueries(qc, productId),
  })
}

export function useUpdatePrice(productId: number) {
  const qc = useQueryClient()
  return useMutation<PriceHistory, Error, { priceId: number; price: string }>({
    mutationFn: ({ priceId, price }) =>
      apiFetch<PriceHistory>(`/api/products/${productId}/prices/${priceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ price }),
      }),
    onSuccess: () => invalidatePriceQueries(qc, productId),
  })
}

export function useDeletePrice(productId: number) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (priceId) =>
      apiFetch<void>(`/api/products/${productId}/prices/${priceId}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePriceQueries(qc, productId),
  })
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export function useAlerts(productId: number) {
  return useQuery<Alert[]>({
    queryKey: ['alerts', productId],
    queryFn: () => apiFetch<Alert[]>(`/api/products/${productId}/alerts`),
  })
}

export function useAllAlerts() {
  return useQuery<Alert[]>({
    queryKey: ['alerts_all'],
    queryFn: () => apiFetch<Alert[]>(`/api/alerts`),
  })
}

export function useCreateAlert(productId: number) {
  const qc = useQueryClient()
  return useMutation<Alert, Error, AlertCreate>({
    mutationFn: (body) =>
      apiFetch<Alert>(`/api/products/${productId}/alerts`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', productId] }),
  })
}

export function useDeleteAlert(productId: number) {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (alertId) => apiFetch<void>(`/api/alerts/${alertId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', productId] }),
  })
}

export function useUpdateAlert(productId: number) {
  const qc = useQueryClient()
  return useMutation<Alert, Error, { alertId: number; body: AlertCreate }>({
    mutationFn: ({ alertId, body }) =>
      apiFetch<Alert>(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', productId] }),
  })
}

// ── Settings ──────────────────────────────────────────────────────────────────

/** Global display preferences — readable/writable by every authenticated user. */
export function useUiSettings() {
  return useQuery<UiSettings>({
    queryKey: ['ui-settings'],
    queryFn: () => apiFetch<UiSettings>('/api/settings/ui'),
  })
}

export function useSaveUiSettings() {
  const qc = useQueryClient()
  return useMutation<UiSettings, Error, UiSettings>({
    mutationFn: (body) =>
      apiFetch<UiSettings>('/api/settings/ui', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ui-settings'] })
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

/** Full app settings — admin only; gate with `enabled`. */
export function useSettings(enabled = true) {
  return useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => apiFetch<AppSettings>('/api/settings'),
    enabled,
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation<AppSettings, Error, AppSettingsIn>({
    mutationFn: (body) =>
      apiFetch<AppSettings>('/api/settings', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['ui-settings'] })
    },
  })
}

// ── Default price selectors ─────────────────────────────────────────────────────

export function useSelectorDefaults() {
  return useQuery<SelectorDefault[]>({
    queryKey: ['selector-defaults'],
    queryFn: () => apiFetch<SelectorDefault[]>('/api/settings/selectors'),
  })
}

export function useCreateSelectorDefault() {
  const qc = useQueryClient()
  return useMutation<SelectorDefault, Error, SelectorDefaultIn>({
    mutationFn: (body) =>
      apiFetch<SelectorDefault>('/api/settings/selectors', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['selector-defaults'] }),
  })
}

export function useUpdateSelectorDefault() {
  const qc = useQueryClient()
  return useMutation<SelectorDefault, Error, { id: number; body: SelectorDefaultIn }>({
    mutationFn: ({ id, body }) =>
      apiFetch<SelectorDefault>(`/api/settings/selectors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['selector-defaults'] }),
  })
}

export function useDeleteSelectorDefault() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (id) => apiFetch<void>(`/api/settings/selectors/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['selector-defaults'] }),
  })
}

export function useSystemInfo() {
  return useQuery<SystemInfoOut>({
    queryKey: ['system-info'],
    queryFn: () => apiFetch<SystemInfoOut>('/api/settings/system-info'),
  })
}

/** Scheduler job list — admin only. */
export function useJobs(enabled = true) {
  return useQuery<JobOut[]>({
    queryKey: ['scheduler-jobs'],
    queryFn: () => apiFetch<JobOut[]>('/api/settings/jobs'),
    enabled,
    refetchInterval: 30_000,
  })
}

/** Recent price points per product for dashboard sparklines. */
export function useSparklines(enabled = true) {
  return useQuery<Record<number, SparklinePoint[]>>({
    queryKey: ['sparklines'],
    queryFn: () => apiFetch<Record<number, SparklinePoint[]>>('/api/products/sparklines'),
    enabled,
  })
}

export function useTestEmail() {
  return useMutation<TestNotificationResponse, Error, TestEmailRequest>({
    mutationFn: (body) =>
      apiFetch<TestNotificationResponse>('/api/settings/test-email', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export function useTestTelegram() {
  return useMutation<TestNotificationResponse, Error, TestTelegramRequest>({
    mutationFn: (body) =>
      apiFetch<TestNotificationResponse>('/api/settings/test-telegram', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export function useTestWebhooks() {
  return useMutation<TestNotificationResponse, Error, void>({
    mutationFn: () =>
      apiFetch<TestNotificationResponse>('/api/settings/test-webhooks', { method: 'POST' }),
  })
}

export function useChangePassword() {
  return useMutation<{ message: string }, Error, ChangePasswordRequest>({
    mutationFn: (body) =>
      apiFetch<{ message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export function useUpdateNotificationDefaults() {
  const qc = useQueryClient()
  return useMutation<{ message: string }, Error, NotificationDefaultsUpdate>({
    mutationFn: (body) =>
      apiFetch<{ message: string }>('/api/auth/me/notification-defaults', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}

export function useUsers(enabled = true) {
  return useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch<User[]>('/api/auth/users'),
    enabled,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation<User, Error, AdminUserCreate>({
    mutationFn: (body) =>
      apiFetch<User>('/api/auth/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useAdminChangeUserPassword() {
  return useMutation<{ message: string }, Error, { userId: number; body: AdminUserPasswordUpdate }>({
    mutationFn: ({ userId, body }) =>
      apiFetch<{ message: string }>(`/api/auth/users/${userId}/password`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (userId) => apiFetch<void>(`/api/auth/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
}

export function useExportData() {
  return useMutation<DataExportPayload, Error, void>({
    mutationFn: () => apiFetch<DataExportPayload>('/api/settings/export'),
  })
}

export function useImportData() {
  const qc = useQueryClient()
  return useMutation<{ message: string }, Error, DataExportPayload>({
    mutationFn: (body) =>
      apiFetch<{ message: string }>('/api/settings/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useExportMyData() {
  return useMutation<UserDataExportPayload, Error, void>({
    mutationFn: () => apiFetch<UserDataExportPayload>('/api/settings/export/mine'),
  })
}

export function useImportMyData() {
  const qc = useQueryClient()
  return useMutation<{ message: string }, Error, UserDataExportPayload>({
    mutationFn: (body) =>
      apiFetch<{ message: string }>('/api/settings/import/mine', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useDeleteMyProducts() {
  const qc = useQueryClient()
  return useMutation<void, Error, void>({
    mutationFn: () => apiFetch<void>('/api/settings/products/mine', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}

export function useAdminDeleteUserProducts() {
  const qc = useQueryClient()
  return useMutation<{ message: string }, Error, number>({
    mutationFn: (userId) =>
      apiFetch<{ message: string }>(`/api/settings/users/${userId}/products`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}
