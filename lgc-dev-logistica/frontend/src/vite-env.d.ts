/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** URL do Axis core (login/refresh). Ex.: https://axis.exemplo.com.br/api/v1 */
  readonly VITE_AXIS_URL?: string;
}
