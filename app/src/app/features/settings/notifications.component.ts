import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { VehicleAlerts } from '../../core/data/vehicle-alerts.service';
import type { NotificationPrefs } from '../../core/models';
import { CATEGORY_LABEL } from '../../core/notifications/notification-rules';
import { NotificationService } from '../../core/notifications/notification.service';
import { PwaService } from '../../core/pwa/pwa.service';
import { IconComponent } from '../../shared/icon/icon.component';

type Category = Exclude<keyof NotificationPrefs, 'key' | 'enabled'>;

interface CategoryRow {
  readonly key: Category;
  readonly title: string;
  readonly sub: string;
}

const CATEGORIES: readonly CategoryRow[] = [
  { key: 'insurance', title: CATEGORY_LABEL.insurance, sub: 'Un mes antes de vencer y al vencer' },
  { key: 'documents', title: CATEGORY_LABEL.documents, sub: 'Verificación, tenencia, tarjeta, licencia y demás' },
  { key: 'reminders', title: CATEGORY_LABEL.reminders, sub: 'Con la anticipación de cada recordatorio' },
];

/**
 * Ajustes › Notificaciones: permiso del navegador y qué tipos de aviso suenan
 * en ESTE dispositivo. Cada documento o recordatorio puede además apagar la
 * suya desde su formulario. El badge del garage no depende de nada de esto.
 */
@Component({
  selector: 'pst-notification-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './notifications.component.html',
  styleUrls: ['../capture/capture.scss', './settings.component.scss', './notifications.component.scss'],
})
export class NotificationSettingsComponent {
  private readonly notifications = inject(NotificationService);
  private readonly pwa = inject(PwaService);
  private readonly alerts = inject(VehicleAlerts);

  protected readonly permission = this.notifications.permission;
  protected readonly prefs = this.notifications.prefs;
  protected readonly categories = CATEGORIES;
  protected readonly pending = this.alerts.count;
  protected readonly asking = signal(false);
  protected readonly error = signal<string | null>(null);

  /** En iPhone la API solo existe dentro de la app instalada. */
  protected readonly needsInstall = computed(() => this.permission() === 'unsupported' && this.pwa.isIos && !this.pwa.installed());

  protected readonly status = computed(() => {
    switch (this.permission()) {
      case 'granted':
        return this.prefs().enabled ? { label: 'Activas', tone: 'good' } : { label: 'Apagadas', tone: 'idle' };
      case 'denied':
        return { label: 'Bloqueadas', tone: 'bad' };
      case 'default':
        return { label: 'Sin permiso', tone: 'warn' };
      default:
        return { label: 'No disponibles', tone: 'idle' };
    }
  });

  protected async ask(): Promise<void> {
    if (this.asking()) return;
    this.asking.set(true);
    this.error.set(null);
    try {
      await this.notifications.request();
    } catch {
      this.error.set('El navegador no dejó pedir el permiso.');
    } finally {
      this.asking.set(false);
    }
  }

  protected toggle(key: 'enabled' | Category, event: Event): void {
    void this.notifications.setPrefs({ [key]: (event.target as HTMLInputElement).checked });
  }

  protected async test(): Promise<void> {
    this.error.set(null);
    try {
      await this.notifications.test();
    } catch {
      this.error.set('No se pudo mostrar. Revisa que el sistema no tenga silenciado el navegador.');
    }
  }
}
