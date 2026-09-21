/**
 * Backoff exponencial con jitter para los reintentos del outbox.
 *
 * El jitter no es cosmético: sin él, varios dispositivos que perdieron la red
 * a la vez la recuperan a la vez y reintentan en el mismo instante, justo
 * cuando el servidor está más frágil. Un ±20% aleatorio los desalinea.
 */

/** Primer reintento a los 5 s. */
const BASE_DELAY_MS = 5_000;

/** Tope: 10 minutos. Más allá, reintentar más seguido no aporta nada. */
const MAX_DELAY_MS = 600_000;

/** A partir de aquí la mutación se marca `failed` y espera intervención. */
export const MAX_ATTEMPTS = 12;

export function backoffDelayMs(attempts: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

/** Momento del próximo intento, en ISO, listo para guardar en el outbox. */
export function nextRetryAt(attempts: number, from: Date = new Date()): string {
  return new Date(from.getTime() + backoffDelayMs(attempts)).toISOString();
}
