export interface User {
  id: number
  username: string
  is_admin: boolean
  created_at: string
}

export interface Token {
  access_token: string
  token_type: string
}

export interface Product {
  id: number
  user_id: number
  name: string
  category: string | null
  tags: string[]
  image_url: string | null
  url: string
  selector: string
  check_interval_minutes: number
  active: boolean
  created_at: string
  latest_price: string | null
  previous_price: string | null
  last_price_change_percent: string | null
  last_price_change_at: string | null
}

export interface ProductCreate {
  name: string
  category?: string | null
  tags?: string[]
  image_url?: string | null
  url: string
  selector: string
  check_interval_minutes?: number
  active?: boolean
}

export interface ProductUpdate {
  name?: string
  category?: string | null
  tags?: string[]
  image_url?: string | null
  url?: string
  selector?: string
  check_interval_minutes?: number
  active?: boolean
}

export interface PriceHistory {
  id: number
  product_id: number
  price: string
  currency: string
  scraped_at: string
}

export interface Alert {
  id: number
  product_id: number
  condition: 'below' | 'changed' | 'any_change'
  threshold_price: string | null
  email: string | null
  telegram_chat_id: string | null
  active: boolean
}

export interface AlertCreate {
  condition: 'below' | 'changed' | 'any_change'
  threshold_price?: string | null
  email?: string | null
  telegram_chat_id?: string | null
  active?: boolean
}

export interface AppSettings {
  db_type: 'sqlite' | 'postgresql'
  sqlite_path: string
  pg_host: string
  pg_port: number
  pg_database: string
  pg_user: string
  pg_password: string
  allow_registration: boolean
  date_format: 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
  updated_at: string | null
}

export interface TestDbRequest {
  db_type: 'sqlite' | 'postgresql'
  sqlite_path?: string
  pg_host?: string
  pg_port?: number
  pg_database?: string
  pg_user?: string
  pg_password?: string
}

export interface TestDbResponse {
  status: 'connected' | 'error'
  message: string
}

export interface CheckResult {
  product_id: number
  price: string | null
  error: string | null
}

export interface ProductStatistics {
  average_price: string | null
  lowest_price: string | null
  lowest_price_at: string | null
  highest_price: string | null
  highest_price_at: string | null
  current_price: string | null
  total_change_percent: string | null
  last_change_percent: string | null
  last_change_at: string | null
  data_points: number
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface AdminUserCreate {
  username: string
  password: string
  is_admin?: boolean
}

export interface AdminUserPasswordUpdate {
  new_password: string
}

export interface DataExportPayload {
  app_settings: Record<string, unknown>
  users: Record<string, unknown>[]
  products: Record<string, unknown>[]
  price_history: Record<string, unknown>[]
  alerts: Record<string, unknown>[]
}

export interface UserDataExportPayload {
  products: Record<string, unknown>[]
  price_history: Record<string, unknown>[]
  alerts: Record<string, unknown>[]
}
