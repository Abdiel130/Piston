import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import type { FuelEntry, FuelGrade, FuelInputMode, OdometerReading, Vehicle } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { LIMITS, blankToNull, localDateTime, readNumber, readText, toIso, type Errors } from './capture-form';

type Field = 'filled_at' | 'odometer_km' | 'quantity' | 'liters' | 'amount_paid' | 'price_per_liter';

const GRADES: readonly { value: FuelGrade; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diésel' },
];

/**
 * Captura de una carga. Guarda lo que el usuario escribió, tal cual: el
 * rendimiento y las estimaciones por rayitas las calculará el motor después.
 * Crea la carga y su lectura de odómetro en una sola transacción.
 */
@Component({
  selector: 'pst-fuel-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './fuel-capture.component.html',
  styleUrl: './capture.scss',
})
export class FuelCaptureComponent {
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly router = inject(Router);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  protected readonly grades = GRADES;

  protected readonly filledAt = signal(localDateTime());
  protected readonly odometer = signal<number | null>(null);
  protected readonly grade = signal<FuelGrade | null>(null);
  protected readonly liters = signal<number | null>(null);
  protected readonly amount = signal<number | null>(null);
  protected readonly price = signal<number | null>(null);
  protected readonly gaugeBefore = signal<number | null>(null);
  protected readonly gaugeAfter = signal<number | null>(null);
  protected readonly fullTank = signal(false);
  protected readonly notes = signal('');

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly segments = computed(() => this.vehicle()?.gauge_total_segments ?? 8);
  protected readonly ticks = computed(() => Array.from({ length: this.segments() + 1 }, (_, i) => i));
  protected readonly selectedGrade = computed(() => this.grade() ?? this.vehicle()?.default_fuel_grade ?? 'regular');
  protected readonly odometerHint = computed(() => this.vehicle()?.current_odometer_km ?? null);

  protected readonly errors = computed<Errors<Field>>(() => {
    const errors: Errors<Field> = {};
    const km = this.odometer();
    if (!this.filledAt()) errors.filled_at = 'Indica la fecha de la carga.';
    if (km === null) errors.odometer_km = 'Anota el odómetro.';
    else if (!Number.isInteger(km) || km < 0 || km > LIMITS.km) errors.odometer_km = 'Debe ser un número entero de km.';
    if (this.liters() === null && this.amount() === null && this.gaugeAfter() === null) {
      errors.quantity = 'Anota los litros, el monto o las rayitas después de cargar.';
    }
    if (this.liters() !== null && (this.liters()! <= 0 || this.liters()! > LIMITS.liters)) errors.liters = 'Litros fuera de rango.';
    if (this.amount() !== null && (this.amount()! <= 0 || this.amount()! > LIMITS.money10)) errors.amount_paid = 'Monto fuera de rango.';
    if (this.price() !== null && (this.price()! <= 0 || this.price()! > LIMITS.price)) errors.price_per_liter = 'Precio fuera de rango.';
    return errors;
  });

  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  protected setGauge(which: 'before' | 'after', value: number): void {
    const target = which === 'before' ? this.gaugeBefore : this.gaugeAfter;
    target.set(target() === value ? null : value);
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const vehicle = this.vehicle();
    if (!vehicle || !this.valid() || this.saving()) return;

    this.saving.set(true);
    this.saveError.set(null);
    const filledAt = toIso(this.filledAt());
    const km = this.odometer()!;
    const mode: FuelInputMode = this.liters() !== null ? 'by_liters' : this.amount() !== null ? 'by_amount' : 'by_segments';

    try {
      await this.store.transaction(['fuel_entries', 'odometer_readings', 'vehicles'], async () => {
        const entry = await this.store.create<FuelEntry>('fuel_entries', {
          user_id: null,
          vehicle_id: vehicle.id,
          station_id: null,
          filled_at: filledAt,
          odometer_km: km,
          fuel_grade: this.selectedGrade(),
          input_mode: mode,
          amount_paid: this.amount(),
          price_per_liter: this.price(),
          liters: this.liters(),
          gauge_before: this.gaugeBefore(),
          gauge_after: this.fullTank() ? this.segments() : this.gaugeAfter(),
          gauge_total_segments: this.segments(),
          is_full_tank: this.fullTank(),
          is_partial: !this.fullTank(),
          missed_previous: false,
          liters_before_est: null,
          liters_after_est: null,
          distance_km: null,
          km_per_liter: null,
          cost_per_km: null,
          efficiency_method: 'none',
          is_efficiency_outlier: false,
          recomputed_at: null,
          notes: blankToNull(this.notes()),
        });

        await this.store.create<OdometerReading>('odometer_readings', {
          user_id: null,
          vehicle_id: vehicle.id,
          read_at: filledAt,
          km,
          source: 'fuel',
          source_id: entry.id,
          is_suspect: false,
        });

        if (km > vehicle.current_odometer_km) {
          await this.store.update<Vehicle>('vehicles', vehicle.id, { current_odometer_km: km });
        }
      });
      await this.router.navigateByUrl('/fuel');
    } catch (error) {
      this.saveError.set(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.saving.set(false);
    }
  }
}
