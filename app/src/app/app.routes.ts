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
        path: 'settings/vehicles/new',
        title: 'Nuevo vehículo · Piston',
        loadComponent: () =>
          import('./features/vehicles/vehicle-form.component').then((m) => m.VehicleFormComponent),
      },
      {
        path: 'settings/vehicles/:id',
        title: 'Vehículo · Piston',
        loadComponent: () =>
          import('./features/vehicles/vehicle-form.component').then((m) => m.VehicleFormComponent),
      },
      {
        path: 'vehicle',
        title: 'Datos del vehículo · Piston',
        loadComponent: () =>
          import('./features/vehicle/vehicle-details.component').then((m) => m.VehicleDetailsComponent),
      },
      {
        // El mismo formulario de Ajustes; solo cambia a dónde regresa.
        path: 'vehicle/edit/:id',
        title: 'Editar vehículo · Piston',
        data: { back: '/vehicle', backLabel: 'Vehículo' },
        loadComponent: () =>
          import('./features/vehicles/vehicle-form.component').then((m) => m.VehicleFormComponent),
      },
      {
        path: 'vehicle/insurance',
        title: 'Póliza de seguro · Piston',
        loadComponent: () =>
          import('./features/vehicle/insurance.component').then((m) => m.InsuranceComponent),
      },
      {
        // Alta y renovación (`?renew=<id>`). Va antes de `:id`.
        path: 'vehicle/insurance/new',
        title: 'Nueva póliza · Piston',
        data: { type: 'insurance', back: '/vehicle/insurance', backLabel: 'Póliza' },
        loadComponent: () =>
          import('./features/vehicle/document-form.component').then((m) => m.DocumentFormComponent),
      },
      {
        path: 'vehicle/insurance/:id',
        title: 'Editar póliza · Piston',
        data: { type: 'insurance', back: '/vehicle/insurance', backLabel: 'Póliza' },
        loadComponent: () =>
          import('./features/vehicle/document-form.component').then((m) => m.DocumentFormComponent),
      },
      {
        path: 'vehicle/documents',
        title: 'Documentos · Piston',
        loadComponent: () =>
          import('./features/vehicle/documents.component').then((m) => m.DocumentsComponent),
      },
      {
        // Alta y renovación (`?type=<tipo>&renew=<id>`). Va antes de `:id`.
        // Sin `type` en data: lo da el query param, o el documento al editar.
        path: 'vehicle/documents/new',
        title: 'Nuevo documento · Piston',
        data: { back: '/vehicle/documents', backLabel: 'Documentos' },
        loadComponent: () =>
          import('./features/vehicle/document-form.component').then((m) => m.DocumentFormComponent),
      },
      {
        path: 'vehicle/documents/:id',
        title: 'Editar documento · Piston',
        data: { back: '/vehicle/documents', backLabel: 'Documentos' },
        loadComponent: () =>
          import('./features/vehicle/document-form.component').then((m) => m.DocumentFormComponent),
      },
      {
        path: 'vehicle/reminders',
        title: 'Recordatorios · Piston',
        loadComponent: () =>
          import('./features/vehicle/reminders.component').then((m) => m.RemindersComponent),
      },
      {
        // Alta (`?template=<id>` arranca de una plantilla). Va antes de `:id`.
        path: 'vehicle/reminders/new',
        title: 'Nuevo recordatorio · Piston',
        data: { back: '/vehicle/reminders', backLabel: 'Recordatorios' },
        loadComponent: () =>
          import('./features/vehicle/reminder-form.component').then((m) => m.ReminderFormComponent),
      },
      {
        path: 'vehicle/reminders/:id',
        title: 'Editar recordatorio · Piston',
        data: { back: '/vehicle/reminders', backLabel: 'Recordatorios' },
        loadComponent: () =>
          import('./features/vehicle/reminder-form.component').then((m) => m.ReminderFormComponent),
      },
      {
        path: 'settings/notifications',
        title: 'Notificaciones · Piston',
        loadComponent: () =>
          import('./features/settings/notifications.component').then((m) => m.NotificationSettingsComponent),
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
