import { Routes } from '@angular/router';
import { authGuard, guestGuard, onboardedGuard, onboardingGuard } from './core/auth/guards';

/**
 * Cinco destinos, uno por pestaña, detrás de la sesión y del wizard. Todas
 * las pantallas se cargan de forma diferida: en una PWA offline-first el
 * primer arranque debe ser lo más ligero posible, y el resto entra en caché
 * sobre la marcha.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'Iniciar sesión · Piston',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'welcome',
    title: 'Bienvenida · Piston',
    canActivate: [authGuard, onboardingGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding.component').then((m) => m.OnboardingComponent),
  },
  {
    path: '',
    canActivate: [authGuard, onboardedGuard],
    children: [
      {
        path: '',
        title: 'Garage · Piston',
        loadComponent: () =>
          import('./features/garage/garage.component').then((m) => m.GarageComponent),
      },
      {
        path: 'fuel',
        title: 'Combustible · Piston',
        loadComponent: () =>
          import('./features/fuel/fuel.component').then((m) => m.FuelComponent),
      },
      {
        path: 'services',
        title: 'Servicios · Piston',
        loadComponent: () =>
          import('./features/service/service.component').then((m) => m.ServiceComponent),
      },
      {
        path: 'expenses',
        title: 'Gastos · Piston',
        loadComponent: () =>
          import('./features/expenses/expenses.component').then((m) => m.ExpensesComponent),
      },
      {
        path: 'settings',
        title: 'Ajustes · Piston',
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'fuel/new',
        title: 'Nueva carga · Piston',
        loadComponent: () =>
          import('./features/capture/fuel-capture.component').then((m) => m.FuelCaptureComponent),
      },
      {
        path: 'services/new',
        title: 'Nuevo servicio · Piston',
        loadComponent: () =>
          import('./features/capture/service-capture.component').then((m) => m.ServiceCaptureComponent),
      },
      {
        path: 'expenses/new',
        title: 'Nuevo gasto · Piston',
        loadComponent: () =>
          import('./features/capture/expense-capture.component').then((m) => m.ExpenseCaptureComponent),
      },
      {
        path: 'odometer/new',
        title: 'Anotar odómetro · Piston',
        loadComponent: () =>
          import('./features/capture/odometer-capture.component').then((m) => m.OdometerCaptureComponent),
      },
      {
        path: 'settings/sync',
        title: 'Sincronización · Piston',
        loadComponent: () =>
          import('./features/sync/sync-center.component').then((m) => m.SyncCenterComponent),
      },
      {
        path: 'settings/sync/change/:id',
        title: 'Cambio pendiente · Piston',
        data: { kind: 'change' },
        loadComponent: () =>
          import('./features/sync/sync-change.component').then((m) => m.SyncChangeComponent),
      },
      {
        path: 'settings/sync/conflict/:id',
        title: 'Conflicto · Piston',
        loadComponent: () =>
          import('./features/sync/sync-conflict.component').then((m) => m.SyncConflictComponent),
      },
      {
        path: 'settings/sync/file/:id',
        title: 'Archivo pendiente · Piston',
        data: { kind: 'upload' },
        loadComponent: () =>
          import('./features/sync/sync-change.component').then((m) => m.SyncChangeComponent),
      },
      {
        path: 'settings/sync/event/:id',
        title: 'Evento de sincronización · Piston',
        loadComponent: () =>
          import('./features/sync/sync-event.component').then((m) => m.SyncEventComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
