import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const ACCESS_TOKEN_KEY = "erp_access_token";
const REFRESH_TOKEN_KEY = "erp_refresh_token";
const SAVED_USERNAME_KEY = "erp_saved_username";

// Sempre em sessionStorage: a sessão nunca sobrevive a fechar o navegador/aba,
// login e senha são exigidos de novo a cada abertura.
export const tokenStorage = {
  getAccess: () => sessionStorage.getItem(ACCESS_TOKEN_KEY),
  getRefresh: () => sessionStorage.getItem(REFRESH_TOKEN_KEY),
  set: (access: string, refresh: string) => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, access);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  setAccess: (access: string) => sessionStorage.setItem(ACCESS_TOKEN_KEY, access),
  clear: () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// Apenas o nome de usuário (nunca a senha) pode ficar salvo entre sessões,
// só para preencher o campo automaticamente na tela de login.
export const savedUsername = {
  get: () => localStorage.getItem(SAVED_USERNAME_KEY) || "",
  set: (username: string) => localStorage.setItem(SAVED_USERNAME_KEY, username),
  clear: () => localStorage.removeItem(SAVED_USERNAME_KEY),
};

export const apiClient = axios.create({ baseURL: API_URL });

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStorage.getAccess();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = tokenStorage.getRefresh();
  if (!refresh) return null;

  // Só um 401 do próprio endpoint de refresh significa "sessão realmente
  // encerrada" (refresh token expirado/inválido/revogado). Qualquer outro
  // erro (rede instável, backend reiniciando, timeout) é transitório —
  // tenta mais algumas vezes antes de desistir, em vez de derrubar a
  // sessão por uma falha momentânea de conexão.
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { data } = await axios.post(`${API_URL}/token/refresh/`, { refresh });
      // ROTATE_REFRESH_TOKENS está ligado no backend: cada refresh devolve
      // um refresh token novo, que precisa ser salvo — senão o próximo
      // refresh usa um token velho e pode falhar quando o blacklist for
      // habilitado.
      if (data.refresh) {
        tokenStorage.set(data.access, data.refresh);
      } else {
        tokenStorage.setAccess(data.access);
      }
      return data.access as string;
    } catch (err: unknown) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 401) {
        tokenStorage.clear();
        return null;
      }
      if (attempt === attempts) {
        // Mantém o token salvo — não é logout de verdade, só não deu pra
        // renovar agora; a próxima chamada tenta de novo.
        return null;
      }
      await delay(1200);
    }
  }
  return null;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 403) {
      return Promise.reject(
        Object.assign(error, { _isForbidden: true, message: "Você não tem permissão para realizar esta ação." })
      );
    }
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccess = await refreshPromise;
      if (newAccess) {
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return apiClient(originalRequest);
      }
      // Só manda pra tela de login se a sessão foi mesmo encerrada (token
      // limpo do storage por um 401 real) — se o token ainda está salvo, a
      // renovação só falhou por algo transitório, e um redirect aqui
      // derrubaria o usuário sem necessidade.
      if (!tokenStorage.getRefresh()) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export async function login(username: string, password: string) {
  const { data } = await axios.post(`${API_URL}/token/`, { username, password });
  tokenStorage.set(data.access, data.refresh);
  return data;
}

export async function logout() {
  const refresh = tokenStorage.getRefresh();
  // Invalida o refresh token no servidor antes de limpar o storage local.
  // Falha silenciosa intencional: se a rede estiver caída ou o token já
  // expirou, o logout local acontece de qualquer forma.
  if (refresh) {
    try {
      await axios.post(`${API_URL}/token/logout/`, { refresh });
    } catch {
      // silently ignored — logout local prossegue normalmente
    }
  }
  tokenStorage.clear();
}
