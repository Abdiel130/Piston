/**
 * Cuentas de la captura de una carga. Funciones puras: sin unidades de por
 * medio (quien llama decide si son litros o galones) y sin Angular.
 */

/** Monto pagado, precio por unidad de volumen y cantidad. */
export interface FuelTrio {
  readonly amount: number | null;
  readonly price: number | null;
  readonly liters: number | null;
}

/**
 * De dónde salió cada valor:
 * - `typed`: lo escribió el usuario.
 * - `derived`: sale de los otros dos.
 * - `suggested`: precio de una carga anterior del mismo combustible.
 */
export type TrioSource = 'typed' | 'derived' | 'suggested' | null;

export interface ResolvedTrio {
  readonly values: FuelTrio;
  readonly sources: Record<keyof FuelTrio, TrioSource>;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function positive(value: number | null): value is number {
  return value !== null && value > 0;
}

/**
 * Completa el trío con lo que se pueda deducir. Lo escrito siempre manda; el
 * precio sugerido solo entra cuando no hay otra forma de saber el precio, y
 * aun así basta con escribir encima para descartarlo.
 */
export function resolveTrio(typed: FuelTrio, suggestedPrice: number | null): ResolvedTrio {
  const { amount, liters } = typed;

  let price = typed.price;
  let priceSource: TrioSource = price !== null ? 'typed' : null;
  if (price === null && positive(amount) && positive(liters)) {
    price = round(amount / liters, 3);
    priceSource = 'derived';
  } else if (price === null && positive(suggestedPrice)) {
    price = suggestedPrice;
    priceSource = 'suggested';
  }

  const derivedLiters = liters === null && positive(amount) && positive(price) ? round(amount / price, 3) : null;
  const derivedAmount = amount === null && positive(liters) && positive(price) ? round(liters * price, 2) : null;

  return {
    values: {
      amount: amount ?? derivedAmount,
      price,
      liters: liters ?? derivedLiters,
    },
    sources: {
      amount: amount !== null ? 'typed' : derivedAmount !== null ? 'derived' : null,
      price: priceSource,
      liters: liters !== null ? 'typed' : derivedLiters !== null ? 'derived' : null,
    },
  };
}

export interface GaugeDeduction {
  /** Rayitas con las que arrancó, con decimales (la columna los admite). */
  readonly gauge: number;
  /** Litros que quedaban en el tanque antes de cargar. */
  readonly litersBefore: number;
}

/**
 * Con tanque lleno, lo que entró es lo que faltaba: con la capacidad del
 * tanque se sabe con cuánto se arrancó. Supone una aguja lineal; la
 * calibración por rayitas la afinará el motor de rendimiento.
 */
export function deduceGaugeBefore(
  litersLoaded: number | null,
  capacityLiters: number | null,
  segments: number,
): GaugeDeduction | null {
  if (!positive(litersLoaded) || !positive(capacityLiters) || segments <= 0) return null;
  const litersBefore = Math.max(0, capacityLiters - litersLoaded);
  return {
    gauge: round((litersBefore / capacityLiters) * segments, 2),
    litersBefore: round(litersBefore, 3),
  };
}

/**
 * Margen sobre la capacidad nominal antes de avisar: el cuello de llenado y
 * la tolerancia del fabricante admiten unos litros de más.
 */
export const TANK_OVERFILL_TOLERANCE = 1.1;

export function exceedsTank(litersLoaded: number | null, capacityLiters: number | null): boolean {
  return positive(litersLoaded) && positive(capacityLiters) && litersLoaded > capacityLiters * TANK_OVERFILL_TOLERANCE;
}
