import type { DocumentType } from '../../core/models';

/**
 * Cómo se captura y se nombra cada tipo de documento. El formulario y las
 * vistas son los mismos para todos; esto es lo único que cambia.
 *
 * Por ahora solo la póliza tiene vista (fase 2). Los demás tipos se agregan
 * aquí en la fase 3 de `docs/vehicle-section.md`.
 */
export interface DocumentKind {
  /** "póliza": va en minúsculas dentro de frases. */
  readonly noun: string;
  /** Femenino para "Nueva póliza" / "Nuevo documento". */
  readonly feminine: boolean;
  readonly issuerLabel: string;
  readonly issuerPlaceholder: string;
  readonly referenceLabel: string;
  /** Muestra cobertura y teléfonos de siniestro y asistencia. */
  readonly insurance: boolean;
  readonly expiresRequired: boolean;
  /** Meses de vigencia que propone al renovar. */
  readonly renewMonths: number;
}

const INSURANCE: DocumentKind = {
  noun: 'póliza',
  feminine: true,
  issuerLabel: 'Aseguradora',
  issuerPlaceholder: 'Qualitas',
  referenceLabel: 'Número de póliza',
  insurance: true,
  expiresRequired: true,
  renewMonths: 12,
};

const GENERIC: DocumentKind = {
  noun: 'documento',
  feminine: false,
  issuerLabel: 'Emisor',
  issuerPlaceholder: 'Gobierno del estado',
  referenceLabel: 'Folio',
  insurance: false,
  expiresRequired: false,
  renewMonths: 12,
};

export function documentKind(type: DocumentType): DocumentKind {
  return type === 'insurance' ? INSURANCE : GENERIC;
}
