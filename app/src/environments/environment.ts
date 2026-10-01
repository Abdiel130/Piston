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

  /**
   * Revisión de respaldo (ms). NO es el mecanismo principal: el sync reacciona
   * a cada cambio y reintenta con backoff mientras haya pendientes. Esto solo
   * atrapa lo que ningún evento haya disparado (un bug), y no toca la red si
   * no hay nada por subir.
   */
  syncSafetyIntervalMs: 600_000,
} as const;
