/**
 * Unidades de medida y moneda.
 *
 * La regla de la app: **todo se guarda en unidades base** —kilómetros, litros
 * y sus derivadas (km/L, precio por litro, costo por km)—. Así lo guardado no
 * depende de cómo lo vio quien lo capturó, el servidor recibe siempre lo mismo
 * y cambiar la preferencia nunca obliga a migrar datos. La conversión ocurre
 * SOLO en el borde: al leer un input (`toBase…`) y al mostrar (`fromBase…`).
 *
 * Los factores son exactos por definición (milla internacional y galón
 * estadounidense), no aproximaciones.
 */

export type DistanceUnit = 'km' | 'mi';
export type VolumeUnit = 'L' | 'gal';

/** Unidad base de cada magnitud: la que se guarda en IndexedDB y en Postgres. */
export const BASE_DISTANCE: DistanceUnit = 'km';
export const BASE_VOLUME: VolumeUnit = 'L';
export const DEFAULT_CURRENCY = 'MXN';

export interface UnitDefinition<U extends string> {
  readonly code: U;
  /** Nombre para listas y selectores ("Kilómetros"). */
  readonly label: string;
  /** Símbolo junto a la cifra ("km"). */
  readonly symbol: string;
  /** Cuántas unidades base hay en una de esta unidad. */
  readonly toBase: number;
}

export const DISTANCE_UNITS: Readonly<Record<DistanceUnit, UnitDefinition<DistanceUnit>>> = {
  km: { code: 'km', label: 'Kilómetros', symbol: 'km', toBase: 1 },
  mi: { code: 'mi', label: 'Millas', symbol: 'mi', toBase: 1.609344 },
};

export const VOLUME_UNITS: Readonly<Record<VolumeUnit, UnitDefinition<VolumeUnit>>> = {
  L: { code: 'L', label: 'Litros', symbol: 'L', toBase: 1 },
  gal: { code: 'gal', label: 'Galones (EUA)', symbol: 'gal', toBase: 3.785411784 },
};

export interface CurrencyDefinition {
  readonly code: string;
  readonly label: string;
}

/** Monedas que se ofrecen. El servidor acepta cualquier ISO-4217 de 3 letras. */
export const CURRENCIES: readonly CurrencyDefinition[] = [
  { code: 'MXN', label: 'Peso mexicano' },
  { code: 'USD', label: 'Dólar estadounidense' },
  { code: 'CAD', label: 'Dólar canadiense' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GTQ', label: 'Quetzal' },
  { code: 'COP', label: 'Peso colombiano' },
  { code: 'CLP', label: 'Peso chileno' },
  { code: 'ARS', label: 'Peso argentino' },
  { code: 'PEN', label: 'Sol peruano' },
];

/** Cómo quiere ver las cifras el usuario. Sale del perfil. */
export interface UnitPreferences {
  readonly distance: DistanceUnit;
  readonly volume: VolumeUnit;
  readonly currency: string;
}

export const DEFAULT_PREFERENCES: UnitPreferences = {
  distance: BASE_DISTANCE,
  volume: BASE_VOLUME,
  currency: DEFAULT_CURRENCY,
};

export function isDistanceUnit(value: unknown): value is DistanceUnit {
  return typeof value === 'string' && value in DISTANCE_UNITS;
}

export function isVolumeUnit(value: unknown): value is VolumeUnit {
  return typeof value === 'string' && value in VOLUME_UNITS;
}

// ── Conversión ──────────────────────────────────────────────────────────────
// `null` entra, `null` sale: un dato que falta no se convierte en cero.

/** Distancia escrita por el usuario → km. */
export function toBaseDistance(value: number, unit: DistanceUnit): number;
export function toBaseDistance(value: number | null, unit: DistanceUnit): number | null;
export function toBaseDistance(value: number | null, unit: DistanceUnit): number | null {
  return value === null ? null : value * DISTANCE_UNITS[unit].toBase;
}

/** km guardados → distancia en la unidad del usuario. */
export function fromBaseDistance(km: number, unit: DistanceUnit): number;
export function fromBaseDistance(km: number | null, unit: DistanceUnit): number | null;
export function fromBaseDistance(km: number | null, unit: DistanceUnit): number | null {
  return km === null ? null : km / DISTANCE_UNITS[unit].toBase;
}

/** Volumen escrito por el usuario → litros. */
export function toBaseVolume(value: number, unit: VolumeUnit): number;
export function toBaseVolume(value: number | null, unit: VolumeUnit): number | null;
export function toBaseVolume(value: number | null, unit: VolumeUnit): number | null {
  return value === null ? null : value * VOLUME_UNITS[unit].toBase;
}

/** Litros guardados → volumen en la unidad del usuario. */
export function fromBaseVolume(liters: number, unit: VolumeUnit): number;
export function fromBaseVolume(liters: number | null, unit: VolumeUnit): number | null;
export function fromBaseVolume(liters: number | null, unit: VolumeUnit): number | null {
  return liters === null ? null : liters / VOLUME_UNITS[unit].toBase;
}

/**
 * Lectura de odómetro escrita por el usuario → km enteros.
 *
 * Las columnas de odómetro son enteras. Redondear aquí, y no al guardar, hace
 * que 30 000 mi queden como 48 280 km y se vean de vuelta como 30 000 mi.
 */
export function toBaseOdometer(value: number, unit: DistanceUnit): number;
export function toBaseOdometer(value: number | null, unit: DistanceUnit): number | null;
export function toBaseOdometer(value: number | null, unit: DistanceUnit): number | null {
  return value === null ? null : Math.round(toBaseDistance(value, unit));
}

/** Rendimiento: km/L ↔ distancia/volumen del usuario (mi/gal, km/gal…). */
export function fromBaseEfficiency(kmPerLiter: number | null, prefs: UnitPreferences): number | null {
  if (kmPerLiter === null) return null;
  return (kmPerLiter * VOLUME_UNITS[prefs.volume].toBase) / DISTANCE_UNITS[prefs.distance].toBase;
}

export function toBaseEfficiency(value: number | null, prefs: UnitPreferences): number | null {
  if (value === null) return null;
  return (value * DISTANCE_UNITS[prefs.distance].toBase) / VOLUME_UNITS[prefs.volume].toBase;
}

/** Precio por litro → precio por unidad de volumen del usuario. */
export function fromBasePricePerVolume(pricePerLiter: number | null, unit: VolumeUnit): number | null {
  return pricePerLiter === null ? null : pricePerLiter * VOLUME_UNITS[unit].toBase;
}

export function toBasePricePerVolume(value: number | null, unit: VolumeUnit): number | null {
  return value === null ? null : value / VOLUME_UNITS[unit].toBase;
}

/** Costo por km → costo por unidad de distancia del usuario. */
export function fromBaseCostPerDistance(costPerKm: number | null, unit: DistanceUnit): number | null {
  return costPerKm === null ? null : costPerKm * DISTANCE_UNITS[unit].toBase;
}

// ── Símbolos ────────────────────────────────────────────────────────────────

export function distanceSymbol(unit: DistanceUnit): string {
  return DISTANCE_UNITS[unit].symbol;
}

export function volumeSymbol(unit: VolumeUnit): string {
  return VOLUME_UNITS[unit].symbol;
}

/** "km/L", "mi/gal"… */
export function efficiencySymbol(prefs: UnitPreferences): string {
  return `${distanceSymbol(prefs.distance)}/${volumeSymbol(prefs.volume)}`;
}
