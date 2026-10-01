/**
 * Formato de cifras y fechas para pantalla. Sin cálculos: solo presenta lo
 * que ya está guardado. `null` se muestra como "—", nunca como 0: un dato que
 * falta no es un dato que vale cero.
 */

const numberFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const integerFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
const monthYear = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });

export const EMPTY = '—';

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatNumber(value: unknown): string {
  return isNumber(value) ? numberFormat.format(value) : EMPTY;
}

export function formatKm(value: unknown): string {
  return isNumber(value) ? `${integerFormat.format(value)} km` : EMPTY;
}

export function formatLiters(value: unknown): string {
  return isNumber(value) ? `${numberFormat.format(value)} L` : EMPTY;
}

export function formatMoney(value: unknown, currency = 'MXN'): string {
  if (!isNumber(value)) return EMPTY;
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(value);
}

/**
 * Una fecha sin hora ("2026-09-12") se interpretaría como UTC y en México
 * caería el día anterior; se ancla a mediodía local.
 */
export function parseDay(value: string): Date {
  return new Date(value.length === 10 ? `${value}T12:00:00` : value);
}

export function formatShortDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return EMPTY;
  const date = parseDay(value);
  return Number.isNaN(date.getTime()) ? EMPTY : shortDate.format(date);
}

export function formatLongDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return EMPTY;
  const date = parseDay(value);
  return Number.isNaN(date.getTime()) ? EMPTY : longDate.format(date);
}

export function formatMonth(date: Date): string {
  const label = monthYear.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** `YYYY-MM-DD` local de hoy, para inputs `type=date` y columnas `date`. */
export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Primer día del mes en curso como `YYYY-MM-DD`: el corte de "este mes". */
export function monthStartIso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}
