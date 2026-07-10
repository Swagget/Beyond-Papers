import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@shared/types';
import { api, setToken, getToken } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string, isPseudonym: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<{ user: User }>('/api/auth/me');
      setUser(me.user);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/api/auth/login', { username, password });
    setToken(res.token);
    setUser(res.user);
  };

  const register = async (username: string, password: string, displayName: string, isPseudonym: boolean) => {
    const res = await api.post<{ token: string; user: User }>('/api/auth/register', {
      username,
      password,
      display_name: displayName,
      is_pseudonym: isPseudonym,
    });
    setToken(res.token);
    setUser(res.user);
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
