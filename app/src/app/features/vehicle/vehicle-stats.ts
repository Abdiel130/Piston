import { parseDay } from '../../core/format';
import type { Expense, FuelEntry, ServiceRecord } from '../../core/models';

export interface VehicleStatsInput {
  readonly fuel: readonly FuelEntry[];
  readonly services: readonly ServiceRecord[];
  readonly expenses: readonly Expense[];
  readonly currentOdometerKm: number | null;
  /** `YYYY-MM-DD`. Corte para el promedio mensual. */
  readonly today: string;
}

export interface VehicleStats {
  /** Km/L ponderado por distancia: un tramo largo pesa más que uno corto. */
  readonly kmPerLiter: number | null;
  /** Costo de combustible por km, ponderado igual. */
  readonly costPerKm: number | null;
  readonly fuelSpent: number;
  readonly servicesSpent: number;
  readonly otherSpent: number;
  readonly totalSpent: number;
  /** Total entre los meses desde el primer registro, contando el actual. */
  readonly monthlySpent: number | null;
  /** Del odómetro más bajo registrado al actual. */
  readonly distanceKm: number | null;
  readonly fillUps: number;
  readonly since: string | null;
}

/**
 * Resumen de toda la vida registrada del vehículo. Solo suma lo guardado:
 * el rendimiento de cada carga ya lo calculó la captura, aquí se promedia.
 *
 * Los montos se suman tal cual; se asume una sola moneda por usuario.
 */
export function vehicleStats(input: VehicleStatsInput): VehicleStats {
  const alive = <T extends { deleted_at: string | null }>(rows: readonly T[]) => rows.filter((row) => !row.deleted_at);
  const fuel = alive(input.fuel);
  const services = alive(input.services);
  const expenses = alive(input.expenses);

  // Solo tramos con rendimiento confiable entran al promedio.
  const legs = fuel.filter(
    (entry) => entry.distance_km && entry.km_per_liter && !entry.is_efficiency_outlier,
  );
  const legKm = legs.reduce((sum, entry) => sum + entry.distance_km!, 0);
  const legLiters = legs.reduce((sum, entry) => sum + entry.distance_km! / entry.km_per_liter!, 0);
  const costed = legs.filter((entry) => entry.cost_per_km !== null);
  const costedKm = costed.reduce((sum, entry) => sum + entry.distance_km!, 0);
  const costedCost = costed.reduce((sum, entry) => sum + entry.cost_per_km! * entry.distance_km!, 0);

  const fuelSpent = round2(fuel.reduce((sum, entry) => sum + (entry.amount_paid ?? 0), 0));
  const servicesSpent = round2(services.reduce((sum, record) => sum + record.total_cost, 0));
  const otherSpent = round2(expenses.reduce((sum, expense) => sum + expense.amount, 0));
  const totalSpent = round2(fuelSpent + servicesSpent + otherSpent);

  const dates = [
    ...fuel.map((entry) => entry.filled_at.slice(0, 10)),
    ...services.map((record) => record.performed_at),
    ...expenses.map((expense) => expense.spent_at),
  ].sort();
  const since = dates[0] ?? null;

  const odometers = [
    ...fuel.map((entry) => entry.odometer_km),
    ...services.map((record) => record.odometer_km),
    ...expenses.map((expense) => expense.odometer_km),
  ].filter((km): km is number => typeof km === 'number');
  const lowest = odometers.length ? Math.min(...odometers) : null;
  const highest = Math.max(input.currentOdometerKm ?? 0, ...odometers);

  return {
    kmPerLiter: legLiters > 0 ? round2(legKm / legLiters) : null,
    costPerKm: costedKm > 0 ? round2(costedCost / costedKm) : null,
    fuelSpent,
    servicesSpent,
    otherSpent,
    totalSpent,
    monthlySpent: since ? round2(totalSpent / monthsBetween(since, input.today)) : null,
    distanceKm: lowest !== null && highest > lowest ? highest - lowest : null,
    fillUps: fuel.length,
    since,
  };
}

/** Meses calendario de `from` a `to`, ambos incluidos. Mínimo uno. */
export function monthsBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
  return Math.max(1, months);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
