import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { db } from '../db/piston-db';
import {
  CURRENT,
  isApiErrorBody,
  type ApiEnvelope,
  type AuthTokenResponse,
  type AuthUser,
  type LocalSession,
  type ProfilePatch,
} from '../models';
import { hasLocalData, wipeLocalData } from './local-data';

/**
 * - `unknown`: todavía no se lee la sesión local (solo durante el arranque).
 * - `anonymous`: el dispositivo no tiene dueño; hay que iniciar sesión.
 * - `authenticated`: hay dueño y, hasta donde se sabe, su sesión vive. Puede
 *   no haber access token en memoria (recién abierta la app, o sin red): se
 *   pide uno cuando haga falta.
 * - `expired`: el servidor rechazó el refresh. Los datos locales siguen
 *   intactos y la app funciona; solo el sync espera a un nuevo login.
 */
export type AuthState = 'unknown' | 'anonymous' | 'authenticated' | 'expired';

/** Margen antes de que venza el access token para renovarlo por adelantado. */
const EXPIRY_MARGIN_MS = 60_000;

/** Nombre del lock que serializa el refresh entre pestañas. */
const REFRESH_LOCK = 'piston-refresh';

/** Header que el backend exige en las rutas con cookie (defensa CSRF). */
export const CLIENT_HEADER = 'X-Piston-Client';

/** Otra cuenta intentó entrar en un dispositivo con datos de la anterior. */
export class AccountMismatchError extends Error {
  constructor(readonly localEmail: string) {
    super(
      `Este dispositivo tiene datos de ${localEmail}. Inicia sesión con esa cuenta ` +
        'o, desde Ajustes, descarta sus datos antes de cambiar de cuenta.',
    );
    this.name = 'AccountMismatchError';
  }
}

/**
 * Sesión del dispositivo.
 *
 * Principio rector: los tokens protegen el SERVIDOR, no los datos locales. Lo
 * que hay en IndexedDB ya está en el dispositivo; pedir un token para leerlo
 * offline no añade seguridad, solo fricción. Por eso la app abre con la sesión
 * local aunque no haya red ni token, y un token vencido pausa el sync pero
 * nunca bloquea la app ni borra nada.
 *
 * - Access token: en memoria, ~15 min. Nunca toca storage: un XSS no puede
 *   robar lo que no está escrito en ningún lado.
 * - Refresh token: cookie HttpOnly que el servidor rota en cada uso. Este
 *   servicio nunca lo ve; solo llama a `/api/auth/refresh`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api/auth`;

  private readonly _state = signal<AuthState>('unknown');
  private readonly _user = signal<LocalSession['user'] | null>(null);
  /** Último usuario recibido del servidor, con su onboarding. Lo consume OnboardingService. */
  private readonly _serverUser = signal<AuthUser | null>(null);
  /** Se enciende tras un login y lo apaga la ventana de sincronización. */
  private readonly _justLoggedIn = signal(false);

  readonly state = this._state.asReadonly();
  readonly user = this._user.asReadonly();
  readonly serverUser = this._serverUser.asReadonly();
  readonly justLoggedIn = this._justLoggedIn.asReadonly();
  readonly hasSession = computed(
    () => this._state() === 'authenticated' || this._state() === 'expired',
  );

  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private inFlight: Promise<string | null> | null = null;

  /** Lee la sesión local. Solo IndexedDB: nunca espera a la red. */
  async restore(): Promise<void> {
    const session = await db.session.get(CURRENT);
    this._user.set(session?.user ?? null);
    this._state.set(session ? 'authenticated' : 'anonymous');
  }

  async login(email: string, password: string): Promise<void> {
    const response = await data(
      this.http.post<ApiEnvelope<AuthTokenResponse>>(`${this.base}/login`, {
        email,
        password,
        device_name: deviceName(),
      }),
    );

    const local = await db.session.get(CURRENT);
    if (local && local.user.id !== response.user.id && (await hasLocalData())) {
      // El servidor ya abrió una sesión para la otra cuenta; se cierra para no
      // dejarla viva sin dueño.
      this.adopt(response);
      await this.revokeRemote();
      this.forgetTokens();
      throw new AccountMismatchError(local.user.email);
    }

    if (local && local.user.id !== response.user.id) {
      // Cuenta distinta pero sin nada que perder (p. ej. solo el catálogo
      // sembrado): se limpia para no mezclar datos de dos cuentas.
      await wipeLocalData();
    }

    this.adopt(response);
    this._serverUser.set(response.user);
    await this.persistSession(response.user);
    this._state.set('authenticated');
    this._justLoggedIn.set(true);
  }

  /** La ventana de sincronización ya se mostró. */
  acknowledgeLogin(): void {
    this._justLoggedIn.set(false);
  }

  /**
   * Access token utilizable, renovándolo si está por vencer.
   *
   * Devuelve null sin lanzar si no hay forma de conseguir uno (sin red, sesión
   * expirada): quien llama manda la petición sin token y el 401 hace el resto.
   */
  async accessTokenFor(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.accessExpiresAt - EXPIRY_MARGIN_MS) {
      return this.accessToken;
    }
    if (this._state() !== 'authenticated') {
      return null;
    }
    return this.refresh();
  }

  /**
   * Cambia el refresh de la cookie por un access token nuevo.
   *
   * Single-flight en dos niveles: dentro de la pestaña se comparte la promesa,
   * y entre pestañas se serializa con un Web Lock. Sin el lock, dos pestañas
   * refrescando a la vez mandarían el MISMO refresh y la segunda parecería un
   * robo. Con él, la segunda espera y sale con la cookie ya rotada.
   */
  refresh(): Promise<string | null> {
    this.inFlight ??= this.withLock(() => this.doRefresh()).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Cierra la sesión en el servidor y borra todo lo local. Quien llama valida antes que no quede nada sin enviar. */
  async logout(): Promise<void> {
    await this.revokeRemote();
    await this.discardLocal();
  }

  /**
   * Salida de emergencia: borra lo local aunque haya cambios sin enviar.
   * Intenta avisar al servidor, pero no depende de ello.
   */
  async discardLocal(): Promise<void> {
    await wipeLocalData();
    this.forgetTokens();
    this._user.set(null);
    this._serverUser.set(null);
    this._justLoggedIn.set(false);
    this._state.set('anonymous');
  }

  /** Guarda en la sesión local los datos de perfil que devolvió el servidor. */
  async updateUser(user: AuthUser): Promise<void> {
    this._serverUser.set(user);
    await this.persistSession(user);
  }

  private async doRefresh(): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await data(
          this.http.post<ApiEnvelope<AuthTokenResponse>>(`${this.base}/refresh`, {}),
        );
        this.adopt(response);
        this._serverUser.set(response.user);
        await this.persistSession(response.user);
        this._state.set('authenticated');
        return response.access_token;
      } catch (error) {
        if (!(error instanceof HttpErrorResponse)) {
          return null;
        }
        // Otra pestaña (sin soporte de Web Locks) acaba de rotar la cookie: el
        // navegador ya tiene la nueva, basta con repetir.
        if (codeOf(error) === 'refresh_race' && attempt === 0) {
          continue;
        }
        if (error.status === 401) {
          this.forgetTokens();
          this._state.set('expired');
        }
        // Sin red o servidor caído: la sesión sigue viva, solo no hay token ahora.
        return null;
      }
    }
    return null;
  }

  private async revokeRemote(): Promise<void> {
    try {
      const token = await this.accessTokenFor();
      await firstValueFrom(
        this.http.post<ApiEnvelope<null>>(
          `${this.base}/logout`,
          {},
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        ),
      );
    } catch (error) {
      // 401: la sesión ya estaba muerta, que es justo lo que se quería. Lo
      // demás (sin red) deja una sesión viva en el servidor que caducará sola.
      if (!(error instanceof HttpErrorResponse) || (error.status !== 401 && error.status !== 0)) {
        throw error;
      }
    }
  }

  private adopt(response: AuthTokenResponse): void {
    this.accessToken = response.access_token;
    this.accessExpiresAt = Date.now() + response.expires_in * 1000;
  }

  /**
   * Aplica un cambio de perfil hecho en este dispositivo. Local al instante,
   * aunque no haya red; `ProfileService` lo sube después.
   */
  async patchProfile(patch: ProfilePatch): Promise<void> {
    await db.transaction('rw', db.session, async () => {
      const session = await db.session.get(CURRENT);
      if (!session) {
        throw new Error('No hay sesión local.');
      }
      const user = { ...session.user, ...patch };
      await db.session.put({
        ...session,
        user,
        pending_profile: { ...session.pending_profile, ...patch },
      });
      this._user.set(user);
    });
  }

  /**
   * Guarda el perfil que devolvió el servidor. Lo pendiente de subir se
   * reaplica encima: un refresh con el perfil viejo no debe deshacer en
   * pantalla un cambio que el usuario ya hizo.
   */
  private async persistSession(user: AuthUser): Promise<void> {
    const { onboarding: _ignored, ...profile } = user;
    await db.transaction('rw', db.session, async () => {
      const pending = (await db.session.get(CURRENT))?.pending_profile ?? null;
      const merged = pending ? { ...profile, ...pending } : profile;
      this._user.set(merged);
      await db.session.put({
        key: CURRENT,
        user: merged,
        last_login_at: new Date().toISOString(),
        pending_profile: pending,
      });
    });
  }

  private forgetTokens(): void {
    this.accessToken = null;
    this.accessExpiresAt = 0;
  }

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(REFRESH_LOCK, task) : task();
  }
}

/** Contenido útil de una respuesta de la API: lo que va dentro del sobre. */
function data<T>(response: Observable<ApiEnvelope<T>>): Promise<T> {
  return firstValueFrom(response.pipe(map((envelope) => envelope.data)));
}

/** Código de la API de un error HTTP, si quien respondió fue la API. */
function codeOf(error: HttpErrorResponse): string | null {
  return isApiErrorBody(error.error) ? error.error.code : null;
}

/** Nombre legible del dispositivo, para identificar sesiones en el servidor. */
function deviceName(): string {
  const agent = globalThis.navigator?.userAgent ?? '';
  const platform = /Android/i.test(agent)
    ? 'Android'
    : /iPhone|iPad/i.test(agent)
      ? 'iOS'
      : /Windows/i.test(agent)
        ? 'Windows'
        : /Mac/i.test(agent)
          ? 'macOS'
          : /Linux/i.test(agent)
            ? 'Linux'
            : 'Web';
  return `Piston · ${platform}`;
}
