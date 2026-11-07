/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL da API do Core para login e refresh (ex.: https://axis.lgc.com.br/api/v1). */
  readonly VITE_AXIS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
