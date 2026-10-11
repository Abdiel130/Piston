import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { Router } from '@angular/router';
import { VehicleAlerts, worstTone } from '../../core/data/vehicle-alerts.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { VehicleService } from '../../core/data/vehicle.service';
import type { Vehicle } from '../../core/models';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { SheetComponent } from '../../shared/sheet/sheet.component';

interface VehicleOption {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly current: boolean;
  readonly tone: 'warn' | 'bad' | null;
}

interface ViewLink {
  readonly route: string;
  readonly icon: IconName;
  readonly title: string;
  readonly sub: string;
}

interface ViewOption extends ViewLink {
  readonly tone: 'warn' | 'bad' | null;
}

/**
 * Vistas de la sección del vehículo. Cada fase de `docs/vehicle-section.md`
 * agrega la suya aquí cuando existe; no se anuncian antes.
 */
const VIEWS: readonly ViewLink[] = [
  { route: '/vehicle', icon: 'car', title: 'Datos del vehículo', sub: 'Ficha, rendimiento y gastos' },
  { route: '/vehicle/insurance', icon: 'shield', title: 'Póliza de seguro', sub: 'Vigencia, teléfonos y archivos' },
  { route: '/vehicle/documents', icon: 'document', title: 'Documentos', sub: 'Verificación, tenencia, tarjeta y licencia' },
];

/**
 * La hoja que abre el apodo del garage: cambia el vehículo en gestión y lleva
 * a sus vistas. Cambiar es `setPrimary`, así que todo lo que se registre
 * después, en cualquier pantalla, va al vehículo elegido.
 */
@Component({
  selector: 'pst-vehicle-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SheetComponent],
  templateUrl: './vehicle-sheet.component.html',
  styleUrl: './vehicle-sheet.component.scss',
})
export class VehicleSheetComponent {
  private readonly context = inject(VehicleContext);
  private readonly vehicleService = inject(VehicleService);
  private readonly alerts = inject(VehicleAlerts);
  private readonly router = inject(Router);

  readonly open = model(false);

  /** Cada vista lleva el badge de las alertas que se resuelven en ella. */
  protected readonly views = computed<ViewOption[]>(() => {
    const alerts = this.alerts.forVehicle(this.context.vehicleId());
    return VIEWS.map((view) => ({ ...view, tone: worstTone(alerts.filter((alert) => alert.route === view.route)) }));
  });
  protected readonly error = signal<string | null>(null);
  protected readonly switching = signal(false);

  protected readonly options = computed<VehicleOption[]>(() => {
    const currentId = this.context.vehicleId();
    return this.context
      .vehicles()
      .filter((vehicle) => vehicle.status === 'active')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((vehicle) => ({
        id: vehicle.id,
        name: vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`,
        sub: describe(vehicle),
        current: vehicle.id === currentId,
        tone: worstTone(this.alerts.forVehicle(vehicle.id)),
      }));
  });

  protected readonly canSwitch = computed(() => this.options().length > 1);

  protected async choose(option: VehicleOption): Promise<void> {
    if (option.current) {
      this.open.set(false);
      return;
    }
    if (this.switching()) return;
    this.switching.set(true);
    this.error.set(null);
    try {
      await this.vehicleService.setPrimary(option.id);
      this.open.set(false);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo cambiar de vehículo.');
    } finally {
      this.switching.set(false);
    }
  }

  protected async go(route: string): Promise<void> {
    this.open.set(false);
    await this.router.navigateByUrl(route);
  }
}

function describe(vehicle: Vehicle): string {
  return [`${vehicle.make} ${vehicle.model} ${vehicle.year}`, vehicle.license_plate].filter(Boolean).join(' · ');
}
