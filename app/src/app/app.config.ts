import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';
import { OnboardingService } from './core/auth/onboarding.service';
import { SyncService } from './core/sync/sync.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),

    // withFetch: el service worker intercepta `fetch`, no XHR. Sin esto las
    // peticiones de la API se le escapan al worker y la política de red de
    // ngsw no aplica.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),

    provideServiceWorker('ngsw-worker.js', {
      // En `ng serve` no hay worker: cachearía el bundle y el hot reload
      // dejaría de reflejar los cambios.
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),

    /**
     * Arranque.
     *
     * Solo se espera a leer la sesión local de IndexedDB, que es inmediato y
     * no toca la red: las guardas de ruta la necesitan para decidir entre
     * login, wizard o pestañas. El sync NO se espera: una app offline-first
     * que se queda en blanco esperando a la red es justo lo que se evita.
     *
     * El catálogo ya no se siembra aquí sino en la ventana de sincronización,
     * DESPUÉS del primer pull: sembrar antes haría que un segundo dispositivo
     * duplicara el catálogo que ya existe en el servidor.
     */
    provideAppInitializer(async () => {
      const auth = inject(AuthService);
      const sync = inject(SyncService);
      inject(OnboardingService); // empieza a escuchar el onboarding del servidor

      await auth.restore();
      sync.start();
    }),
  ],
};
