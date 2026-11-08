import { useCallback, useEffect, useState } from 'react';

/** Tema claro/escuro do Axis: mesma chave e mesmo atributo do Core (ThemeContext.tsx), para o app lembrar a escolha. */
export type Theme = 'light' | 'dark';

const THEME_KEY = 'axis_theme';

export function readStoredTheme(storage: Pick<Storage, 'getItem'> = localStorage): Theme {
  try {
    const stored = storage.getItem(THEME_KEY);
    return stored === 'dark' || stored === 'light' ? stored : 'light';
  } catch {
    return 'light';
  }
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* sem armazenamento: o tema vale só nesta aba */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), []);
  return { theme, toggleTheme };
}
