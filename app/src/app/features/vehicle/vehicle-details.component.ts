import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { EMPTY, formatLongDate, formatNumber, todayIso } from '../../core/format';
import type { Expense, FuelEntry, ServiceRecord, Vehicle } from '../../core/models';
import { UnitsService } from '../../core/units.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { FUEL_GRADES, STICKERS, TRANSMISSIONS, VEHICLE_TYPES, type Option } from '../vehicles/vehicle-options';
import { vehicleStats } from './vehicle-stats';

interface SpecRow {
  readonly label: string;
  readonly value: string;
}

interface SpecGroup {
  readonly title: string;
  readonly rows: readonly SpecRow[];
}

interface DetailsData {
  readonly fuel: FuelEntry[];
  readonly services: ServiceRecord[];
  readonly expenses: Expense[];
}

const EMPTY_DATA: DetailsData = { fuel: [], services: [], expenses: [] };

/**
 * Datos del vehículo en gestión: su ficha completa y las cifras de toda su
 * vida registrada. Editar reusa el formulario de Ajustes y regresa aquí.
 */
@Component({
  selector: 'pst-vehicle-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './vehicle-details.component.html',
  styleUrls: ['../capture/capture.scss', './vehicle-details.component.scss'],
})
export class VehicleDetailsComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  protected readonly units = inject(UnitsService);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;

  private readonly data = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId): Promise<DetailsData> => {
      if (!vehicleId) return EMPTY_DATA;
      const [fuel, services, expenses] = await Promise.all([
        db.fuel_entries.where('vehicle_id').equals(vehicleId).toArray(),
        db.service_records.where('vehicle_id').equals(vehicleId).toArray(),
        db.expenses.where('vehicle_id').equals(vehicleId).toArray(),
      ]);
      return { fuel, services, expenses };
    },
    EMPTY_DATA,
  );

  private readonly stats = computed(() =>
    vehicleStats({
      ...this.data(),
      currentOdometerKm: this.vehicle()?.current_odometer_km ?? null,
      today: todayIso(),
    }),
  );

  protected readonly summary = computed(() => {
    const s = this.stats();
    const u = this.units;
    return {
      efficiency: u.formatEfficiencyValue(s.kmPerLiter),
      costPerKm: u.formatCostPerDistance(s.costPerKm),
      monthly: u.formatMoney(s.monthlySpent),
      total: s.since ? u.formatMoney(s.totalSpent) : EMPTY,
      distance: u.formatDistance(s.distanceKm),
      fillUps: String(s.fillUps),
      fuel: u.formatMoney(s.fuelSpent),
      services: u.formatMoney(s.servicesSpent),
      other: u.formatMoney(s.otherSpent),
      since: s.since ? formatLongDate(s.since) : null,
    };
  });

  protected readonly subtitle = computed(() => {
    const v = this.vehicle();
    return v ? [`${v.make} ${v.model}`, v.year, v.trim].filter(Boolean).join(' · ') : '';
  });

  protected readonly specs = computed<SpecGroup[]>(() => {
    const v = this.vehicle();
    return v ? this.toSpecs(v) : [];
  });

  constructor() {
    effect(() => {
      const v = this.vehicle();
      this.island.present({
        icon: 'car',
        label: 'Vehículo',
        value: this.units.formatDistance(v?.current_odometer_km ?? null),
        tone: v ? 'brand' : 'idle',
        title: this.name(),
        subtitle: this.subtitle() || 'Sin vehículo activo',
        details: [
          { label: 'Rendimiento', value: this.units.formatEfficiency(this.stats().kmPerLiter) },
          { label: 'Gasto al mes', value: this.summary().monthly },
          { label: 'Total', value: this.summary().total },
        ],
      });
    });
  }

  private toSpecs(v: Vehicle): SpecGroup[] {
    const u = this.units;
    const text = (value: string | null) => value || EMPTY;
    const withUnit = (value: number | null, symbol: string) =>
      value === null ? EMPTY : `${formatNumber(value)} ${symbol}`;
    const psi = (value: number | null) => (value === null ? EMPTY : `${value} PSI`);
    return [
      {
        title: 'General',
        rows: [
          { label: 'Marca', value: v.make },
          { label: 'Modelo', value: v.model },
          { label: 'Año', value: String(v.year) },
          { label: 'Versión', value: text(v.trim) },
          { label: 'Tipo', value: label(VEHICLE_TYPES, v.vehicle_type) },
          { label: 'Transmisión', value: label(TRANSMISSIONS, v.transmission) },
          { label: 'Motor', value: withUnit(v.engine_displacement_l, 'L') },
          { label: 'Color', value: text(v.color) },
        ],
      },
      {
        title: 'Placa y verificación',
        rows: [
          { label: 'Placa', value: text(v.license_plate) },
          { label: 'VIN', value: text(v.vin) },
          { label: 'Engomado', value: label(STICKERS, v.emissions_sticker) },
        ],
      },
      {
        title: 'Tanque y combustible',
        rows: [
          { label: 'Capacidad', value: u.formatVolume(v.tank_capacity_l) },
          { label: 'Rayitas del medidor', value: String(v.gauge_total_segments) },
          { label: 'Combustible', value: label(FUEL_GRADES, v.default_fuel_grade) },
          { label: 'Rendimiento de fábrica', value: u.formatEfficiency(v.factory_km_per_liter) },
        ],
      },
      {
        title: 'Mantenimiento',
        rows: [
          { label: 'Aceite', value: u.formatVolume(v.oil_capacity_l) },
          { label: 'Especificación', value: text(v.oil_spec) },
          { label: 'Llantas delanteras', value: psi(v.tire_pressure_front_psi) },
          { label: 'Llantas traseras', value: psi(v.tire_pressure_rear_psi) },
        ],
      },
      {
        title: 'Compra',
        rows: [
          { label: 'Fecha', value: formatLongDate(v.purchase_date) },
          { label: 'Precio', value: u.formatMoney(v.purchase_price) },
          { label: 'Odómetro', value: u.formatDistance(v.purchase_odometer_km) },
        ],
      },
    ];
  }
}

function label<T>(options: readonly Option<T>[], value: T | null): string {
  return options.find((option) => option.value === value)?.label ?? EMPTY;
}
