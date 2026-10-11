import type { IsoDate, StickerColor, Vehicle } from '../../core/models';

type VerifiableSticker = Exclude<StickerColor, 'none'>;

/**
 * Calendario de verificación de la megalópolis (CDMX y Edomex): dos periodos
 * de dos meses al año según el engomado. Meses de 1 a 12.
 */
const PERIODS: Record<VerifiableSticker, readonly [readonly [number, number], readonly [number, number]]> = {
  yellow: [[1, 2], [7, 8]],
  pink: [[2, 3], [8, 9]],
  red: [[3, 4], [9, 10]],
  green: [[4, 5], [10, 11]],
  blue: [[5, 6], [11, 12]],
};

/** El engomado sale del último dígito de la placa. */
const STICKER_BY_DIGIT: readonly VerifiableSticker[] = [
  'blue', 'green', 'green', 'red', 'red', 'yellow', 'yellow', 'pink', 'pink', 'blue',
];

const STICKER_NAME: Record<VerifiableSticker, string> = {
  yellow: 'amarillo',
  pink: 'rosa',
  red: 'rojo',
  green: 'verde',
  blue: 'azul',
};

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface EmissionsPeriod {
  readonly sticker: VerifiableSticker;
  readonly months: readonly (readonly [number, number])[];
}

type VehicleLike = Pick<Vehicle, 'emissions_sticker' | 'plate_last_digit'>;

/** El engomado manda; sin él, se deduce de la placa. Sin ninguno, null. */
export function emissionsPeriod(vehicle: VehicleLike | null): EmissionsPeriod | null {
  if (!vehicle) return null;
  const sticker =
    vehicle.emissions_sticker !== 'none'
      ? vehicle.emissions_sticker
      : vehicle.plate_last_digit !== null
        ? STICKER_BY_DIGIT[vehicle.plate_last_digit]
        : null;
  return sticker ? { sticker, months: PERIODS[sticker] } : null;
}

/**
 * Hasta cuándo vale una verificación hecha en `from`: el último día del
 * primer periodo que empieza después. Hecha en julio (periodo amarillo) vale
 * hasta el 28 de febrero; renovada desde el 31 de agosto, igual.
 */
export function nextEmissionsDeadline(vehicle: VehicleLike | null, from: IsoDate): IsoDate | null {
  const period = emissionsPeriod(vehicle);
  if (!period) return null;
  const [year, month] = from.slice(0, 10).split('-').map(Number);
  for (const offset of [0, 1]) {
    for (const [start, end] of period.months) {
      if (offset === 0 && start <= month) continue;
      return lastDayOf(year + offset, end);
    }
  }
  return null;
}

/** "enero–febrero y julio–agosto (engomado amarillo)". */
export function periodLabel(period: EmissionsPeriod): string {
  const months = period.months.map(([start, end]) => `${MONTHS[start - 1]}–${MONTHS[end - 1]}`).join(' y ');
  return `${months} (engomado ${STICKER_NAME[period.sticker]})`;
}

function lastDayOf(year: number, month: number): IsoDate {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
