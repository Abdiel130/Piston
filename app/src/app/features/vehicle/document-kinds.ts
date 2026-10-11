import type { DocumentType } from '../../core/models';
import type { IconName } from '../../shared/icon/icon.component';

/**
 * Cómo se captura y se nombra cada tipo de documento. El formulario y las
 * vistas son los mismos para todos; esto es lo único que cambia.
 *
 * La póliza tiene vista propia (`/vehicle/insurance`); el resto se agrupa en
 * `/vehicle/documents` en el orden de `OTHER_DOCUMENT_TYPES`.
 */
export interface DocumentKind {
  /** Título del grupo en la vista: "Tenencia o refrendo". */
  readonly label: string;
  readonly icon: IconName;
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
  /** Ayuda bajo los archivos del formulario. */
  readonly filesHint: string;
  /** Ejemplo de título para un archivo. */
  readonly fileTitlePlaceholder: string;
}

const OFFLINE = 'Se ven sin conexión y se suben solos cuando hay señal.';

const KINDS: Record<DocumentType, DocumentKind> = {
  insurance: {
    label: 'Póliza de seguro',
    icon: 'shield',
    noun: 'póliza',
    feminine: true,
    issuerLabel: 'Aseguradora',
    issuerPlaceholder: 'Qualitas',
    referenceLabel: 'Número de póliza',
    insurance: true,
    expiresRequired: true,
    renewMonths: 12,
    filesHint: `El PDF, fotos o capturas de la aseguradora (ej. cómo reportar un siniestro), cada uno con su título y notas. ${OFFLINE}`,
    fileTitlePlaceholder: 'Título (ej. ¿Cómo reportar un siniestro?)',
  },
  emissions_check: {
    label: 'Verificación',
    icon: 'spark',
    noun: 'verificación',
    feminine: true,
    issuerLabel: 'Verificentro',
    issuerPlaceholder: 'AG-123',
    referenceLabel: 'Folio del certificado',
    insurance: false,
    expiresRequired: true,
    renewMonths: 6,
    filesHint: `Foto del certificado y del holograma. ${OFFLINE}`,
    fileTitlePlaceholder: 'Título (ej. Certificado)',
  },
  ownership_tax: {
    label: 'Tenencia o refrendo',
    icon: 'receipt',
    noun: 'tenencia',
    feminine: true,
    issuerLabel: 'Entidad',
    issuerPlaceholder: 'Ciudad de México',
    referenceLabel: 'Línea de captura',
    insurance: false,
    expiresRequired: true,
    renewMonths: 12,
    filesHint: `El comprobante de pago o el formato. ${OFFLINE}`,
    fileTitlePlaceholder: 'Título (ej. Comprobante de pago)',
  },
  circulation_card: {
    label: 'Tarjeta de circulación',
    icon: 'document',
    noun: 'tarjeta de circulación',
    feminine: true,
    issuerLabel: 'Entidad',
    issuerPlaceholder: 'Ciudad de México',
    referenceLabel: 'Folio',
    insurance: false,
    expiresRequired: false,
    renewMonths: 36,
    filesHint: `Foto de frente y reverso. ${OFFLINE}`,
    fileTitlePlaceholder: 'Título (ej. Frente)',
  },
  driver_license: {
    label: 'Licencia',
    icon: 'document',
    noun: 'licencia',
    feminine: true,
    issuerLabel: 'Entidad',
    issuerPlaceholder: 'Ciudad de México',
    referenceLabel: 'Número de licencia',
    insurance: false,
    // Hay licencias permanentes.
    expiresRequired: false,
    renewMonths: 36,
    filesHint: `Foto de frente y reverso. ${OFFLINE}`,
    fileTitlePlaceholder: 'Título (ej. Frente)',
  },
  warranty: {
    label: 'Garantía',
    icon: 'checkCircle',
    noun: 'garantía',
    feminine: true,
    issuerLabel: 'Agencia o taller',
    issuerPlaceholder: 'Agencia Nissan',
    referenceLabel: 'Folio o póliza',
    insurance: false,
    expiresRequired: false,
    renewMonths: 12,
    filesHint: `La póliza de garantía y sus condiciones. ${OFFLINE}`,
    fileTitlePlaceholder: 'Título (ej. Condiciones)',
  },
  other: {
    label: 'Otros',
    icon: 'document',
    noun: 'documento',
    feminine: false,
    issuerLabel: 'Emisor',
    issuerPlaceholder: 'Gobierno del estado',
    referenceLabel: 'Folio',
    insurance: false,
    expiresRequired: false,
    renewMonths: 12,
    filesHint: `El PDF o las fotos del documento. ${OFFLINE}`,
    fileTitlePlaceholder: 'Título',
  },
};

/** Los que viven en `/vehicle/documents`, en el orden de la vista. */
export const OTHER_DOCUMENT_TYPES: readonly DocumentType[] = [
  'emissions_check',
  'ownership_tax',
  'circulation_card',
  'driver_license',
  'warranty',
  'other',
];

export function documentKind(type: DocumentType): DocumentKind {
  return KINDS[type];
}
