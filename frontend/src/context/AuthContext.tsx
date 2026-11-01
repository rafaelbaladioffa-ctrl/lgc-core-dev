import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode';
import { api } from '../api/client';

interface AccessTokenClaims {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
  collaboratorId: string | null;
  mustChangePassword: boolean;
}

interface AuthState {
  user: AccessTokenClaims | null;
  login: (email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function decodeStoredToken(): AccessTokenClaims | null {
  const token = localStorage.getItem('axis_access_token');
  if (!token) return null;
  try {
    return jwtDecode<AccessTokenClaims>(token);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccessTokenClaims | null>(() => decodeStoredToken());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUser(decodeStoredToken());
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('axis_access_token', data.accessToken);
      localStorage.setItem('axis_refresh_token', data.refreshToken);
      setUser(jwtDecode<AccessTokenClaims>(data.accessToken));
    } finally {
      setLoading(false);
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const { data } = await api.post('/auth/change-password', { currentPassword, newPassword });
    localStorage.setItem('axis_access_token', data.accessToken);
    localStorage.setItem('axis_refresh_token', data.refreshToken);
    setUser(jwtDecode<AccessTokenClaims>(data.accessToken));
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('axis_refresh_token');
    try {
      if (refreshToken) await api.post('/auth/logout', { refreshToken });
    } finally {
      localStorage.removeItem('axis_access_token');
      localStorage.removeItem('axis_refresh_token');
      setUser(null);
    }
  };

  const hasPermission = (permission: string) => user?.permissions.includes(permission) ?? false;

  const value = useMemo(() => ({ user, login, changePassword, logout, hasPermission, loading }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
