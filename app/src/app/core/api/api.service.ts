import { HttpClient, HttpErrorResponse, HttpHeaders, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TimeoutError, firstValueFrom, timeout, type Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { uuidV7 } from '../db/uuid';
import {
  isApiErrorBody,
  type ApiCode,
  type ApiEnvelope,
  type AuthUser,
  type DomainTable,
  type OnboardingDraft,
  type OnboardingStep,
  type SyncPullResponse,
  type SyncPushMutation,
  type SyncPushResponse,
  type SyncFields,
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

/** Lo que se sabe de una petición fallida, además del mensaje. */
export interface ApiErrorDetails {
  readonly code?: ApiCode | null;
  /** Mensajes por campo cuando el servidor rechazó la validación. */
  readonly errors?: Readonly<Record<string, readonly string[]>> | null;
  /** El `X-Request-Id` que se mandó. Existe aunque nunca haya llegado respuesta. */
  readonly requestId?: string | null;
  /** Segundos que pidió esperar el servidor (429/503). */
  readonly retryAfter?: number | null;
  readonly durationMs?: number | null;
  /** No hubo respuesta a tiempo: se cortó del lado del cliente. */
  readonly timedOut?: boolean;
}

/** Base de los errores de la API: todo lo necesario para diagnosticar un fallo. */
export abstract class ApiError extends Error {
  readonly code: ApiCode | null;
  readonly errors: Readonly<Record<string, readonly string[]>> | null;
  readonly requestId: string | null;
  readonly retryAfter: number | null;
  readonly durationMs: number | null;
  readonly timedOut: boolean;

  constructor(
    message: string,
    readonly status: number,
    details: ApiErrorDetails = {},
  ) {
    super(message);
    this.code = details.code ?? null;
    this.errors = details.errors ?? null;
    this.requestId = details.requestId ?? null;
    this.retryAfter = details.retryAfter ?? null;
    this.durationMs = details.durationMs ?? null;
    this.timedOut = details.timedOut ?? false;
  }
}

/**
 * Error de red o de servidor que SÍ vale la pena reintentar.
 *
 * La distinción es el corazón del backoff: un 422 por un campo inválido no se
 * arregla reintentando —hay que sacar la mutación de la cola y avisar—, pero un
 * 503 o un cable desconectado sí.
 */
export class RetriableApiError extends ApiError {
  override readonly name = 'RetriableApiError';
}

/** Error definitivo: reintentar solo repite el mismo rechazo. */
export class PermanentApiError extends ApiError {
  override readonly name = 'PermanentApiError';
}

/**
 * El servidor no reconoce la sesión (401).
 *
 * NO es un rechazo de la fila ni un fallo transitorio: la mutación es válida y
 * el servidor está bien, solo falta volver a iniciar sesión. Por eso no cuenta
 * como intento ni la saca de la cola; el sync se pausa hasta que haya sesión.
 */
export class AuthRequiredError extends ApiError {
  override readonly name = 'AuthRequiredError';

  constructor(message: string, details: ApiErrorDetails = {}) {
    super(message, 401, details);
  }
}

/** Respuesta exitosa más lo que el historial de sync quiere recordar de ella. */
export interface ApiResult<T> {
  readonly data: T;
  readonly requestId: string;
  readonly durationMs: number;
}

/** Push y pull no deben quedarse colgados: sin respuesta en 30 s, se reintenta después. */
const SYNC_TIMEOUT_MS = 30_000;

/** Un binario grande por datos móviles tarda; se le da más margen. */
const UPLOAD_TIMEOUT_MS = 120_000;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  async health(): Promise<BackendHealth> {
    return this.request((headers) =>
      this.http.get<ApiEnvelope<BackendHealth>>(`${this.base}/health`, { headers, observe: 'response' }),
    );
  }

  /** Sync delta: todo lo cambiado después de `since`, tombstones incluidos. */
  async pull(since: number): Promise<ApiResult<SyncPullResponse>> {
    return this.requestWithMeta(
      (headers) =>
        this.http.get<ApiEnvelope<SyncPullResponse>>(`${this.base}/sync`, {
          headers,
          params: { since },
          observe: 'response',
        }),
      SYNC_TIMEOUT_MS,
    );
  }

  /** Empuja un lote de mutaciones. El servidor responde qué aplicó y qué rechazó. */
  async push(mutations: readonly SyncPushMutation[]): Promise<ApiResult<SyncPushResponse>> {
    return this.requestWithMeta(
      (headers) =>
        this.http.post<ApiEnvelope<SyncPushResponse>>(
          `${this.base}/sync`,
          { mutations },
          { headers, observe: 'response' },
        ),
      SYNC_TIMEOUT_MS,
    );
  }

  /** La versión del servidor de una fila, o `null` si nunca llegó. Para "descartar cambio". */
  async row<T extends SyncFields>(table: DomainTable, id: string): Promise<T | null> {
    try {
      const result = await this.request((headers) =>
        this.http.get<ApiEnvelope<{ row: T }>>(`${this.base}/sync/${table}/${id}`, {
          headers,
          observe: 'response',
        }),
      );
      return result.row;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && error.code === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  /** Sube el binario de un adjunto que ya existe como fila. */
  async uploadAttachment(attachmentId: string, file: Blob, fileName: string): Promise<ApiResult<void>> {
    const form = new FormData();
    form.append('file', file, fileName);
    return this.requestWithMeta(
      (headers) =>
        this.http.post<ApiEnvelope<void>>(`${this.base}/attachments/${attachmentId}/file`, form, {
          headers,
          observe: 'response',
        }),
      UPLOAD_TIMEOUT_MS,
    );
  }

  // ── Cuenta ────────────────────────────────────────────────────────────

  async me(): Promise<AuthUser> {
    return this.request((headers) =>
      this.http.get<ApiEnvelope<AuthUser>>(`${this.base}/me`, { headers, observe: 'response' }),
    );
  }

  async updateProfile(patch: ProfilePatch): Promise<AuthUser> {
    return this.request((headers) =>
      this.http.patch<ApiEnvelope<AuthUser>>(`${this.base}/me`, patch, { headers, observe: 'response' }),
    );
  }

  async updatePassword(currentPassword: string, password: string): Promise<void> {
    await this.request((headers) =>
      this.http.put<ApiEnvelope<void>>(
        `${this.base}/me/password`,
        { current_password: currentPassword, password },
        { headers, observe: 'response' },
      ),
    );
  }

  /** Sube el progreso del wizard. El servidor responde el estado vigente (puede ganar el suyo). */
  async saveOnboarding(
    step: Exclude<OnboardingStep, 'done'>,
    draft: OnboardingDraft | null,
    updatedAt: string,
  ): Promise<AuthUser> {
    return this.request((headers) =>
      this.http.put<ApiEnvelope<AuthUser>>(
        `${this.base}/me/onboarding`,
        { step, draft, updated_at: updatedAt },
        { headers, observe: 'response' },
      ),
    );
  }

  async completeOnboarding(): Promise<AuthUser> {
    return this.request((headers) =>
      this.http.post<ApiEnvelope<AuthUser>>(
        `${this.base}/me/onboarding/complete`,
        {},
        { headers, observe: 'response' },
      ),
    );
  }

  private async request<T>(
    send: (headers: HttpHeaders) => Observable<HttpResponse<ApiEnvelope<T>>>,
    timeoutMs?: number,
  ): Promise<T> {
    return (await this.requestWithMeta(send, timeoutMs)).data;
  }

  /**
   * Desenvuelve el sobre estándar y traduce el error de Angular a la
   * dicotomía reintentable / definitivo.
   *
   * Cada petición lleva un `X-Request-Id` generado aquí. El servidor lo adopta
   * (es un UUID) y lo escribe en sus logs, así que el cliente conoce el id
   * incluso cuando la respuesta nunca llega: es lo que permite buscar en los
   * logs qué le pasó a un cambio que no subió.
   *
   * `status === 0` es el caso importante: no hubo respuesta (sin red, CORS,
   * servidor caído). Siempre reintentable.
   */
  private async requestWithMeta<T>(
    send: (headers: HttpHeaders) => Observable<HttpResponse<ApiEnvelope<T>>>,
    timeoutMs?: number,
  ): Promise<ApiResult<T>> {
    const requestId = uuidV7();
    const startedAt = Date.now();
    const headers = new HttpHeaders({ 'X-Request-Id': requestId });
    const call = send(headers);

    try {
      const response = await firstValueFrom(timeoutMs ? call.pipe(timeout(timeoutMs)) : call);
      return {
        data: response.body!.data,
        requestId: response.headers.get('X-Request-Id') ?? requestId,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw this.toApiError(error, requestId, Date.now() - startedAt);
    }
  }

  private toApiError(error: unknown, requestId: string, durationMs: number): ApiError {
    if (error instanceof TimeoutError) {
      return new RetriableApiError('El servidor no respondió a tiempo.', 0, {
        requestId,
        durationMs,
        timedOut: true,
      });
    }
    if (!(error instanceof HttpErrorResponse)) {
      return new RetriableApiError(String(error), 0, { requestId, durationMs });
    }

    // Si respondió la API, su sobre trae un mensaje pensado para humanos y
    // un código estable. Si respondió otra cosa (proxy, HTML), solo queda
    // el status.
    const body = isApiErrorBody(error.error) ? error.error : null;
    const retryAfterHeader = Number(error.headers?.get('Retry-After'));
    const details: ApiErrorDetails = {
      code: body?.code ?? null,
      errors: body?.errors ?? null,
      requestId: error.headers?.get('X-Request-Id') ?? requestId,
      retryAfter: body?.meta.retry_after ?? (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : null),
      durationMs,
    };
    const detail = body?.message ?? error.message;

    // El interceptor ya intentó renovar el access token. Si aun así llega un
    // 401, la sesión murió de verdad.
    if (error.status === 401) {
      return new AuthRequiredError(detail, details);
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
      return new RetriableApiError(detail, error.status, details);
    }

    // 400 / 403 / 409 / 413 / 422 sí son del payload: reintentar repite el mismo rechazo.
    return new PermanentApiError(detail, error.status, details);
  }
}
