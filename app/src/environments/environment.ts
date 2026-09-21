/**
 * Configuración de build de PRODUCCIÓN.
 *
 * En desarrollo este archivo se sustituye por `environment.development.ts`
 * (ver `fileReplacements` en angular.json).
 */
export const environment = {
  production: true,

  /**
   * Vacío = mismo origen que la app. En un despliegue real el frontend y la
   * API se sirven detrás del mismo dominio, así que cualquier URL absoluta
   * escrita aquí sería una bomba de tiempo.
   */
  apiBaseUrl: '',

  /** Cada cuánto intenta sincronizar en segundo plano (ms). */
  syncIntervalMs: 60_000,
} as const;
