import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLogin, useRegister, useRegisterEnabled } from '../api/hooks'
import CaeroBrand from '../components/CaeroBrand'
import { APP_TAGLINE } from '../constants/appInfo'

export default function Login() {
  const navigate = useNavigate()
  const loginMutation = useLogin()
  const registerMutation = useRegister()
  const { data: registerStatus } = useRegisterEnabled()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'login') {
      loginMutation.mutate({ username, password }, { onSuccess: () => navigate('/') })
    } else {
      if (!registerStatus?.enabled) return
      registerMutation.mutate(
        { username, password },
        { onSuccess: () => setMode('login') }
      )
    }
  }

  const error = loginMutation.error ?? registerMutation.error

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 border border-gray-200 dark:border-gray-800">
        <div className="text-center mb-6">
          <CaeroBrand subtitle={APP_TAGLINE} className="justify-center" />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input
              required
              autoFocus
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={loginMutation.isPending || registerMutation.isPending}
            className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
          {mode === 'login' ? (
            <>
              {registerStatus?.enabled ? (
                <>
                  No account?{' '}
                  <button
                    onClick={() => setMode('register')}
                    className="text-indigo-500 hover:underline"
                  >
                    Register
                  </button>
                </>
              ) : (
                null
              )}
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setMode('login')}
                className="text-indigo-500 hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
