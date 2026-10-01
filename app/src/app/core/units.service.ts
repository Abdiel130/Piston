import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from './auth/auth.service';
import { EMPTY, formatMoney } from './format';
import {
  DEFAULT_PREFERENCES,
  distanceSymbol,
  efficiencySymbol,
  fromBaseCostPerDistance,
  fromBaseDistance,
  fromBaseEfficiency,
  fromBasePricePerVolume,
  fromBaseVolume,
  isDistanceUnit,
  isVolumeUnit,
  toBaseEfficiency,
  toBaseOdometer,
  toBasePricePerVolume,
  toBaseVolume,
  volumeSymbol,
  type UnitPreferences,
} from './units';

const integerFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Redondeo para precargar un input: sin colas de punto flotante. */
function round(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Las preferencias del usuario aplicadas a la pantalla.
 *
 * Lo guardado siempre está en km y litros (ver `units.ts`). Este servicio es
 * el único lugar donde la pantalla traduce: `format*` para mostrar, `input*`
 * para precargar un campo en la unidad del usuario y `to*` para devolver lo
 * escrito a la unidad base antes de guardar. Todo lee signals, así que dentro
 * de un `computed` se recalcula solo al cambiar la preferencia.
 */
@Injectable({ providedIn: 'root' })
export class UnitsService {
  private readonly auth = inject(AuthService);

  readonly preferences = computed<UnitPreferences>(() => {
    const user = this.auth.user();
    return {
      distance: isDistanceUnit(user?.distance_unit) ? user.distance_unit : DEFAULT_PREFERENCES.distance,
      volume: isVolumeUnit(user?.volume_unit) ? user.volume_unit : DEFAULT_PREFERENCES.volume,
      currency: user?.currency || DEFAULT_PREFERENCES.currency,
    };
  });

  readonly currency = computed(() => this.preferences().currency);
  readonly distanceSymbol = computed(() => distanceSymbol(this.preferences().distance));
  readonly volumeSymbol = computed(() => volumeSymbol(this.preferences().volume));
  readonly efficiencySymbol = computed(() => efficiencySymbol(this.preferences()));

  // ── Mostrar ───────────────────────────────────────────────────────────────

  /** Odómetro o distancia: "48,250 km" / "29,981 mi". */
  formatDistance(km: unknown): string {
    if (!isNumber(km)) return EMPTY;
    const value = fromBaseDistance(km, this.preferences().distance);
    return `${integerFormat.format(value)} ${this.distanceSymbol()}`;
  }

  formatVolume(liters: unknown): string {
    if (!isNumber(liters)) return EMPTY;
    const value = fromBaseVolume(liters, this.preferences().volume);
    return `${decimalFormat.format(value)} ${this.volumeSymbol()}`;
  }

  /** Solo la cifra del rendimiento; el símbolo va aparte en las tarjetas. */
  formatEfficiencyValue(kmPerLiter: unknown): string {
    if (!isNumber(kmPerLiter)) return EMPTY;
    return decimalFormat.format(fromBaseEfficiency(kmPerLiter, this.preferences())!);
  }

  formatEfficiency(kmPerLiter: unknown): string {
    const value = this.formatEfficiencyValue(kmPerLiter);
    return value === EMPTY ? EMPTY : `${value} ${this.efficiencySymbol()}`;
  }

  /** Precio por litro guardado, mostrado por unidad de volumen del usuario. */
  formatPricePerVolume(pricePerLiter: unknown): string {
    if (!isNumber(pricePerLiter)) return EMPTY;
    return formatMoney(fromBasePricePerVolume(pricePerLiter, this.preferences().volume), this.currency());
  }

  formatCostPerDistance(costPerKm: unknown): string {
    if (!isNumber(costPerKm)) return EMPTY;
    return formatMoney(fromBaseCostPerDistance(costPerKm, this.preferences().distance), this.currency());
  }

  /** Monto en la moneda del perfil, o en la que trae el registro. */
  formatMoney(value: unknown, currency?: string | null): string {
    return formatMoney(value, currency || this.currency());
  }

  // ── Inputs: base → unidad del usuario (para precargar) ─────────────────────

  inputDistance(km: number | null): number | null {
    return round(fromBaseDistance(km, this.preferences().distance), 0);
  }

  inputVolume(liters: number | null): number | null {
    return round(fromBaseVolume(liters, this.preferences().volume), 2);
  }

  /** Precio por litro guardado → precio por unidad de volumen del usuario. */
  inputPricePerVolume(pricePerLiter: number | null): number | null {
    return round(fromBasePricePerVolume(pricePerLiter, this.preferences().volume), 3);
  }

  inputEfficiency(kmPerLiter: number | null): number | null {
    return round(fromBaseEfficiency(kmPerLiter, this.preferences()), 2);
  }

  // ── Inputs: unidad del usuario → base (para guardar) ───────────────────────

  /** Odómetro: km ENTEROS, como las columnas del servidor. */
  toOdometerKm(value: number | null): number | null {
    return toBaseOdometer(value, this.preferences().distance);
  }

  /** Litros con dos decimales, como `decimal(…, 2)` en el servidor. */
  toLiters(value: number | null, digits = 2): number | null {
    return round(toBaseVolume(value, this.preferences().volume), digits);
  }

  /** Precio por unidad de volumen del usuario → precio por litro (`decimal(…, 3)`). */
  toPricePerLiter(value: number | null): number | null {
    return round(toBasePricePerVolume(value, this.preferences().volume), 3);
  }

  toKmPerLiter(value: number | null): number | null {
    return round(toBaseEfficiency(value, this.preferences()), 2);
  }
}
