import type { FuelGrade, StickerColor, Transmission, VehicleStatus, VehicleType } from '../../core/models';

/** Opciones de los selectores de vehículo. Las comparten el wizard y Ajustes. */
export interface Option<T> {
  readonly value: T;
  readonly label: string;
}

export const VEHICLE_TYPES: readonly Option<VehicleType>[] = [
  { value: 'car', label: 'Auto' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'motorcycle', label: 'Moto' },
  { value: 'van', label: 'Van' },
  { value: 'truck', label: 'Camión' },
];

export const TRANSMISSIONS: readonly Option<Transmission>[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'automatic', label: 'Automática' },
  { value: 'cvt', label: 'CVT' },
  { value: 'dsg', label: 'Doble embrague' },
];

export const STICKERS: readonly (Option<StickerColor> & { readonly swatch: string })[] = [
  { value: 'yellow', label: 'Amarillo', swatch: '#FFD60A' },
  { value: 'pink', label: 'Rosa', swatch: '#FF6FB5' },
  { value: 'red', label: 'Rojo', swatch: '#FF453A' },
  { value: 'green', label: 'Verde', swatch: '#32D74B' },
  { value: 'blue', label: 'Azul', swatch: '#0A84FF' },
  { value: 'none', label: 'Ninguno', swatch: 'transparent' },
];

export const FUEL_GRADES: readonly Option<FuelGrade>[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diésel' },
];

export const VEHICLE_STATUSES: readonly Option<VehicleStatus>[] = [
  { value: 'active', label: 'Activo' },
  { value: 'archived', label: 'Archivado' },
  { value: 'sold', label: 'Vendido' },
];

export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 16;
export const MIN_YEAR = 1950;
