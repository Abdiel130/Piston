import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { OfflineStore } from '../data/offline-store.service';
import { VehicleAlerts } from '../data/vehicle-alerts.service';
import { VehicleContext } from '../data/vehicle-context.service';
import { VehicleService } from '../data/vehicle.service';
import { db } from '../db/piston-db';
import type { NotificationPrefs } from '../models';
import { requestDailySync } from '../sync/background-sync';
import { DEFAULT_PREFS, dueNotifications, messagesFor, type NotificationMessage } from './notification-rules';

/** `unsupported`: el navegador no tiene Notification API (iOS fuera de la app instalada). */
export type NotificationPermissionState = NotificationPermission | 'unsupported';

/** Lo que manda el service worker al tocar una notificación con la app abierta. */
export const CLICK_MESSAGE = 'piston-notification-click';

/** Mismo lock que el service worker: nunca revisan y notifican a la vez. */
const LOCK = 'piston-notify';

/** Los avisos ya notificados se olvidan después de esto. */
const FORGET_AFTER_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * Esperar a que las lecturas vivas de documentos, recordatorios y vehículos
 * lleguen todas: al abrir, una llega antes que otra y se notificaría a medias.
 */
const SETTLE_MS = 1_500;

const ICON = 'icons/app/192.png';

/**
 * Notificaciones locales del sistema para los avisos de `VehicleAlerts`.
 *
 * Sin Web Push: se revisa al abrir la app (y cada que cambian los avisos con
 * ella abierta) y una vez al día en el periodic sync del service worker. Cada
 * aviso suena una vez por dispositivo al entrar en su ventana y otra al
 * vencer; el badge no depende de esto y sigue hasta resolverlo.
 *
 * También pone el total en el icono de la app (Badging API) y lleva a la vista
 * del aviso al tocar la notificación, cambiando al vehículo que corresponde.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly store = inject(OfflineStore);
  private readonly alerts = inject(VehicleAlerts);
  private readonly context = inject(VehicleContext);
  private readonly vehicles = inject(VehicleService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly _permission = signal<NotificationPermissionState>(currentPermission());
  readonly permission = this._permission.asReadonly();

  readonly prefs = this.store.liveSignal(
    async () => (await db.notification_prefs.get('current')) ?? DEFAULT_PREFS,
    DEFAULT_PREFS,
  );

  /** Suena algo en este dispositivo: hay permiso y el interruptor general está encendido. */
  readonly active = computed(() => this.permission() === 'granted' && this.prefs().enabled);

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    // El permiso se puede cambiar desde los ajustes del navegador.
    const refresh = () => this._permission.set(currentPermission());
    document.addEventListener('visibilitychange', refresh);
    destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', refresh));

    // Avisos nuevos, o una categoría que se vuelve a encender: revisar.
    effect(() => {
      this.alerts.active();
      this.prefs();
      if (this.permission() !== 'granted' || this.auth.state() === 'anonymous') return;
      this.schedule();
    });

    effect(() => void setAppBadge(this.alerts.count()));

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === CLICK_MESSAGE && typeof data.url === 'string') void this.router.navigateByUrl(data.url);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    destroyRef.onDestroy(() => navigator.serviceWorker?.removeEventListener('message', onMessage));

    // `?vehicle=<id>` (de una notificación): cambia a ese vehículo y limpia la URL.
    const navigations = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => void this.followVehicleParam());
    destroyRef.onDestroy(() => navigations.unsubscribe());
    destroyRef.onDestroy(() => this.timer && clearTimeout(this.timer));
  }

  /** Pide el permiso. Solo desde un toque del usuario: si no, el navegador lo niega solo. */
  async request(): Promise<NotificationPermissionState> {
    if (this.permission() === 'unsupported') return 'unsupported';
    const result = await Notification.requestPermission();
    this._permission.set(result);
    if (result === 'granted') {
      // El periodic sync es lo que revisa con la app cerrada.
      void requestDailySync();
      this.schedule();
    }
    return result;
  }

  async setPrefs(patch: Partial<Omit<NotificationPrefs, 'key'>>): Promise<void> {
    const current = (await db.notification_prefs.get('current')) ?? DEFAULT_PREFS;
    await db.notification_prefs.put({ ...current, ...patch, key: 'current' });
  }

  /** Una de prueba, para ver cómo se ve y confirmar que el sistema no la silencia. */
  async test(): Promise<void> {
    await show({
      title: 'Piston',
      body: 'Así te avisaremos cuando algo de tu vehículo esté por vencer.',
      tag: 'piston-test',
      url: '/',
    }, (url) => void this.router.navigateByUrl(url));
  }

  /** Revisa y notifica lo pendiente. Lo llama el effect; con varios cambios seguidos, una sola vez. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check().catch(() => undefined);
    }, SETTLE_MS);
  }

  private async check(): Promise<void> {
    const run = async () => {
      // De la base y no del signal: al abrir, el signal todavía trae los de por omisión.
      const prefs = (await db.notification_prefs.get('current')) ?? DEFAULT_PREFS;
      if (this.permission() !== 'granted' || !prefs.enabled) return;
      const notified = new Set((await db.notified_alerts.toArray()).map((row) => row.key));
      const due = dueNotifications(this.alerts.active(), prefs, notified);
      if (due.length === 0) return;

      // Se marca antes de mostrar: si mostrar falla, mejor perder uno que repetirlo siempre.
      const at = new Date().toISOString();
      await db.notified_alerts.bulkPut(due.map((alert) => ({ key: alert.key, at })));
      await db.notified_alerts.where('at').below(new Date(Date.now() - FORGET_AFTER_MS).toISOString()).delete();

      const names = new Map(
        this.context
          .vehicles()
          .filter((vehicle) => vehicle.status === 'active')
          .map((vehicle) => [vehicle.id, vehicle.nickname ?? `${vehicle.make} ${vehicle.model}`] as const),
      );
      for (const message of messagesFor(due, names)) {
        await show(message, (url) => void this.router.navigateByUrl(url));
      }
    };
    const locks = navigator.locks;
    if (!locks) return run();
    // Si el service worker está revisando en este momento, él se encarga.
    await locks.request(LOCK, { ifAvailable: true }, (lock) => (lock ? run() : undefined));
  }

  private async followVehicleParam(): Promise<void> {
    const tree = this.router.parseUrl(this.router.url);
    const id = tree.queryParams['vehicle'];
    if (typeof id !== 'string') return;
    const vehicle = this.context.vehicles().find((candidate) => candidate.id === id) ?? (await db.vehicles.get(id));
    if (vehicle && vehicle.status === 'active' && !vehicle.deleted_at && vehicle.id !== this.context.vehicleId()) {
      await this.vehicles.setPrimary(vehicle.id).catch(() => undefined);
    }
    const { vehicle: _, ...rest } = tree.queryParams;
    tree.queryParams = rest;
    await this.router.navigateByUrl(tree, { replaceUrl: true });
  }
}

function currentPermission(): NotificationPermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/**
 * Por el service worker cuando lo hay: en Android `new Notification()` no
 * existe dentro de una pestaña, y así el toque lo atiende el worker aunque la
 * app ya esté cerrada. Sin worker (`ng serve`), la API directa.
 */
async function show(message: NotificationMessage, open: (url: string) => void): Promise<void> {
  const options: NotificationOptions = {
    body: message.body,
    tag: message.tag,
    icon: ICON,
    badge: ICON,
    data: { url: message.url },
  };
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (registration?.active) {
    await registration.showNotification(message.title, options);
    return;
  }
  const notification = new Notification(message.title, options);
  notification.onclick = () => {
    window.focus();
    open(message.url);
    notification.close();
  };
}

/** Total de avisos en el icono de la app instalada. Sin soporte, nada. */
async function setAppBadge(count: number): Promise<void> {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    // Sin permiso o fuera de la app instalada.
  }
}
