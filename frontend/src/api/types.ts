export interface User {
  id: number
  username: string
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
  url: string
  selector: string
  check_interval_minutes: number
  active: boolean
  created_at: string
  latest_price: string | null
}

export interface ProductCreate {
  name: string
  url: string
  selector: string
  check_interval_minutes?: number
  active?: boolean
}

export interface ProductUpdate {
  name?: string
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
  email: string
  active: boolean
}

export interface AlertCreate {
  condition: 'below' | 'changed' | 'any_change'
  threshold_price?: string | null
  email: string
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
