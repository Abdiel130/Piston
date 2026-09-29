import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { OnboardingService } from './onboarding.service';

/**
 * Las tres guardas leen solo estado local (signals e IndexedDB). Ninguna
 * espera a la red: una app offline-first que no navega sin señal no lo es.
 */

/** Hay dueño en el dispositivo. Una sesión expirada cuenta: los datos siguen siendo suyos. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.hasSession() ? true : inject(Router).parseUrl('/login');
};

/** La pantalla de login solo tiene sentido sin sesión o con la sesión vencida. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.state() === 'authenticated' ? inject(Router).parseUrl('/') : true;
};

/** Las pestañas exigen haber terminado el wizard. */
export const onboardedGuard: CanActivateFn = async () => {
  const step = await inject(OnboardingService).currentStep();
  return step === 'done' ? true : inject(Router).parseUrl('/welcome');
};

/** Y el wizard deja de estar disponible una vez terminado. */
export const onboardingGuard: CanActivateFn = async () => {
  const step = await inject(OnboardingService).currentStep();
  return step === 'done' ? inject(Router).parseUrl('/') : true;
};
