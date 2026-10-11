import { describe, expect, it } from 'vitest';
import type { Expense, FuelEntry, ServiceRecord } from '../../core/models';
import { monthsBetween, vehicleStats, type VehicleStatsInput } from './vehicle-stats';

const fuel = (fields: Partial<FuelEntry>): FuelEntry =>
  ({
    filled_at: '2026-09-01T10:00:00Z',
    odometer_km: 1000,
    amount_paid: null,
    distance_km: null,
    km_per_liter: null,
    cost_per_km: null,
    is_efficiency_outlier: false,
    deleted_at: null,
    ...fields,
  }) as FuelEntry;

const service = (fields: Partial<ServiceRecord>): ServiceRecord =>
  ({ performed_at: '2026-09-01', odometer_km: 1000, total_cost: 0, deleted_at: null, ...fields }) as ServiceRecord;

const expense = (fields: Partial<Expense>): Expense =>
  ({ spent_at: '2026-09-01', odometer_km: null, amount: 0, deleted_at: null, ...fields }) as Expense;

const input = (fields: Partial<VehicleStatsInput>): VehicleStatsInput => ({
  fuel: [],
  services: [],
  expenses: [],
  currentOdometerKm: null,
  today: '2026-10-10',
  ...fields,
});

describe('vehicleStats', () => {
  it('sin registros no inventa cifras', () => {
    const stats = vehicleStats(input({}));
    expect(stats.kmPerLiter).toBeNull();
    expect(stats.costPerKm).toBeNull();
    expect(stats.monthlySpent).toBeNull();
    expect(stats.distanceKm).toBeNull();
    expect(stats.totalSpent).toBe(0);
    expect(stats.since).toBeNull();
  });

  it('pondera el rendimiento por distancia', () => {
    // 300 km a 15 km/L (20 L) + 100 km a 10 km/L (10 L) = 400 km / 30 L.
    const stats = vehicleStats(
      input({
        fuel: [
          fuel({ distance_km: 300, km_per_liter: 15, cost_per_km: 1.6 }),
          fuel({ distance_km: 100, km_per_liter: 10, cost_per_km: 2.4 }),
        ],
      }),
    );
    expect(stats.kmPerLiter).toBe(13.33);
    expect(stats.costPerKm).toBe(1.8);
  });

  it('ignora atípicos y cargas borradas', () => {
    const stats = vehicleStats(
      input({
        fuel: [
          fuel({ distance_km: 200, km_per_liter: 12 }),
          fuel({ distance_km: 200, km_per_liter: 40, is_efficiency_outlier: true }),
          fuel({ distance_km: 200, km_per_liter: 2, deleted_at: '2026-09-02T00:00:00Z', amount_paid: 900 }),
        ],
      }),
    );
    expect(stats.kmPerLiter).toBe(12);
    expect(stats.fillUps).toBe(2);
    expect(stats.fuelSpent).toBe(0);
  });

  it('suma combustible, servicios y gastos', () => {
    const stats = vehicleStats(
      input({
        fuel: [fuel({ amount_paid: 800.5 }), fuel({ amount_paid: 700 })],
        services: [service({ total_cost: 1500 })],
        expenses: [expense({ amount: 250.25 })],
      }),
    );
    expect(stats.fuelSpent).toBe(1500.5);
    expect(stats.servicesSpent).toBe(1500);
    expect(stats.otherSpent).toBe(250.25);
    expect(stats.totalSpent).toBe(3250.75);
  });

  it('promedia el gasto por los meses desde el primer registro', () => {
    const stats = vehicleStats(
      input({
        fuel: [fuel({ filled_at: '2026-08-15T09:00:00Z', amount_paid: 900 })],
        expenses: [expense({ spent_at: '2026-10-01', amount: 300 })],
      }),
    );
    expect(stats.since).toBe('2026-08-15');
    expect(stats.monthlySpent).toBe(400);
  });

  it('mide la distancia del odómetro más bajo al actual', () => {
    const stats = vehicleStats(
      input({
        fuel: [fuel({ odometer_km: 12000 }), fuel({ odometer_km: 12500 })],
        services: [service({ odometer_km: 11800 })],
        currentOdometerKm: 13000,
      }),
    );
    expect(stats.distanceKm).toBe(1200);
  });
});

describe('monthsBetween', () => {
  it('cuenta ambos extremos y nunca baja de uno', () => {
    expect(monthsBetween('2026-10-01', '2026-10-10')).toBe(1);
    expect(monthsBetween('2026-08-31', '2026-10-01')).toBe(3);
    expect(monthsBetween('2025-12-15', '2026-01-02')).toBe(2);
    expect(monthsBetween('2026-11-01', '2026-10-10')).toBe(1);
  });
});
