import { useEffect, useState } from 'react';

/** Roteamento mínimo por hash (#/parametros/…): o nginx serve só o index.html, sem regra de fallback. */

const current = () => window.location.hash.replace(/^#/, '') || '/';

export function useHashPath(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const onChange = () => setPath(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

export function navigate(path: string) {
  window.location.hash = path;
}

/** "/parametros/:id" contra "/parametros/123" → { id: "123" }; sem casamento → null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('?')[0].split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}
