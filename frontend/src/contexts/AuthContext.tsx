import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

export interface User {
  id: number
  email: string
  full_name: string | null
  role: string
  is_active: boolean
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, fullName?: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
  isReady: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

const TOKEN_KEY = 'medimage_token'
const REFRESH_KEY = 'medimage_refresh'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [isReady, setIsReady] = useState(false)

  const api = async (path: string, options: RequestInit = {}) => {
    const t = localStorage.getItem(TOKEN_KEY)
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...options.headers,
      },
    })
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_KEY)
      setToken(null)
      setUser(null)
      throw new Error('Unauthorized')
    }
    return res
  }

  const refreshUser = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (!t) {
      setIsReady(true)
      return
    }
    try {
      const res = await api('/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data)
      } else {
        setToken(null)
        setUser(null)
      }
    } catch {
      setToken(null)
      setUser(null)
    } finally {
      setIsReady(true)
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    setToken(data.access_token)
    await refreshUser()
  }, [refreshUser])

  const signup = useCallback(async (email: string, password: string, fullName?: string) => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: fullName || null }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Signup failed')
    }
    const data = await res.json()
    localStorage.setItem(TOKEN_KEY, data.access_token)
    localStorage.setItem(REFRESH_KEY, data.refresh_token)
    setToken(data.access_token)
    await refreshUser()
  }, [refreshUser])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, login, signup, logout, refreshUser, isReady }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
