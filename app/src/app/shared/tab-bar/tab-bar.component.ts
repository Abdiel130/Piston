import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent, type IconName } from '../icon/icon.component';

interface Tab {
  readonly path: string;
  readonly icon: IconName;
  readonly label: string;
}

/**
 * Barra de pestañas al estilo iOS: cinco destinos como máximo, siempre
 * visibles, sin ocultarse al hacer scroll. Un menú que desaparece obliga a
 * recordar dónde estaba; uno fijo se puede alcanzar con el pulgar sin mirar.
 */
@Component({
  selector: 'pst-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './tab-bar.component.html',
  styleUrl: './tab-bar.component.scss',
})
export class TabBarComponent {
  protected readonly tabs: readonly Tab[] = [
    { path: '/', icon: 'garage', label: 'Garage' },
    { path: '/fuel', icon: 'fuel', label: 'Combustible' },
    { path: '/services', icon: 'wrench', label: 'Servicios' },
    { path: '/expenses', icon: 'receipt', label: 'Gastos' },
    { path: '/settings', icon: 'settings', label: 'Ajustes' },
  ];
}
