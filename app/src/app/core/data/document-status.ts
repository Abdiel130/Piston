import type { DocumentType, IsoDate, VehicleDocument } from '../models';

/** Días antes del vencimiento en que un documento empieza a avisar. */
export const EXPIRING_DAYS = 30;

/** `ok`: vigente con holgura o sin fecha. `expiring`: vence pronto. `expired`: ya venció. */
export type DocumentStatus = 'ok' | 'expiring' | 'expired';

/** Nombre corto de cada tipo, para listas y avisos. */
export const DOCUMENT_LABEL: Record<DocumentType, string> = {
  insurance: 'Seguro',
  emissions_check: 'Verificación',
  ownership_tax: 'Tenencia',
  circulation_card: 'Tarjeta de circulación',
  driver_license: 'Licencia',
  warranty: 'Garantía',
  other: 'Documento',
};

/**
 * Días de `today` a `expiresAt`, ambos `YYYY-MM-DD`. Negativo si ya pasó.
 * Se cuenta en UTC para que un cambio de horario no robe ni regale un día.
 */
export function daysUntil(expiresAt: IsoDate, today: IsoDate): number {
  return Math.round((Date.parse(`${expiresAt.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** El documento vale todo el día en que vence; al siguiente ya está vencido. */
export function documentStatus(expiresAt: IsoDate | null, today: IsoDate): DocumentStatus {
  if (!expiresAt) return 'ok';
  const days = daysUntil(expiresAt, today);
  if (days < 0) return 'expired';
  return days <= EXPIRING_DAYS ? 'expiring' : 'ok';
}

/** Vigente = no borrado y sin otro que lo reemplace. Solo estos avisan. */
export function isCurrent(document: VehicleDocument): boolean {
  return !document.deleted_at && !document.renewed_by_id;
}

/** "Vence hoy", "Vence en 12 días", "Venció hace 3 días". */
export function expiryLabel(expiresAt: IsoDate, today: IsoDate): string {
  const days = daysUntil(expiresAt, today);
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  if (days === -1) return 'Venció ayer';
  return days > 0 ? `Vence en ${days} días` : `Venció hace ${-days} días`;
}

/** `YYYY-MM-DD` más N meses. Del 29 de febrero cae al 28 si el año no es bisiesto. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}
