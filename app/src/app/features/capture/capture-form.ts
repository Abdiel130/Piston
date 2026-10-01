/** Utilidades compartidas por los formularios de captura. */

export function readText(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/** Número del input, o `null` si está vacío o no es número. Acepta coma decimal. */
export function readNumber(event: Event): number | null {
  const raw = readText(event).trim().replace(',', '.');
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Valor para `<input type="datetime-local">` en hora local. */
export function localDateTime(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** De `datetime-local` (hora local) a ISO UTC para guardar. */
export function toIso(localValue: string): string {
  return new Date(localValue).toISOString();
}

/**
 * Límites que reflejan las columnas del servidor (ver `SyncRegistry`). Validar
 * aquí evita capturar algo que el servidor va a rechazar horas después.
 */
export const LIMITS = {
  km: 2_147_483_647,
  liters: 99_999.999,
  money10: 99_999_999.99,
  price: 99_999.999,
} as const;

export type Errors<K extends string> = Partial<Record<K, string>>;
