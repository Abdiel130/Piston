import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import type { OdometerReading, Vehicle } from '../../core/models';
import { UnitsService } from '../../core/units.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { localDateTime, odometerError, readNumber, readText, toIso } from './capture-form';

/** Anotar el odómetro sin que haya carga ni servicio de por medio. */
@Component({
  selector: 'pst-odometer-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  template: `
    <div class="pst-stack capture-page">
      <header class="top">
        <a class="top__back" routerLink="/"><pst-icon name="chevronLeft" [size]="20" /> Garage</a>
        <h1 class="top__title">Anotar odómetro</h1>
        <p class="top__sub">{{ name() }}</p>
      </header>

      <form class="pst-form" (submit)="$event.preventDefault(); save()">
        <div class="pst-field-row">
          <label class="pst-field">
            <span class="pst-field__label">Odómetro ({{ units.distanceSymbol() }})</span>
            <input
              class="pst-input pst-numeric"
              inputmode="numeric"
              [class.is-invalid]="submitted() && error()"
              [placeholder]="units.inputDistance(vehicle()?.current_odometer_km ?? null) ?? ''"
              [value]="km() ?? ''"
              (input)="km.set(readNumber($event))"
            />
          </label>
          <label class="pst-field">
            <span class="pst-field__label">Fecha y hora</span>
            <input class="pst-input" type="datetime-local" [value]="readAt()" (input)="readAt.set(readText($event))" />
          </label>
        </div>
        @if (submitted() && error(); as message) {
          <p class="error">{{ message }}</p>
        }
        @if (saveError(); as message) {
          <p class="pst-note pst-note--bad" role="alert">{{ message }}</p>
        }
        <button type="submit" class="pst-btn pst-btn--primary pst-btn--block" [disabled]="saving() || !vehicle()">
          {{ saving() ? 'Guardando…' : 'Guardar lectura' }}
        </button>
      </form>
    </div>
  `,
  styleUrl: './capture.scss',
})
export class OdometerCaptureComponent {
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly router = inject(Router);
  protected readonly units = inject(UnitsService);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  /** En la unidad del usuario; `baseKm` es lo que se guarda. */
  protected readonly km = signal<number | null>(null);
  private readonly baseKm = computed(() => this.units.toOdometerKm(this.km()));
  protected readonly readAt = signal(localDateTime());
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  protected readonly error = computed(() => {
    const odometer = odometerError(this.km(), this.baseKm(), this.units.distanceSymbol());
    if (odometer) return odometer;
    if (!this.readAt()) return 'Indica la fecha.';
    return null;
  });

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const vehicle = this.vehicle();
    if (!vehicle || this.error() || this.saving()) return;

    this.saving.set(true);
    this.saveError.set(null);
    const km = this.baseKm()!;
    try {
      await this.store.transaction(['odometer_readings', 'vehicles'], async () => {
        await this.store.create<OdometerReading>('odometer_readings', {
          user_id: null,
          vehicle_id: vehicle.id,
          read_at: toIso(this.readAt()),
          km,
          source: 'manual',
          source_id: null,
          is_suspect: false,
        });
        if (km > vehicle.current_odometer_km) {
          await this.store.update<Vehicle>('vehicles', vehicle.id, { current_odometer_km: km });
        }
      });
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.saveError.set(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.saving.set(false);
    }
  }
}
