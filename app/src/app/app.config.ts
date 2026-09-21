import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { CatalogSeeder } from './core/db/seed';
import { SyncService } from './core/sync/sync.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),

    // withFetch: el service worker intercepta `fetch`, no XHR. Sin esto las
    // peticiones de la API se le escapan al worker y la política de red de
    // ngsw no aplica.
    provideHttpClient(withFetch()),

    provideServiceWorker('ngsw-worker.js', {
      // En `ng serve` no hay worker: cachearía el bundle y el hot reload
      // dejaría de reflejar los cambios.
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

    /**
     * Arranque de la capa offline.
     *
     * No se espera al resultado a propósito: si se devolviera la promesa,
     * Angular retrasaría el primer render hasta que terminara el primer sync,
     * y una app offline-first que se queda en blanco esperando a la red es
     * justo lo que se intenta evitar.
     */
    provideAppInitializer(() => {
      const seeder = inject(CatalogSeeder);
      const sync = inject(SyncService);
      inject(HttpClient); // fuerza la construcción del cliente antes del primer sync

      void seeder.seedIfEmpty().then(() => sync.start());
    }),
  ],
};
