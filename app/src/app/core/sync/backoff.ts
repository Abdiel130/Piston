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

// Sin tope de intentos a propósito: un fallo transitorio (sin red, servidor
// caído) se reintenta para siempre cada ≤10 min. Solo un rechazo definitivo del
// servidor saca una mutación de la cola activa.

export function backoffDelayMs(attempts: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
  const jitter = exponential * 0.2 * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

/**
 * Momento del próximo intento, en ISO, listo para guardar en el outbox.
 *
 * `minDelayMs` respeta un `Retry-After` del servidor: si pidió esperar más de
 * lo que daría el backoff, gana el servidor.
 */
export function nextRetryAt(attempts: number, from: Date = new Date(), minDelayMs = 0): string {
  return new Date(from.getTime() + Math.max(backoffDelayMs(attempts), minDelayMs)).toISOString();
}
