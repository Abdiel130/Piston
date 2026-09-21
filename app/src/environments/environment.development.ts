/** Configuración de DESARROLLO: la API vive en otro puerto del mismo host. */
export const environment = {
  production: false,

  /** Puerto del contenedor `piston-server` (SERVER_PORT en el .env raíz). */
  apiBaseUrl: `http://${globalThis.location?.hostname ?? 'localhost'}:8088`,

  syncIntervalMs: 30_000,
} as const;
