export interface User {
  id: number
  username: string
  is_admin: boolean
  default_email: string | null
  default_telegram_chat_id: string | null
  starred_product_ids: number[]
  created_at: string
}

export interface Token {
  access_token: string
  token_type: string
}

/** Number-format hint for parsing scraped prices. */
export type PriceFormat = 'auto' | 'eu' | 'us'

export interface Product {
  id: number
  user_id: number
  name: string
  category: string | null
  memo: string | null
  tags: string[]
  image_url: string | null
  cached_image_url?: string | null
  check_time_hhmm?: string | null
  url: string
  selector: string
  check_interval_minutes: number
  record_all_prices: boolean
  price_format: PriceFormat
  consecutive_scrape_failures: number
  url_redirected: boolean
  active: boolean
  currency: string
  latest_price: string | null
  previous_price: string | null
  last_price_change_percent: string | null
  last_price_change_at: string | null
  next_run_at: string | null
  last_checked_at: string | null
  lowest_price: string | null
  lowest_price_at: string | null
  highest_price: string | null
  highest_price_at: string | null
  created_at: string
}

export interface ProductCreate {
  name: string
  category?: string | null
  memo?: string | null
  tags?: string[]
  image_url?: string | null
  check_time_hhmm?: string | null
  url: string
  selector: string
  check_interval_minutes?: number
  record_all_prices?: boolean
  price_format?: PriceFormat
  active?: boolean
}

export interface ProductUpdate {
  name?: string
  category?: string | null
  memo?: string | null
  tags?: string[]
  image_url?: string | null
  check_time_hhmm?: string | null
  url?: string
  selector?: string
  check_interval_minutes?: number
  record_all_prices?: boolean
  price_format?: PriceFormat
  active?: boolean
}

export interface PriceHistory {
  id: number
  product_id: number
  price: string
  currency: string
  scraped_at: string
}

export interface PriceHistoryCreate {
  price: string
  scraped_at: string
  currency?: string | null
}

export type AlertCondition = 'below' | 'changed' | 'any_change' | 'lowered' | 'lowered_percent'

export interface Alert {
  id: number
  product_id: number
  condition: AlertCondition
  threshold_price: string | null
  threshold_percent?: string | null
  email: string | null
  telegram_chat_id: string | null
  active: boolean
  last_checked_at?: string | null
  last_triggered_at?: string | null
}

export interface AlertCreate {
  condition: AlertCondition
  threshold_price?: string | null
  threshold_percent?: string | null
  email?: string | null
  telegram_chat_id?: string | null
  active?: boolean
}

export type DateFormat = 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
export type TimeFormat = '12h' | '24h'

export interface AppSettings {
  allow_registration: boolean
  date_format: DateFormat
  time_format: TimeFormat
  telegram_bot_token_set: boolean
  updated_at: string | null
}

export interface AppSettingsIn {
  allow_registration: boolean
  date_format: DateFormat
  time_format: TimeFormat
  /** undefined/null = keep stored token, '' = clear it */
  telegram_bot_token?: string | null
}

export interface UiSettings {
  date_format: DateFormat
  time_format: TimeFormat
  show_sparklines: boolean
}

export interface SparklinePoint {
  t: string
  p: string
}

export interface SelectorDefault {
  id: number
  domain: string
  selector: string
}

export interface SelectorDefaultIn {
  domain: string
  selector: string
}

export interface TestEmailRequest {
  email: string
}

export interface TestTelegramRequest {
  chat_id: string
}

export interface TestNotificationResponse {
  status: 'sent' | 'error'
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

export interface NotificationDefaultsUpdate {
  default_email?: string | null
  default_telegram_chat_id?: string | null
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
export interface SystemInfoOut {
  version: string
  db_type: string
  db_version: string
  scraper_backend: string
  scraper_headless: boolean
}

export interface JobOut {
  id: string
  next_run_time: string | null
}