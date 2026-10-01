import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AttachmentService, type PreparedFile } from '../../core/data/attachment.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { formatShortDate } from '../../core/format';
import type { FuelEntry, FuelGrade, FuelInputMode, OdometerReading, Vehicle } from '../../core/models';
import { UnitsService } from '../../core/units.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { LIMITS, blankToNull, localDateTime, odometerError, readNumber, readText, toIso, type Errors } from './capture-form';
import { deduceGaugeBefore, exceedsTank, resolveTrio } from './fuel-math';

type Field = 'filled_at' | 'odometer_km' | 'quantity' | 'liters' | 'amount_paid' | 'price_per_liter';

const GRADES: readonly { value: FuelGrade; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diésel' },
];

/** Comprobante elegido que todavía no se guarda. */
interface PendingFile {
  readonly id: number;
  readonly prepared: PreparedFile;
  /** Vista previa local; solo para imágenes. */
  readonly url: string | null;
}

/** Cifra para un placeholder: sin separador de miles y sin colas de decimales. */
function plain(value: number | null, digits: number): string {
  if (value === null) return '';
  const factor = 10 ** digits;
  return String(Math.round(value * factor) / factor);
}

/**
 * Captura de una carga. Los campos están en la unidad del usuario y se
 * guardan en km y litros. De monto, precio y cantidad basta con dos: el
 * tercero se calcula, y el precio se sugiere con la última carga del mismo
 * combustible. Con tanque lleno se deduce con cuánto se arrancó. Crea la
 * carga, su lectura de odómetro y sus comprobantes en una sola transacción.
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
  private readonly attachments = inject(AttachmentService);
  private readonly context = inject(VehicleContext);
  private readonly router = inject(Router);
  protected readonly units = inject(UnitsService);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  protected readonly grades = GRADES;
  protected readonly plain = plain;

  protected readonly filledAt = signal(localDateTime());
  protected readonly odometer = signal<number | null>(null);
  protected readonly grade = signal<FuelGrade | null>(null);
  /** Lo escrito en cada campo del trío; lo calculado vive en `trio`. */
  protected readonly liters = signal<number | null>(null);
  protected readonly amount = signal<number | null>(null);
  protected readonly price = signal<number | null>(null);
  protected readonly gaugeBefore = signal<number | null>(null);
  protected readonly gaugeAfter = signal<number | null>(null);
  protected readonly fullTank = signal(false);
  protected readonly notes = signal('');

  protected readonly files = signal<readonly PendingFile[]>([]);
  protected readonly preparing = signal(0);
  protected readonly fileError = signal<string | null>(null);
  private nextFileId = 0;

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly segments = computed(() => this.vehicle()?.gauge_total_segments ?? 8);
  protected readonly ticks = computed(() => Array.from({ length: this.segments() + 1 }, (_, i) => i));
  protected readonly selectedGrade = computed(() => this.grade() ?? this.vehicle()?.default_fuel_grade ?? 'regular');
  protected readonly gradeLabel = computed(() => GRADES.find((g) => g.value === this.selectedGrade())?.label ?? '');
  protected readonly odometerHint = computed(() => this.units.inputDistance(this.vehicle()?.current_odometer_km ?? null));

  /**
   * Última carga con precio del combustible elegido, de cualquier vehículo:
   * el precio es de la gasolinera, no del coche.
   */
  private readonly lastPriced = this.store.liveFrom(
    this.selectedGrade,
    async (grade) => {
      const entries = await db.fuel_entries.toArray();
      let last: FuelEntry | null = null;
      for (const entry of entries) {
        if (entry.deleted_at || entry.fuel_grade !== grade || entry.price_per_liter === null) continue;
        if (!last || entry.filled_at > last.filled_at) last = entry;
      }
      return last;
    },
    null as FuelEntry | null,
  );

  protected readonly suggestedPrice = computed(() => {
    const last = this.lastPriced();
    return last ? { value: this.units.inputPricePerVolume(last.price_per_liter), date: formatShortDate(last.filled_at) } : null;
  });

  /** Monto, precio y cantidad completos, en la unidad del usuario. */
  protected readonly trio = computed(() =>
    resolveTrio({ amount: this.amount(), price: this.price(), liters: this.liters() }, this.suggestedPrice()?.value ?? null),
  );

  /** Lo que se valida contra el servidor y se guarda, ya en unidades base. */
  private readonly base = computed(() => {
    const { values } = this.trio();
    return {
      km: this.units.toOdometerKm(this.odometer()),
      liters: this.units.toLiters(values.liters, 3),
      price: this.units.toPricePerLiter(values.price),
      amount: values.amount,
    };
  });

  /** Con tanque lleno: con cuánto se arrancó, según lo que entró. */
  protected readonly deduction = computed(() =>
    this.fullTank() ? deduceGaugeBefore(this.base().liters, this.vehicle()?.tank_capacity_l ?? null, this.segments()) : null,
  );

  /** La rayita que se marca como sugerida mientras el usuario no elija otra. */
  protected readonly suggestedTick = computed(() => {
    const deduction = this.deduction();
    return deduction && this.gaugeBefore() === null ? Math.round(deduction.gauge) : null;
  });

  protected readonly overfilled = computed(() => exceedsTank(this.base().liters, this.vehicle()?.tank_capacity_l ?? null));

  /** Odómetro por debajo del último registrado: casi siempre un dedazo. */
  protected readonly odometerBehind = computed(() => {
    const km = this.base().km;
    const current = this.vehicle()?.current_odometer_km ?? null;
    return km !== null && current !== null && km < current;
  });

  protected readonly errors = computed<Errors<Field>>(() => {
    const errors: Errors<Field> = {};
    const typed = this.odometer();
    const { km, liters, price, amount } = this.base();
    if (!this.filledAt()) errors.filled_at = 'Indica la fecha de la carga.';
    const odometer = odometerError(typed, km, this.units.distanceSymbol());
    if (odometer) errors.odometer_km = odometer;
    if (liters === null && amount === null && (this.fullTank() || this.gaugeAfter() === null)) {
      errors.quantity = this.fullTank()
        ? 'Anota el monto o la cantidad.'
        : 'Anota el monto, la cantidad o las rayitas después de cargar.';
    }
    if (liters !== null && (liters <= 0 || liters > LIMITS.liters)) errors.liters = 'Cantidad fuera de rango.';
    if (amount !== null && (amount <= 0 || amount > LIMITS.money10)) errors.amount_paid = 'Monto fuera de rango.';
    if (price !== null && (price <= 0 || price > LIMITS.price)) errors.price_per_liter = 'Precio fuera de rango.';
    return errors;
  });

  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.files().forEach((file) => file.url && URL.revokeObjectURL(file.url)));
  }

  protected setGauge(which: 'before' | 'after', value: number): void {
    const target = which === 'before' ? this.gaugeBefore : this.gaugeAfter;
    target.set(target() === value ? null : value);
  }

  protected async pickFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    this.fileError.set(null);

    const tooBig = picked.filter((file) => file.size > LIMITS.attachmentBytes);
    if (tooBig.length) {
      this.fileError.set(`${tooBig.map((file) => file.name).join(', ')}: pesa más de ${LIMITS.attachmentBytes / 1024 / 1024} MB.`);
    }

    for (const file of picked.filter((file) => file.size <= LIMITS.attachmentBytes)) {
      this.preparing.update((count) => count + 1);
      try {
        const prepared = await this.attachments.prepare(file);
        const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
        this.files.update((files) => [...files, { id: this.nextFileId++, prepared, url }]);
      } catch {
        this.fileError.set(`No se pudo leer ${file.name}.`);
      } finally {
        this.preparing.update((count) => count - 1);
      }
    }
  }

  protected removeFile(id: number): void {
    const file = this.files().find((candidate) => candidate.id === id);
    if (file?.url) URL.revokeObjectURL(file.url);
    this.files.update((files) => files.filter((candidate) => candidate.id !== id));
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const vehicle = this.vehicle();
    if (!vehicle || !this.valid() || this.saving() || this.preparing() > 0) return;

    this.saving.set(true);
    this.saveError.set(null);
    const filledAt = toIso(this.filledAt());
    const { km: baseKm, liters, price, amount } = this.base();
    const km = baseKm!;
    // Lo que el usuario escribió de verdad, no lo que se calculó.
    const mode: FuelInputMode = this.liters() !== null ? 'by_liters' : this.amount() !== null ? 'by_amount' : 'by_segments';
    const deduction = this.deduction();
    const files = this.files();

    try {
      await this.store.transaction(['fuel_entries', 'odometer_readings', 'vehicles', 'attachments'], async () => {
        const entry = await this.store.create<FuelEntry>('fuel_entries', {
          user_id: null,
          vehicle_id: vehicle.id,
          station_id: null,
          filled_at: filledAt,
          odometer_km: km,
          fuel_grade: this.selectedGrade(),
          input_mode: mode,
          amount_paid: amount,
          price_per_liter: price,
          liters,
          gauge_before: this.gaugeBefore() ?? deduction?.gauge ?? null,
          gauge_after: this.fullTank() ? this.segments() : this.gaugeAfter(),
          gauge_total_segments: this.segments(),
          is_full_tank: this.fullTank(),
          is_partial: !this.fullTank(),
          missed_previous: false,
          liters_before_est: deduction?.litersBefore ?? null,
          liters_after_est: this.fullTank() ? vehicle.tank_capacity_l : null,
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

        for (const [index, { prepared }] of files.entries()) {
          const kind = prepared.file.type === 'application/pdf' ? 'invoice' : 'receipt';
          await this.attachments.attachPrepared('fuel_entry', entry.id, prepared, kind, index);
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
