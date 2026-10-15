import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { VehicleAlerts, worstTone } from '../../core/data/vehicle-alerts.service';
import { IconComponent, type IconName } from '../icon/icon.component';

interface Tab {
  readonly path: string;
  readonly icon: IconName;
  readonly label: string;
  /** Secciones que cuelgan de esta pestaña aunque su ruta no empiece igual. */
  readonly also?: readonly string[];
}

/**
 * Barra de pestañas al estilo iOS: cinco destinos como máximo, siempre
 * visibles, sin ocultarse al hacer scroll. Un menú que desaparece obliga a
 * recordar dónde estaba; uno fijo se puede alcanzar con el pulgar sin mirar.
 */
@Component({
  selector: 'pst-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  templateUrl: './tab-bar.component.html',
  styleUrl: './tab-bar.component.scss',
})
export class TabBarComponent {
  private readonly router = inject(Router);
  private readonly alerts = inject(VehicleAlerts);

  /** Avisos de TODOS los vehículos activos, no solo el de gestión: van en Garage. */
  protected readonly garageAlerts = computed(() => {
    const active = this.alerts.active();
    return active.length ? { count: active.length, tone: worstTone(active)! } : null;
  });

  protected readonly tabs: readonly Tab[] = [
    // La sección del vehículo se abre desde el garage: sigue siendo Garage.
    { path: '/', icon: 'garage', label: 'Garage', also: ['/vehicle'] },
    { path: '/fuel', icon: 'fuel', label: 'Combustible' },
    { path: '/services', icon: 'wrench', label: 'Servicios' },
    { path: '/expenses', icon: 'receipt', label: 'Gastos' },
    { path: '/settings', icon: 'settings', label: 'Ajustes' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** `/` solo exacto; las demás por prefijo de segmento, como `routerLinkActive`. */
  protected isActive(tab: Tab): boolean {
    const path = this.url().split(/[?#]/)[0];
    const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
    return (tab.path === '/' ? path === '/' : under(tab.path)) || (tab.also ?? []).some(under);
  }
}
