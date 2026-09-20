import { Routes } from '@angular/router';

/**
 * Cinco destinos, uno por pestaña. Todas las pantallas se cargan de forma
 * diferida: en una PWA offline-first el primer arranque debe ser lo más ligero
 * posible, y el resto entra en caché sobre la marcha.
 */
export const routes: Routes = [
  {
    path: '',
    title: 'Garage · Piston',
    loadComponent: () =>
      import('./features/garage/garage.component').then((m) => m.GarageComponent),
  },
  {
    path: 'combustible',
    title: 'Combustible · Piston',
    loadComponent: () =>
      import('./features/fuel/fuel.component').then((m) => m.FuelComponent),
  },
  {
    path: 'servicios',
    title: 'Servicios · Piston',
    loadComponent: () =>
      import('./features/service/service.component').then((m) => m.ServiceComponent),
  },
  {
    path: 'gastos',
    title: 'Gastos · Piston',
    loadComponent: () =>
      import('./features/expenses/expenses.component').then((m) => m.ExpensesComponent),
  },
  {
    path: 'ajustes',
    title: 'Ajustes · Piston',
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: '' },
];
