import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLogin, useRegister, useRegisterEnabled } from '../api/hooks'
import CaeroBrand from '../components/CaeroBrand'

export default function Login() {
  const navigate = useNavigate()
  const loginMutation = useLogin()
  const registerMutation = useRegister()
  const { data: registerStatus } = useRegisterEnabled()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [registerPasswordError, setRegisterPasswordError] = useState<string | null>(null)
  const [registrationSuccess, setRegistrationSuccess] = useState(false)

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode)
    setRegisterPasswordError(null)
    setRegistrationSuccess(false)
    loginMutation.reset()
    registerMutation.reset()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setRegisterPasswordError(null)
    if (mode === 'login') {
      loginMutation.mutate({ username, password }, { onSuccess: () => navigate('/') })
    } else {
      if (!registerStatus?.enabled) return
      if (password.length < 5) {
        setRegisterPasswordError('Password must be at least 5 characters long.')
        return
      }
      registerMutation.mutate(
        { username, password },
        { onSuccess: () => {
          setRegistrationSuccess(true)
          setMode('login')
        } }
      )
    }
  }

  const error = registerPasswordError ?? loginMutation.error?.message ?? registerMutation.error?.message
  const message = registrationSuccess ? 'Account created, please login' : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 border border-gray-200 dark:border-gray-800">
        <div className="text-center mb-6">
          <CaeroBrand showText={false} logoSizeClassName="h-32 w-32 sm:h-40 sm:w-40" className="justify-center" />
        </div>

        {message && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm mb-4">
            {message}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input
              id="login-username"
              required
              autoFocus
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input
              id="login-password"
              required
              type="password"
              minLength={5}
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
                    type="button"
                    onClick={() => switchMode('register')}
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
                type="button"
                onClick={() => switchMode('login')}
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
