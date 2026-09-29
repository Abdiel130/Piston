import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService, CLIENT_HEADER } from './auth.service';

const API = `${environment.apiBaseUrl}/api/`;
const AUTH_ROUTES = `${environment.apiBaseUrl}/api/auth/`;

/**
 * Pone el access token en cada petición a la API y, ante un 401, renueva una
 * sola vez y reintenta.
 *
 * Las rutas de `/api/auth/` van con `withCredentials` (es lo que hace viajar la
 * cookie del refresh) y sin Bearer automático: login y refresh no lo necesitan,
 * y logout lo pone él mismo.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(API)) {
    return next(request);
  }

  const tagged = request.clone({ setHeaders: { [CLIENT_HEADER]: 'web' } });

  if (request.url.startsWith(AUTH_ROUTES)) {
    return next(tagged.clone({ withCredentials: true }));
  }

  const auth = inject(AuthService);
  const withToken = (token: string | null): HttpRequest<unknown> =>
    token ? tagged.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : tagged;

  return from(auth.accessTokenFor()).pipe(
    switchMap((token) => next(withToken(token))),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      // El token pudo vencer entre la comprobación y la llegada al servidor, o
      // el servidor lo revocó. Un refresh lo aclara; si tampoco hay, el 401 sube.
      return from(auth.refresh()).pipe(
        switchMap((fresh) => (fresh ? next(withToken(fresh)) : throwError(() => error))),
      );
    }),
  );
};
