import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { EMPTY, formatNumber, formatShortDate } from '../../core/format';
import { UnitsService } from '../../core/units.service';
import type { FuelEntry, FuelStation } from '../../core/models';
import { GaugeComponent } from '../../shared/gauge/gauge.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface FuelRow {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly efficiency: string;
  /** Procedencia del rendimiento guardado. Se muestra SIEMPRE junto al número. */
  readonly method: { label: string; tone: string } | null;
}

const METHOD: Record<FuelEntry['efficiency_method'], { label: string; tone: string } | null> = {
  full_to_full: { label: 'Exacto', tone: 'good' },
  gauge_estimate: { label: 'Estimado', tone: 'idle' },
  none: null,
};

/**
 * Combustible: el historial real de cargas del vehículo activo. El rendimiento
 * que se muestra es el que trae cada carga guardada; sin cálculos todavía.
 */
@Component({
  selector: 'pst-fuel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, GaugeComponent, RouterLink],
  templateUrl: './fuel.component.html',
  styleUrl: './fuel.component.scss',
})
export class FuelComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  protected readonly units = inject(UnitsService);

  protected readonly vehicle = this.context.vehicle;

  private readonly data = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId) => {
      if (!vehicleId) return { entries: [] as FuelEntry[], stations: new Map<string, FuelStation>() };
      const [entries, stations] = await Promise.all([
        db.fuel_entries.where('vehicle_id').equals(vehicleId).toArray(),
        db.fuel_stations.toArray(),
      ]);
      return {
        entries: entries.filter((entry) => !entry.deleted_at).sort((a, b) => b.filled_at.localeCompare(a.filled_at)),
        stations: new Map(stations.map((station) => [station.id, station])),
      };
    },
    { entries: [] as FuelEntry[], stations: new Map<string, FuelStation>() },
  );

  private readonly last = computed(() => this.data().entries[0] ?? null);

  protected readonly segments = computed(() => this.vehicle()?.gauge_total_segments ?? 8);
  protected readonly gaugeValue = computed(() => this.last()?.gauge_after ?? null);

  protected readonly headline = computed(() => {
    return this.units.formatEfficiency(this.last()?.km_per_liter ?? null);
  });

  protected readonly stats = computed(() => {
    const entries = this.data().entries;
    const exact = entries.find((entry) => entry.efficiency_method === 'full_to_full' && entry.km_per_liter !== null);
    const estimate = entries.find((entry) => entry.efficiency_method === 'gauge_estimate' && entry.km_per_liter !== null);
    const priced = entries.find((entry) => entry.price_per_liter !== null);
    return {
      exact: this.units.formatEfficiencyValue(exact?.km_per_liter ?? null),
      estimate: this.units.formatEfficiencyValue(estimate?.km_per_liter ?? null),
      lastPrice: this.units.formatPricePerVolume(priced?.price_per_liter ?? null),
      count: String(entries.length),
    };
  });

  protected readonly rows = computed<FuelRow[]>(() =>
    this.data().entries.map((entry) => ({
      id: entry.id,
      title: (entry.station_id && this.data().stations.get(entry.station_id)?.name) || 'Carga de combustible',
      sub: [
        formatShortDate(entry.filled_at),
        entry.liters !== null ? this.units.formatVolume(entry.liters) : null,
        entry.amount_paid !== null ? this.units.formatMoney(entry.amount_paid) : null,
        entry.is_full_tank ? 'Tanque lleno' : null,
      ]
        .filter(Boolean)
        .join(' · '),
      efficiency: this.units.formatEfficiency(entry.km_per_liter),
      method: METHOD[entry.efficiency_method],
    })),
  );

  constructor() {
    effect(() => {
      const last = this.last();
      this.island.present({
        icon: 'gauge',
        label: 'Rendimiento',
        value: this.headline(),
        tone: last?.km_per_liter ? 'brand' : 'idle',
        title: 'Rendimiento de la última carga',
        subtitle: last ? `Carga del ${formatShortDate(last.filled_at)}` : 'Registra tu primera carga',
        details: [
          { label: 'Exacto', value: this.stats().exact },
          { label: 'Estimado', value: this.stats().estimate },
          { label: 'Cargas', value: this.stats().count },
        ],
      });
    });
  }

  protected gaugeCaption(): string {
    const value = this.gaugeValue();
    return value === null ? EMPTY : `${formatNumber(value)}/${this.segments()}`;
  }
}
