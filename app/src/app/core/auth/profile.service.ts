import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { liveQuery } from 'dexie';
import { toSignal } from '@angular/core/rxjs-interop';
import { from } from 'rxjs';
import { ApiService, AuthRequiredError, PermanentApiError } from '../api/api.service';
import { db } from '../db/piston-db';
import { CURRENT, type ProfilePatch } from '../models';
import { AuthService } from './auth.service';

/**
 * Preferencias del perfil (nombre, unidades, moneda) editadas desde Ajustes.
 *
 * Mismo patrón que el wizard: el cambio se aplica PRIMERO en la sesión local,
 * así la app entera lo refleja al instante y sin red, y se sube después a
 * `PATCH /api/me`. Lo que no sube queda en `pending_profile` y se reintenta al
 * volver la conexión o en el siguiente arranque.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private flushing: Promise<void> | null = null;

  /** Hay cambios de perfil que el servidor todavía no conoce. */
  readonly pending = toSignal(
    from(liveQuery(() => this.isPending())),
    { initialValue: false },
  );

  private readonly _rejected = signal<string | null>(null);
  /** Motivo del último rechazo del servidor (validación), para mostrarlo en Ajustes. */
  readonly rejected = this._rejected.asReadonly();

  constructor() {
    globalThis.addEventListener?.('online', () => void this.flush());
    // Al arrancar con sesión, o al recuperarla tras un login, sube lo pendiente.
    effect(() => {
      if (this.auth.state() === 'authenticated') {
        untracked(() => void this.flush());
      }
    });
  }

  async update(patch: ProfilePatch): Promise<void> {
    this._rejected.set(null);
    await this.auth.patchProfile(patch);
    void this.flush();
  }

  /** Lectura directa, sin esperar a que el liveQuery reemita. */
  async isPending(): Promise<boolean> {
    return !!(await db.session.get(CURRENT))?.pending_profile;
  }

  flush(): Promise<void> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    if (this.auth.state() !== 'authenticated' || !globalThis.navigator?.onLine) {
      return;
    }
    const sent = (await db.session.get(CURRENT))?.pending_profile;
    if (!sent || Object.keys(sent).length === 0) {
      return;
    }

    try {
      const user = await this.api.updateProfile(sent);
      // Si el usuario cambió algo más mientras subía, lo nuevo sigue pendiente.
      await db.transaction('rw', db.session, async () => {
        const latest = await db.session.get(CURRENT);
        if (latest && JSON.stringify(latest.pending_profile) === JSON.stringify(sent)) {
          await db.session.put({ ...latest, pending_profile: null });
        }
      });
      await this.auth.updateUser(user);
    } catch (error) {
      if (error instanceof PermanentApiError) {
        // Un valor inválido no se arregla reintentando: se descarta para que
        // el próximo refresh restaure lo que el servidor sí tiene.
        this._rejected.set(Object.values(error.errors ?? {})[0]?.[0] ?? error.message);
        await db.session.update(CURRENT, { pending_profile: null });
        return;
      }
      if (!(error instanceof AuthRequiredError)) {
        console.warn('[perfil] No se pudo subir el perfil; se reintentará.', error);
      }
    }
  }
}
