import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { SyncPullResponse, SyncPushMutation, SyncPushResponse } from '../models';

export interface BackendHealth {
  readonly status: string;
  readonly project: string;
  readonly version: string;
  readonly laravel_version: string;
  readonly php_version: string;
  readonly database: {
    readonly status: string;
    readonly driver: string;
    readonly error: string | null;
  };
  readonly timestamp: string;
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
  ) {
    super(message);
    this.name = 'PermanentApiError';
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/api`;

  async health(): Promise<BackendHealth> {
    return this.request(this.http.get<BackendHealth>(`${this.base}/health`));
  }

  /** Sync delta: todo lo cambiado después de `since`, tombstones incluidos. */
  async pull(since: number): Promise<SyncPullResponse> {
    return this.request(
      this.http.get<SyncPullResponse>(`${this.base}/sync`, { params: { since } }),
    );
  }

  /** Empuja un lote de mutaciones. El servidor responde qué aplicó y qué rechazó. */
  async push(mutations: readonly SyncPushMutation[]): Promise<SyncPushResponse> {
    return this.request(
      this.http.post<SyncPushResponse>(`${this.base}/sync`, { mutations }),
    );
  }

  /** Sube el binario de un adjunto que ya existe como fila. */
  async uploadAttachment(attachmentId: string, file: Blob, fileName: string): Promise<void> {
    const form = new FormData();
    form.append('file', file, fileName);
    await this.request(
      this.http.post<void>(`${this.base}/attachments/${attachmentId}/file`, form),
    );
  }

  /**
   * Traduce el error de Angular a la dicotomía reintentable / definitivo.
   *
   * `status === 0` es el caso importante: no hubo respuesta (sin red, CORS,
   * servidor caído). Siempre reintentable.
   */
  private async request<T>(observable: Parameters<typeof firstValueFrom<T>>[0]): Promise<T> {
    try {
      return await firstValueFrom(observable);
    } catch (error) {
      if (!(error instanceof HttpErrorResponse)) {
        throw new RetriableApiError(String(error), 0);
      }

      const detail = error.error?.message ?? error.message;

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
        throw new RetriableApiError(detail, error.status);
      }

      // 400 / 409 / 422 sí son del payload: reintentar repite el mismo rechazo.
      throw new PermanentApiError(detail, error.status);
    }
  }
}
