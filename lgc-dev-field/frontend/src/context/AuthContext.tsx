import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, tokenStorage } from "../api/client";
import { meApi } from "../api/resources";
import type { Me } from "../api/types";

interface AuthContextValue {
  user: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Desloga automaticamente após esse tempo sem nenhuma interação do usuário.
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokenStorage.getAccess();
    if (!token) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadUser() {
      // Só um 401 (token realmente inválido/expirado) significa "sessão
      // encerrada" — qualquer outro erro (rede instável, backend reiniciando
      // no exato momento do F5, timeout) é transitório e não pode derrubar
      // a sessão: por algumas tentativas, tenta de novo antes de desistir.
      const attempts = 3;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const me = await meApi.get();
          if (!cancelled) setUser(me);
          return;
        } catch (err: unknown) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status === 401) {
            tokenStorage.clear();
            if (!cancelled) setUser(null);
            return;
          }
          if (attempt === attempts) {
            // Mantém o token salvo (não é logout de verdade) — só não
            // conseguimos confirmar a sessão agora; um novo F5 resolve
            // assim que o backend responder.
            if (!cancelled) setUser(null);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
    }

    loadUser().finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function login(username: string, password: string) {
    await apiLogin(username, password);
    const me = await meApi.get();
    setUser(me);
  }

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  async function refreshUser() {
    const me = await meApi.get();
    setUser(me);
  }

  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    if (!user) return;

    let timer: ReturnType<typeof setTimeout>;
    function resetTimer() {
      clearTimeout(timer);
      timer = setTimeout(() => logoutRef.current(), INACTIVITY_TIMEOUT_MS);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer));

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
