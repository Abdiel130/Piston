import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { db } from '../db/piston-db';
import {
  CURRENT,
  type ApiCode,
  type ApiEnvelope,
  type AuthTokenResponse,
  type AuthUser,
} from '../models';
import { authInterceptor } from './auth.interceptor';
import { AccountMismatchError, AuthService, CLIENT_HEADER } from './auth.service';

const API = `${environment.apiBaseUrl}/api`;

function user(id = 'u-1', email = 'ana@example.com'): AuthUser {
  return {
    id,
    name: 'Ana',
    email,
    locale: 'es-MX',
    currency: 'MXN',
    distance_unit: 'km',
    volume_unit: 'L',
    onboarding: { step: 'account', draft: null, updated_at: null, completed_at: null },
  };
}

/** Envuelve en el sobre estándar de la API. */
function ok<T>(data: T): ApiEnvelope<T> {
  return {
    success: true,
    code: 'ok',
    message: 'Listo.',
    data,
    meta: { request_id: 'req-1', timestamp: new Date().toISOString() },
  };
}

function fail(code: ApiCode, message = 'Error'): ApiEnvelope<null> {
  return { ...ok(null), success: false, code, message };
}

function tokens(access: string, who = user()): ApiEnvelope<AuthTokenResponse> {
  return ok({
    access_token: access,
    token_type: 'Bearer',
    expires_in: 900,
    expires_at: new Date(Date.now() + 900_000).toISOString(),
    user: who,
  });
}

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let client: HttpClient;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);

    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Espera a que salga la petición a `url` y la devuelve. Entre una petición y
   * la siguiente hay IndexedDB y Web Locks de por medio, así que un solo tick
   * no siempre basta: se sondea en vez de adivinar cuánto tarda.
   */
  function next(url: string): Promise<TestRequest> {
    return vi.waitFor(() => {
      const [pending] = http.match(url);
      if (!pending) throw new Error(`aún no sale ${url}`);
      return pending;
    });
  }

  async function login(access = 'a-1', who = user()): Promise<void> {
    const done = auth.login(who.email, 'secreto-123');
    const request = await next(`${API}/auth/login`);
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.headers.has(CLIENT_HEADER)).toBe(true);
    request.flush(tokens(access, who));
    await done;
  }

  it('el login guarda la identidad local pero nunca el token', async () => {
    await login('secreto-de-acceso');

    const session = await db.session.get(CURRENT);
    expect(session?.user.email).toBe('ana@example.com');
    expect(JSON.stringify(session)).not.toContain('secreto-de-acceso');
    expect(auth.state()).toBe('authenticated');
    expect(auth.justLoggedIn()).toBe(true);
  });

  it('restaura la sesión sin red: la app abre con sus datos', async () => {
    await login();
    const fresh = TestBed.runInInjectionContext(() => new AuthService());

    await fresh.restore();

    expect(fresh.state()).toBe('authenticated');
    expect(fresh.user()?.email).toBe('ana@example.com');
    http.expectNone(() => true);
  });

  it('refrescos simultáneos comparten una sola petición', async () => {
    await login();

    const first = auth.refresh();
    const second = auth.refresh();

    (await next(`${API}/auth/refresh`)).flush(tokens('a-2'));
    expect(await first).toBe('a-2');
    expect(await second).toBe('a-2');
  });

  it('un refresh rechazado deja la sesión expirada SIN borrar datos', async () => {
    await login();
    await db.sync_outbox.add({
      id: 'o-1',
      table_name: 'vehicles',
      row_id: 'v-1',
      op: 'insert',
      payload: '{}',
      base_rev: 0,
      base: null,
      resolve: null,
      conflict: null,
      status: 'pending',
      attempts: 0,
      last_attempt: null,
      blocked_by: null,
      next_retry_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const result = auth.refresh();
    (await next(`${API}/auth/refresh`)).flush(fail('refresh_invalid'), {
      status: 401,
      statusText: 'Unauthorized',
    });

    expect(await result).toBeNull();
    expect(auth.state()).toBe('expired');
    expect(auth.hasSession()).toBe(true);
    expect(await db.sync_outbox.count()).toBe(1);
    expect(await db.session.get(CURRENT)).toBeDefined();
  });

  it('una carrera de refresh (409) se reintenta una vez', async () => {
    await login();

    const result = auth.refresh();
    (await next(`${API}/auth/refresh`)).flush(fail('refresh_race'), {
      status: 409,
      statusText: 'Conflict',
    });
    (await next(`${API}/auth/refresh`)).flush(tokens('a-3'));

    expect(await result).toBe('a-3');
  });

  it('sin red el refresh falla en silencio y la sesión sigue viva', async () => {
    await login();

    const result = auth.refresh();
    (await next(`${API}/auth/refresh`)).error(new ProgressEvent('error'));

    expect(await result).toBeNull();
    expect(auth.state()).toBe('authenticated');
  });

  it('rechaza otra cuenta si el dispositivo tiene datos de la anterior', async () => {
    await login();
    await db.vehicles.put({ id: 'v-1' } as never);

    const attempt = auth.login('beto@example.com', 'otra-clave');
    (await next(`${API}/auth/login`)).flush(tokens('b-1', user('u-2', 'beto@example.com')));
    // La sesión que el servidor le abrió a la otra cuenta se cierra de inmediato.
    const logout = await next(`${API}/auth/logout`);
    expect(logout.request.headers.get('Authorization')).toBe('Bearer b-1');
    logout.flush(ok(null));

    await expect(attempt).rejects.toBeInstanceOf(AccountMismatchError);
    expect((await db.session.get(CURRENT))?.user.email).toBe('ana@example.com');
    expect(await db.vehicles.count()).toBe(1);
  });

  it('un cambio de perfil local sobrevive a un refresh con el perfil viejo', async () => {
    await db.session.put({ key: CURRENT, user: user(), last_login_at: new Date().toISOString() });
    await auth.restore();

    await auth.patchProfile({ distance_unit: 'mi', currency: 'USD' });
    expect(auth.user()?.distance_unit).toBe('mi');

    // El servidor todavía no lo sabe: lo que devuelve no debe deshacerlo.
    await auth.updateUser(user());
    expect(auth.user()?.distance_unit).toBe('mi');
    expect(auth.user()?.currency).toBe('USD');
    const session = await db.session.get(CURRENT);
    expect(session?.pending_profile).toEqual({ distance_unit: 'mi', currency: 'USD' });
  });

  describe('interceptor', () => {
    it('pone el Bearer y, ante un 401, renueva una vez y reintenta', async () => {
      await login('viejo');

      const response = firstValueFrom(client.get(`${API}/me`));
      const first = await next(`${API}/me`);
      expect(first.request.headers.get('Authorization')).toBe('Bearer viejo');
      first.flush(fail('unauthenticated'), { status: 401, statusText: 'Unauthorized' });

      (await next(`${API}/auth/refresh`)).flush(tokens('nuevo'));

      const retry = await next(`${API}/me`);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer nuevo');
      retry.flush(ok(user()));

      expect(await response).toEqual(ok(user()));
    });

    it('si el refresh tampoco sirve, el 401 sube sin bucles', async () => {
      await login('viejo');

      const response = firstValueFrom(client.get(`${API}/me`));
      (await next(`${API}/me`)).flush(fail('unauthenticated'), {
        status: 401,
        statusText: 'Unauthorized',
      });
      (await next(`${API}/auth/refresh`)).flush(fail('refresh_invalid'), {
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(response).rejects.toMatchObject({ status: 401 });
      http.verify();
    });
  });
});
