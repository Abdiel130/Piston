import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { db } from '../../core/db/piston-db';
import { OfflineStore } from '../../core/data/offline-store.service';
import { SyncService } from '../../core/sync/sync.service';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface SettingRow {
  readonly icon: IconName;
  readonly title: string;
  readonly value?: string;
  readonly action?: () => void;
}

interface SettingGroup {
  readonly title: string;
  readonly rows: readonly SettingRow[];
}

/**
 * Ajustes.
 *
 * El grupo "Datos y sincronización" es real: lee el estado del motor offline y
 * el botón de sincronizar dispara un ciclo de verdad. El resto de los grupos
 * siguen siendo maqueta.
 */
@Component({
  selector: 'pst-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private readonly island = inject(IslandService);
  private readonly sync = inject(SyncService);
  private readonly store = inject(OfflineStore);

  protected readonly pending = this.sync.pendingCount;
  protected readonly failed = this.sync.failedCount;
  protected readonly uploads = this.sync.pendingUploads;
  protected readonly online = this.sync.online;
  protected readonly status = this.sync.status;

  /** Vehículos vivos en IndexedDB. Se reemite solo cuando cambian. */
  private readonly vehicles = this.store.liveSignal(
    () => db.vehicles.filter((vehicle) => !vehicle.deleted_at).toArray(),
    [],
  );

  private readonly serviceTypes = this.store.liveSignal(() => db.service_types.count(), 0);

  constructor() {
    // La isla publica el estado real de la cola, no un número inventado. Va en
    // un effect y no en el constructor porque el estado cambia solo: al vaciarse
    // la cola o al caerse la red, la píldora tiene que reflejarlo sin que nadie
    // vuelva a entrar a la pantalla.
    effect(() => {
      this.island.present({
        icon: this.online() ? 'cloudCheck' : 'cloudOff',
        label: this.online() ? 'Sincronizado' : 'Sin conexión',
        value: String(this.pending()),
        tone: this.pending() > 0 ? 'warn' : 'good',
        title: this.pending() > 0 ? 'Cambios sin sincronizar' : 'Todo sincronizado',
        subtitle: this.online()
          ? 'La cola se vacía en segundo plano'
          : 'Se enviarán al recuperar la señal',
        details: [
          { label: 'En cola', value: String(this.pending()) },
          { label: 'Fotos', value: String(this.uploads()) },
          { label: 'Último sync', value: this.relativeLastSync() },
        ],
        pulsing: this.status() === 'syncing',
      });
    });
  }

  protected readonly groups = computed<readonly SettingGroup[]>(() => [
    {
      title: 'Vehículos',
      rows: [
        ...this.vehicles().map(
          (vehicle): SettingRow => ({
            icon: 'car',
            title: vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`,
            value: vehicle.is_primary ? 'Principal' : undefined,
          }),
        ),
        { icon: 'plus', title: 'Agregar vehículo' },
        {
          icon: 'garage',
          title: 'Vehículos archivados',
          value: String(this.vehicles().filter((vehicle) => vehicle.status !== 'active').length),
        },
      ],
    },
    {
      title: 'Datos y sincronización',
      rows: [
        {
          icon: this.online() ? 'cloudCheck' : 'cloudOff',
          title: 'Conexión',
          value: this.online() ? 'En línea' : 'Sin conexión',
        },
        {
          icon: 'sync',
          title: 'Sincronizar ahora',
          value: this.statusLabel(),
          action: () => void this.sync.sync(),
        },
        { icon: 'clock', title: 'Cambios en cola', value: String(this.pending()) },
        { icon: 'camera', title: 'Fotos por subir', value: String(this.uploads()) },
        {
          icon: 'alert',
          title: 'Mutaciones fallidas',
          value: String(this.failed()),
          action: this.failed() > 0 ? () => void this.sync.retryFailed() : undefined,
        },
        { icon: 'cloudCheck', title: 'Último sync', value: this.relativeLastSync() },
        { icon: 'wrench', title: 'Catálogo de servicios', value: String(this.serviceTypes()) },
      ],
    },
    {
      title: 'Recordatorios',
      rows: [
        { icon: 'bell', title: 'Notificaciones', value: 'Activadas' },
        { icon: 'calendar', title: 'Avisar antes de', value: '15 días' },
        { icon: 'road', title: 'Avisar antes de', value: '500 km' },
      ],
    },
    {
      title: 'Unidades',
      rows: [
        { icon: 'road', title: 'Distancia', value: 'Kilómetros' },
        { icon: 'droplet', title: 'Volumen', value: 'Litros' },
        { icon: 'receipt', title: 'Moneda', value: 'MXN' },
      ],
    },
  ]);

  protected run(row: SettingRow): void {
    row.action?.();
  }

  private statusLabel(): string {
    switch (this.status()) {
      case 'syncing':
        return 'Sincronizando…';
      case 'offline':
        return 'Sin conexión';
      case 'error':
        return 'Con errores';
      default:
        return this.pending() > 0 ? 'Pendiente' : 'Al día';
    }
  }

  private relativeLastSync(): string {
    const last = this.sync.lastSyncedAt();
    if (!last) {
      return 'nunca';
    }

    const minutes = Math.floor((Date.now() - new Date(last).getTime()) / 60_000);
    if (minutes < 1) {
      return 'hace un momento';
    }
    if (minutes < 60) {
      return `hace ${minutes} min`;
    }
    return `hace ${Math.floor(minutes / 60)} h`;
  }
}
