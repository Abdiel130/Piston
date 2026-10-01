import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { todayIso } from '../../core/format';
import type { OdometerReading, ServiceRecord, ServiceRecordItem, ServiceType, Vehicle } from '../../core/models';
import { UnitsService } from '../../core/units.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { LIMITS, blankToNull, odometerError, readNumber, readText, type Errors } from './capture-form';

type Field = 'performed_at' | 'odometer_km' | 'total_cost';

/** Captura de un servicio: el registro, sus conceptos del catálogo y la lectura de odómetro. */
@Component({
  selector: 'pst-service-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './service-capture.component.html',
  styleUrl: './capture.scss',
})
export class ServiceCaptureComponent {
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  protected readonly units = inject(UnitsService);
  private readonly router = inject(Router);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;

  protected readonly types = this.store.liveSignal(
    async () =>
      (await db.service_types.toArray())
        .filter((type) => !type.deleted_at)
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [] as ServiceType[],
  );

  protected readonly performedAt = signal(todayIso());
  /** En la unidad del usuario; `km` es lo que se guarda. */
  protected readonly odometer = signal<number | null>(null);
  private readonly km = computed(() => this.units.toOdometerKm(this.odometer()));
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly shop = signal('');
  protected readonly diy = signal(false);
  protected readonly cost = signal<number | null>(null);
  protected readonly notes = signal('');

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly errors = computed<Errors<Field>>(() => {
    const errors: Errors<Field> = {};
    if (!this.performedAt()) errors.performed_at = 'Indica la fecha del servicio.';
    const odometer = odometerError(this.odometer(), this.km(), this.units.distanceSymbol());
    if (odometer) errors.odometer_km = odometer;
    const cost = this.cost();
    if (cost !== null && (cost < 0 || cost > LIMITS.money10)) errors.total_cost = 'Costo fuera de rango.';
    return errors;
  });

  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);
  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  protected toggle(id: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const vehicle = this.vehicle();
    if (!vehicle || !this.valid() || this.saving()) return;

    this.saving.set(true);
    this.saveError.set(null);
    const km = this.km()!;

    try {
      await this.store.transaction(['service_records', 'service_record_items', 'odometer_readings', 'vehicles'], async () => {
        const record = await this.store.create<ServiceRecord>('service_records', {
          user_id: null,
          vehicle_id: vehicle.id,
          performed_at: this.performedAt(),
          odometer_km: km,
          shop_name: this.diy() ? null : blankToNull(this.shop()),
          shop_phone: null,
          is_diy: this.diy(),
          labor_cost: 0,
          parts_cost: 0,
          total_cost: this.cost() ?? 0,
          currency: this.units.currency(),
          notes: blankToNull(this.notes()),
        });

        for (const typeId of this.selected()) {
          await this.store.create<ServiceRecordItem>('service_record_items', {
            service_record_id: record.id,
            service_type_id: typeId,
            description: null,
            cost: null,
          });
        }

        await this.store.create<OdometerReading>('odometer_readings', {
          user_id: null,
          vehicle_id: vehicle.id,
          read_at: new Date(`${this.performedAt()}T12:00:00`).toISOString(),
          km,
          source: 'service',
          source_id: record.id,
          is_suspect: false,
        });

        if (km > vehicle.current_odometer_km) {
          await this.store.update<Vehicle>('vehicles', vehicle.id, { current_odometer_km: km });
        }
      });
      await this.router.navigateByUrl('/services');
    } catch (error) {
      this.saveError.set(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.saving.set(false);
    }
  }
}
