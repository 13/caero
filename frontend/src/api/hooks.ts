import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import apiFetch from './client'
import type {
  AdminUserCreate,
  AdminUserPasswordUpdate,
  Alert,
  AlertCreate,
  AppSettings,
  CheckResult,
  ChangePasswordRequest,
  DataExportPayload,
  PriceHistory,
  Product,
  ProductCreate,
  ProductStatistics,
  ProductUpdate,
  TestDbRequest,
  TestDbResponse,
  TestEmailRequest,
  TestNotificationResponse,
  TestTelegramRequest,
  Token,
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

// ── Alerts ────────────────────────────────────────────────────────────────────

export function useAlerts(productId: number) {
  return useQuery<Alert[]>({
    queryKey: ['alerts', productId],
    queryFn: () => apiFetch<Alert[]>(`/api/products/${productId}/alerts`),
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

export function useSettings() {
  return useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => apiFetch<AppSettings>('/api/settings'),
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation<AppSettings, Error, AppSettings>({
    mutationFn: (body) =>
      apiFetch<AppSettings>('/api/settings', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useTestDb() {
  return useMutation<TestDbResponse, Error, TestDbRequest>({
    mutationFn: (body) =>
      apiFetch<TestDbResponse>('/api/settings/test-db', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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

export function useChangePassword() {
  return useMutation<{ message: string }, Error, ChangePasswordRequest>({
    mutationFn: (body) =>
      apiFetch<{ message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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
