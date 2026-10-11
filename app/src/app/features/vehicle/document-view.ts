import type { DocumentStatus } from '../../core/data/document-status';
import type { VehicleDocument } from '../../core/models';

/** Clase del badge según el estado de vigencia. */
export const STATUS_BADGE: Record<DocumentStatus, string> = {
  ok: 'pst-badge--good',
  expiring: 'pst-badge--warn',
  expired: 'pst-badge--bad',
};

/** El que vence más tarde primero. Sin fecha, al final. */
export function byExpiry(a: VehicleDocument, b: VehicleDocument): number {
  return (b.expires_at ?? '').localeCompare(a.expires_at ?? '');
}
