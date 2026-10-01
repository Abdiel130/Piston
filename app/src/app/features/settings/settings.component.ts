import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { db } from '../../core/db/piston-db';
import { OfflineStore } from '../../core/data/offline-store.service';
import { PwaService } from '../../core/pwa/pwa.service';
import { SyncService, type LogoutBlocker, type SyncSummary } from '../../core/sync/sync.service';
import { relative } from '../sync/sync-format';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface SettingRow {
  readonly icon: IconName;
  readonly title: string;
  readonly value?: string;
  /** Tono del valor: para que un error de sync se note desde la lista. */
  readonly tone?: 'good' | 'warn' | 'bad';
  readonly action?: () => void;
}

/** Lo que hay que escribir para confirmar la salida de emergencia. */
const DISCARD_CONFIRMATION = 'BORRAR';

const BLOCKER_TEXT: Record<Exclude<LogoutBlocker, null>, string> = {
  expired: 'Tu sesión expiró. Vuelve a iniciarla para enviar lo pendiente.',
  offline: 'Sin conexión. Hace falta para confirmar que todo se envió.',
  syncing: 'Sincronizando…',
  pending: 'Hay cambios sin enviar al servidor.',
  failed: 'Hay cambios que el servidor rechazó. Reintenta antes de salir.',
  conflict: 'Hay conflictos con otro dispositivo. Resuélvelos antes de salir.',
  uploads: 'Hay fotos sin subir.',
};

interface SettingGroup {
  readonly title: string;
  readonly rows: readonly SettingRow[];
}

const DISTANCE: Record<string, string> = { km: 'Kilómetros', mi: 'Millas' };
const VOLUME: Record<string, string> = { L: 'Litros', gal: 'Galones' };

/**
 * Ajustes. Todo lo que muestra es real.
 *
 * La sincronización es UNA fila con el estado resumido; el detalle (qué falta,
 * por qué falló, historial) vive en el centro de sincronización.
 */
@Component({
  selector: 'pst-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly island = inject(IslandService);
  private readonly sync = inject(SyncService);
  private readonly store = inject(OfflineStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly authState = this.auth.state;
  protected readonly blocker = this.sync.logoutBlocker;
  protected readonly blockerText = computed(() => {
    const blocker = this.blocker();
    return blocker ? BLOCKER_TEXT[blocker] : null;
  });
  protected readonly loggingOut = signal(false);
  protected readonly logoutError = signal<string | null>(null);
  protected readonly discardOpen = signal(false);
  protected readonly discardText = signal('');
  protected readonly discardConfirmation = DISCARD_CONFIRMATION;
  protected readonly canDiscard = computed(() => this.discardText().trim() === DISCARD_CONFIRMATION);
  private readonly pwa = inject(PwaService);

  protected readonly summary = this.sync.summary;

  /** Vehículos vivos en IndexedDB. Se reemite solo cuando cambian. */
  private readonly vehicles = this.store.liveSignal(
    () => db.vehicles.filter((vehicle) => !vehicle.deleted_at).toArray(),
    [],
  );

  constructor() {
    // La isla publica el estado real de la cola, no un número inventado. Va en
    // un effect y no en el constructor porque el estado cambia solo: al vaciarse
    // la cola o al caerse la red, la píldora tiene que reflejarlo sin que nadie
    // vuelva a entrar a la pantalla.
    effect(() => {
      const s = this.summary();
      const open = openCount(s);
      this.island.present({
        icon: s.health === 'offline' || s.health === 'expired' ? 'cloudOff' : 'cloudCheck',
        label: syncLabel(s),
        value: String(open),
        tone: s.health === 'error' || s.health === 'conflict' ? 'bad' : open > 0 ? 'warn' : 'good',
        title: s.conflicts > 0 ? 'Conflictos por resolver' : open > 0 ? 'Cambios sin sincronizar' : 'Todo sincronizado',
        subtitle: s.health === 'offline' ? 'Se enviarán al recuperar la señal' : 'La cola se vacía en segundo plano',
        details: [
          ...(s.conflicts > 0 ? [{ label: 'Conflictos', value: String(s.conflicts) }] : []),
          { label: 'En cola', value: String(s.pending + s.blocked) },
          { label: 'Con error', value: String(s.failed + s.failedUploads) },
          { label: 'Último sync', value: relative(s.lastSyncedAt) },
        ],
        pulsing: s.health === 'syncing',
      });
    });
  }

  protected readonly groups = computed<readonly SettingGroup[]>(() => [
    {
      title: 'Aplicación',
      rows: [this.installRow(), this.updateRow()],
    },
    {
      title: 'Datos',
      rows: [this.syncRow()],
    },
    {
      title: 'Vehículos',
      rows: this.vehicles().map((vehicle): SettingRow => ({
        icon: 'car',
        title: vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`,
        value: vehicle.is_primary ? 'Principal' : vehicle.status === 'active' ? undefined : 'Archivado',
      })),
    },
    {
      title: 'Unidades',
      rows: [
        { icon: 'road', title: 'Distancia', value: DISTANCE[this.user()?.distance_unit ?? 'km'] },
        { icon: 'droplet', title: 'Volumen', value: VOLUME[this.user()?.volume_unit ?? 'L'] },
        { icon: 'receipt', title: 'Moneda', value: this.user()?.currency ?? 'MXN' },
      ],
    },
  ]);

  protected run(row: SettingRow): void {
    row.action?.();
  }

  private installRow(): SettingRow {
    if (this.pwa.installed()) {
      return { icon: 'checkCircle', title: 'Instalar app', value: 'Instalada' };
    }
    if (this.pwa.canInstall()) {
      return {
        icon: 'download',
        title: 'Instalar app',
        value: 'Disponible',
        action: () => void this.pwa.install(),
      };
    }
    // iOS no expone un prompt: solo se puede indicar el camino manual.
    return {
      icon: 'download',
      title: 'Instalar app',
      value: this.pwa.isIos ? 'Compartir › Agregar a inicio' : 'Menú del navegador › Instalar',
    };
  }

  private updateRow(): SettingRow {
    switch (this.pwa.updateStatus()) {
      case 'ready':
        return {
          icon: 'sync',
          title: 'Actualizar ahora',
          value: 'Nueva versión',
          action: () => void this.pwa.applyUpdate(),
        };
      case 'checking':
        return { icon: 'sync', title: 'Buscar actualizaciones', value: 'Buscando…' };
      case 'unavailable':
        return { icon: 'sync', title: 'Buscar actualizaciones', value: 'No disponible' };
      default:
        return {
          icon: 'sync',
          title: 'Buscar actualizaciones',
          value: this.pwa.updateStatus() === 'latest' ? 'Al día' : undefined,
          action: () => void this.pwa.checkForUpdate(),
        };
    }
  }

  /**
   * Cerrar sesión BORRA la base local. Por eso primero se sincroniza y se
   * vuelve a comprobar: el botón pudo habilitarse con la cola vacía y que otra
   * pestaña haya encolado algo justo después.
   */
  protected async logout(): Promise<void> {
    if (this.loggingOut()) {
      return;
    }
    this.loggingOut.set(true);
    this.logoutError.set(null);
    try {
      await this.sync.sync();
      if (!this.sync.canLogout()) {
        this.logoutError.set(this.blockerText() ?? 'Todavía hay datos sin enviar.');
        return;
      }
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } catch {
      this.logoutError.set('No se pudo cerrar la sesión. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      this.loggingOut.set(false);
    }
  }

  protected openSync(): void {
    void this.router.navigateByUrl('/settings/sync');
  }

  protected relogin(): void {
    void this.router.navigateByUrl('/login');
  }

  /** Salida de emergencia: pierde lo que no se haya enviado. Exige escribir la confirmación. */
  protected async discard(): Promise<void> {
    if (!this.canDiscard()) {
      return;
    }
    await this.auth.discardLocal();
    await this.router.navigateByUrl('/login');
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private syncRow(): SettingRow {
    const s = this.summary();
    return {
      icon: s.health === 'offline' || s.health === 'expired' ? 'cloudOff' : 'sync',
      title: 'Sincronización',
      value: syncLabel(s),
      tone: s.health === 'error' || s.health === 'conflict' ? 'bad' : s.health === 'ok' ? 'good' : 'warn',
      action: () => this.openSync(),
    };
  }
}

function openCount(s: SyncSummary): number {
  return s.pending + s.blocked + s.failed + s.conflicts + s.uploads + s.failedUploads;
}

/** Estado de una línea: lo que se ve en la fila de Ajustes y en la isla. */
function syncLabel(s: SyncSummary): string {
  const open = openCount(s);
  switch (s.health) {
    case 'expired':
      return 'Sesión expirada';
    case 'offline':
      return open > 0 ? `Sin conexión · ${open} en cola` : 'Sin conexión';
    case 'syncing':
      return 'Sincronizando…';
    case 'conflict':
      return s.conflicts === 1 ? '1 conflicto' : `${s.conflicts} conflictos`;
    case 'error':
      return `${s.failed + s.failedUploads} con error`;
    case 'pending':
      return `${open} por subir`;
    default:
      return `Al día · ${relative(s.lastSyncedAt)}`;
  }
}
