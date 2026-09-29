import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  isApiErrorBody,
  type ApiCode,
  type ApiEnvelope,
  type AuthUser,
  type OnboardingDraft,
  type OnboardingStep,
  type SyncPullResponse,
  type SyncPushMutation,
  type SyncPushResponse,
} from '../models';

/** Campos de perfil editables con `PATCH /api/me`. */
export type ProfilePatch = Partial<
  Pick<AuthUser, 'name' | 'locale' | 'currency' | 'distance_unit' | 'volume_unit'>
>;

export interface BackendHealth {
  readonly status: 'ok' | 'degraded';
  readonly service: string;
  readonly version: string;
  readonly database: 'connected' | 'disconnected';
}

/**
 * Error de red o de servidor que SÍ vale la pena reintentar.
 *
 * La distinción es el corazón del backoff: un 422 por un campo inválido no se
 * arregla reintentando —hay que sacar la mutación de la cola y avisar—, pero un
 * 503 o un cable desconectado sí.
 */
export class RetriableApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiCode | null = null,
  ) {
    super(message);
    this.name = 'RetriableApiError';
  }
}

/** Error definitivo: reintentar solo repite el mismo rechazo. */
export class PermanentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiCode | null = null,
    /** Mensajes por campo cuando el servidor rechazó la validación. */
    readonly errors: Readonly<Record<string, readonly string[]>> | null = null,
  ) {
    super(message);
    this.name = 'PermanentApiError';
  }
}

/**
 * El servidor no reconoce la sesión (401).
 *
 * NO es un rechazo de la fila ni un fallo transitorio: la mutación es válida y
 * el servidor está bien, solo falta volver a iniciar sesión. Por eso no cuenta
 * como intento ni la saca de la cola; el sync se pausa hasta que haya sesión.
 */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  async health(): Promise<BackendHealth> {
    return this.request(this.http.get<ApiEnvelope<BackendHealth>>(`${this.base}/health`));
  }

  /** Sync delta: todo lo cambiado después de `since`, tombstones incluidos. */
  async pull(since: number): Promise<SyncPullResponse> {
    return this.request(
      this.http.get<ApiEnvelope<SyncPullResponse>>(`${this.base}/sync`, { params: { since } }),
    );
  }

  /** Empuja un lote de mutaciones. El servidor responde qué aplicó y qué rechazó. */
  async push(mutations: readonly SyncPushMutation[]): Promise<SyncPushResponse> {
    return this.request(
      this.http.post<ApiEnvelope<SyncPushResponse>>(`${this.base}/sync`, { mutations }),
    );
  }

  /** Sube el binario de un adjunto que ya existe como fila. */
  async uploadAttachment(attachmentId: string, file: Blob, fileName: string): Promise<void> {
    const form = new FormData();
    form.append('file', file, fileName);
    await this.request(
      this.http.post<ApiEnvelope<void>>(`${this.base}/attachments/${attachmentId}/file`, form),
    );
  }

  // ── Cuenta ────────────────────────────────────────────────────────────

  async me(): Promise<AuthUser> {
    return this.request(this.http.get<ApiEnvelope<AuthUser>>(`${this.base}/me`));
  }

  async updateProfile(patch: ProfilePatch): Promise<AuthUser> {
    return this.request(this.http.patch<ApiEnvelope<AuthUser>>(`${this.base}/me`, patch));
  }

  async updatePassword(currentPassword: string, password: string): Promise<void> {
    await this.request(
      this.http.put<ApiEnvelope<void>>(`${this.base}/me/password`, {
        current_password: currentPassword,
        password,
      }),
    );
  }

  /** Sube el progreso del wizard. El servidor responde el estado vigente (puede ganar el suyo). */
  async saveOnboarding(
    step: Exclude<OnboardingStep, 'done'>,
    draft: OnboardingDraft | null,
    updatedAt: string,
  ): Promise<AuthUser> {
    return this.request(
      this.http.put<ApiEnvelope<AuthUser>>(`${this.base}/me/onboarding`, {
        step,
        draft,
        updated_at: updatedAt,
      }),
    );
  }

  async completeOnboarding(): Promise<AuthUser> {
    return this.request(this.http.post<ApiEnvelope<AuthUser>>(`${this.base}/me/onboarding/complete`, {}));
  }

  /**
   * Desenvuelve el sobre estándar y traduce el error de Angular a la
   * dicotomía reintentable / definitivo.
   *
   * `status === 0` es el caso importante: no hubo respuesta (sin red, CORS,
   * servidor caído). Siempre reintentable.
   */
  private async request<T>(observable: Observable<ApiEnvelope<T>>): Promise<T> {
    try {
      return await firstValueFrom(observable.pipe(map((envelope) => envelope.data)));
    } catch (error) {
      if (!(error instanceof HttpErrorResponse)) {
        throw new RetriableApiError(String(error), 0);
      }

      // Si respondió la API, su sobre trae un mensaje pensado para humanos y
      // un código estable. Si respondió otra cosa (proxy, HTML), solo queda
      // el status.
      const body = isApiErrorBody(error.error) ? error.error : null;
      const detail = body?.message ?? error.message;
      const code = body?.code ?? null;

      // El interceptor ya intentó renovar el access token. Si aun así llega un
      // 401, la sesión murió de verdad.
      if (error.status === 401) {
        throw new AuthRequiredError(detail);
      }

      // 404/501 = el endpoint todavía no existe (backend a medio construir,
      // deploy en curso). Eso NO es culpa de la fila: marcarla como rechazada
      // envenenaría la cola entera con mutaciones perfectamente válidas.
      const retriable =
        error.status === 0 ||
        error.status === 404 ||
        error.status === 408 ||
        error.status === 429 ||
        error.status === 501 ||
        error.status >= 500;

      if (retriable) {
        throw new RetriableApiError(detail, error.status, code);
      }

      // 400 / 403 / 409 / 422 sí son del payload: reintentar repite el mismo rechazo.
      throw new PermanentApiError(detail, error.status, code, body?.errors ?? null);
    }
  }
}
