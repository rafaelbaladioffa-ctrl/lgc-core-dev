import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('axis_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
// Requests that 401'd while a refresh was already in flight: queued here instead of being
// rejected outright, then replayed once the new token lands. Without this, only the first of
// several concurrent 401s (e.g. a page firing Promise.all([...]) on load) ever got retried — the
// rest failed for good even though the refresh succeeded moments later.
let pendingRequests: Array<(token: string | null) => void> = [];

function onRefreshed(token: string | null) {
  pendingRequests.forEach((callback) => callback(token));
  pendingRequests = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingRequests.push((token) => {
          if (!token) {
            reject(error);
            return;
          }
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(api(originalRequest));
        });
      });
    }

    isRefreshing = true;
    try {
      const refreshToken = localStorage.getItem('axis_refresh_token');
      if (!refreshToken) throw error;
      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
      localStorage.setItem('axis_access_token', data.accessToken);
      localStorage.setItem('axis_refresh_token', data.refreshToken);
      onRefreshed(data.accessToken);
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      onRefreshed(null);
      localStorage.removeItem('axis_access_token');
      localStorage.removeItem('axis_refresh_token');
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
