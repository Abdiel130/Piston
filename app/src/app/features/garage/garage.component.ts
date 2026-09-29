import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import {
  EMPTY,
  formatKm,
  formatMoney,
  formatNumber,
  formatShortDate,
  monthStartIso,
} from '../../core/format';
import type { Expense, FuelEntry, MaintenanceSchedule, ServiceRecord, ServiceType } from '../../core/models';
import { GaugeComponent } from '../../shared/gauge/gauge.component';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { SCHEDULE_TONE, scheduleDue } from '../service/schedule-display';

interface HealthItem {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly tone: 'good' | 'warn' | 'bad' | 'idle';
  readonly status: string;
}

interface ActivityItem {
  readonly id: string;
  readonly icon: IconName;
  readonly title: string;
  readonly sub: string;
  readonly amount: string;
  readonly at: string;
}

interface GarageData {
  readonly fuel: FuelEntry[];
  readonly services: ServiceRecord[];
  readonly expenses: Expense[];
  readonly schedules: MaintenanceSchedule[];
  readonly serviceTypes: Map<string, ServiceType>;
  readonly latestReadingKm: number | null;
}

const EMPTY_DATA: GarageData = {
  fuel: [],
  services: [],
  expenses: [],
  schedules: [],
  serviceTypes: new Map(),
  latestReadingKm: null,
};

/**
 * Garage: el vehículo activo de un vistazo. Todo sale de IndexedDB; las
 * métricas derivadas (rendimiento, costo por km) muestran lo que ya trae la
 * carga guardada, o "—" mientras no existan los cálculos.
 */
@Component({
  selector: 'pst-garage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, GaugeComponent, RouterLink],
  templateUrl: './garage.component.html',
  styleUrl: './garage.component.scss',
})
export class GarageComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly auth = inject(AuthService);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  private readonly currency = computed(() => this.auth.user()?.currency ?? 'MXN');

  private readonly data = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId): Promise<GarageData> => {
      if (!vehicleId) return EMPTY_DATA;
      const alive = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((row) => !row.deleted_at);
      const [fuel, services, expenses, schedules, serviceTypes, readings] = await Promise.all([
        db.fuel_entries.where('vehicle_id').equals(vehicleId).toArray(),
        db.service_records.where('vehicle_id').equals(vehicleId).toArray(),
        db.expenses.where('vehicle_id').equals(vehicleId).toArray(),
        db.maintenance_schedules.where('vehicle_id').equals(vehicleId).toArray(),
        db.service_types.toArray(),
        db.odometer_readings.where('[vehicle_id+km]').between([vehicleId, -Infinity], [vehicleId, Infinity]).toArray(),
      ]);
      const liveReadings = alive(readings);
      return {
        fuel: alive(fuel).sort((a, b) => b.filled_at.localeCompare(a.filled_at)),
        services: alive(services).sort((a, b) => b.performed_at.localeCompare(a.performed_at)),
        expenses: alive(expenses).sort((a, b) => b.spent_at.localeCompare(a.spent_at)),
        schedules: alive(schedules).filter((schedule) => schedule.is_active),
        serviceTypes: new Map(serviceTypes.map((type) => [type.id, type])),
        latestReadingKm: liveReadings.length ? liveReadings[liveReadings.length - 1].km : null,
      };
    },
    EMPTY_DATA,
  );

  private readonly lastFuel = computed(() => this.data().fuel[0] ?? null);

  protected readonly segments = computed(() => this.vehicle()?.gauge_total_segments ?? 8);
  protected readonly gaugeValue = computed(() => this.lastFuel()?.gauge_after ?? null);
  protected readonly gaugeCaption = computed(() => {
    const value = this.gaugeValue();
    return value === null ? EMPTY : `${formatNumber(value)}/${this.segments()}`;
  });

  protected readonly odometer = computed(() => {
    const vehicle = this.vehicle();
    const reading = this.data().latestReadingKm;
    const cached = vehicle?.current_odometer_km ?? null;
    return reading === null ? cached : Math.max(reading, cached ?? 0);
  });

  protected readonly plate = computed(() => this.vehicle()?.license_plate ?? null);
  protected readonly yearTrim = computed(() => {
    const vehicle = this.vehicle();
    return vehicle ? [vehicle.year, vehicle.trim].filter(Boolean).join(' · ') : '';
  });

  /** Lo guardado en la última carga. Sin cálculos nuevos. */
  protected readonly stats = computed(() => {
    const monthStart = monthStartIso();
    const monthFuel = this.data().fuel.filter((entry) => entry.filled_at.slice(0, 10) >= monthStart);
    const spent = monthFuel.reduce((sum, entry) => sum + (entry.amount_paid ?? 0), 0);
    return {
      efficiency: formatNumber(this.lastFuel()?.km_per_liter ?? null),
      costPerKm: formatMoney(this.lastFuel()?.cost_per_km ?? null, this.currency()),
      fuelSpent: monthFuel.length ? formatMoney(spent, this.currency()) : EMPTY,
      fillUps: String(monthFuel.length),
    };
  });

  protected readonly health = computed<HealthItem[]>(() =>
    this.data().schedules.map((schedule) => {
      const { tone, label } = SCHEDULE_TONE[schedule.status];
      return {
        id: schedule.id,
        name: this.data().serviceTypes.get(schedule.service_type_id)?.name ?? 'Servicio',
        detail: scheduleDue(schedule),
        tone,
        status: label,
      };
    }),
  );

  protected readonly activity = computed<ActivityItem[]>(() => {
    const currency = this.currency();
    const items: ActivityItem[] = [
      ...this.data().fuel.map((entry) => ({
        id: entry.id,
        icon: 'fuel' as IconName,
        title: 'Carga de combustible',
        sub: [formatShortDate(entry.filled_at), entry.liters !== null ? `${formatNumber(entry.liters)} L` : null]
          .filter(Boolean)
          .join(' · '),
        amount: formatMoney(entry.amount_paid, currency),
        at: entry.filled_at,
      })),
      ...this.data().services.map((record) => ({
        id: record.id,
        icon: 'wrench' as IconName,
        title: record.shop_name ?? 'Servicio',
        sub: [formatShortDate(record.performed_at), formatKm(record.odometer_km)].join(' · '),
        amount: formatMoney(record.total_cost, record.currency),
        at: record.performed_at,
      })),
      ...this.data().expenses.map((expense) => ({
        id: expense.id,
        icon: 'receipt' as IconName,
        title: expense.description ?? 'Gasto',
        sub: formatShortDate(expense.spent_at),
        amount: formatMoney(expense.amount, expense.currency),
        at: expense.spent_at,
      })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  });

  constructor() {
    effect(() => {
      const last = this.lastFuel();
      this.island.present({
        icon: 'fuel',
        label: 'Tanque',
        value: this.gaugeCaption(),
        tone: this.gaugeValue() === null ? 'idle' : 'good',
        title: 'Nivel de combustible',
        subtitle: last ? `${this.name()} · según la última carga` : `${this.name()} · sin cargas registradas`,
        details: [
          { label: 'Odómetro', value: formatKm(this.odometer()) },
          { label: 'Última carga', value: last ? formatShortDate(last.filled_at) : EMPTY },
          { label: 'Rendimiento', value: this.stats().efficiency },
        ],
      });
    });
  }

  protected readonly formatKm = formatKm;
}
