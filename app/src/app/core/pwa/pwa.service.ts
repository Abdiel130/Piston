import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * El evento que Chrome/Edge/Android disparan cuando la app cumple los
 * criterios de instalación. No está en lib.dom porque no es estándar.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type UpdateStatus = 'idle' | 'checking' | 'ready' | 'latest' | 'unavailable';

/** Cada cuánto se pregunta al servidor si hay versión nueva mientras la app sigue abierta. */
const UPDATE_POLL_MS = 30 * 60_000;

/**
 * Instalación y actualización de la PWA.
 *
 * Instalar: el navegador dispara `beforeinstallprompt` una sola vez y muy
 * pronto, así que este servicio se construye en el arranque (ver app.config)
 * para no perderlo. El evento se guarda y se reproduce cuando el usuario toca
 * "Instalar app". iOS no tiene ese evento: allí solo se puede instalar a mano
 * desde Compartir → Agregar a inicio.
 *
 * Actualizar: el service worker sirve la versión cacheada (arranca al instante
 * y sin red) y en paralelo descarga la nueva. Cuando termina, `updateReady`
 * se enciende y el usuario decide cuándo recargar; así nunca se le cambia la
 * app a media captura de una carga.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly swUpdate = inject(SwUpdate);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  private readonly _canInstall = signal(false);
  private readonly _installed = signal(isStandalone());
  private readonly _updateStatus = signal<UpdateStatus>(
    this.swUpdate.isEnabled ? 'idle' : 'unavailable',
  );

  /** Hay un prompt nativo guardado y se puede lanzar. */
  readonly canInstall = this._canInstall.asReadonly();
  /** La app ya corre instalada (ventana standalone). */
  readonly installed = this._installed.asReadonly();
  readonly updateStatus = this._updateStatus.asReadonly();
  /** iOS/iPadOS Safari: sin prompt nativo, solo instalación manual. */
  readonly isIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  constructor() {
    const onPrompt = (event: Event) => {
      // Sin preventDefault Chrome muestra su propio mini-banner y el evento
      // ya no se puede reutilizar.
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this._canInstall.set(true);
    };
    const onInstalled = () => {
      this.deferredPrompt = null;
      this._canInstall.set(false);
      this._installed.set(true);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    });

    if (!this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(filter((event) => event.type === 'VERSION_READY'))
      .subscribe(() => this._updateStatus.set('ready'));

    // Caché corrupta o versión borrada del servidor: la única salida es recargar.
    this.swUpdate.unrecoverable.subscribe(() => location.reload());

    // El worker ya revisa al abrir la app; esto cubre la app que se queda
    // abierta horas en segundo plano y vuelve al frente.
    const timer = setInterval(() => void this.checkForUpdate(), UPDATE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void this.checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  /** Lanza el diálogo nativo de instalación. Devuelve si el usuario aceptó. */
  async install(): Promise<boolean> {
    const prompt = this.deferredPrompt;
    if (!prompt) {
      return false;
    }

    // El evento es de un solo uso, acepte o no.
    this.deferredPrompt = null;
    this._canInstall.set(false);

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    return outcome === 'accepted';
  }

  /** Pregunta al servidor por una versión nueva. No recarga nada. */
  async checkForUpdate(): Promise<void> {
    const status = this._updateStatus();
    if (status === 'unavailable' || status === 'checking' || status === 'ready') {
      return;
    }

    this._updateStatus.set('checking');
    try {
      const found = await this.swUpdate.checkForUpdate();
      // `true` significa que la versión nueva ya se descargó y está lista.
      this._updateStatus.set(found ? 'ready' : 'latest');
    } catch {
      // Sin red o servidor caído: no es un error para el usuario.
      this._updateStatus.set('idle');
    }
  }

  /** Cambia a la versión descargada y recarga para que la use. */
  async applyUpdate(): Promise<void> {
    await this.swUpdate.activateUpdate();
    location.reload();
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari de iOS no soporta display-mode; expone su propia bandera.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
