import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GaugeComponent } from '../../shared/gauge/gauge.component';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface HealthItem {
  readonly icon: IconName;
  readonly name: string;
  readonly detail: string;
  readonly progress: number;
  readonly tone: 'good' | 'warn' | 'bad';
  readonly status: string;
}

interface ActivityItem {
  readonly icon: IconName;
  readonly title: string;
  readonly sub: string;
  readonly amount: string;
}

/**
 * MAQUETA. Todos los datos son fijos y están escritos a mano; no hay
 * IndexedDB, ni API, ni cálculo real detrás. El objetivo es fijar jerarquía,
 * ritmo y estética antes de conectar nada.
 */
@Component({
  selector: 'pst-garage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, GaugeComponent],
  templateUrl: './garage.component.html',
  styleUrl: './garage.component.scss',
})
export class GarageComponent {
  private readonly island = inject(IslandService);

  constructor() {
    this.island.present({
      icon: 'fuel',
      label: 'Tanque',
      value: '5/8',
      tone: 'good',
      title: 'Nivel de combustible',
      subtitle: 'Mazda 3 Sedan · estimado',
      details: [
        { label: 'Restante', value: '~31 L' },
        { label: 'Autonomía', value: '~405 km' },
        { label: 'Última carga', value: 'hace 6 d' },
      ],
    });
  }

  protected readonly health: readonly HealthItem[] = [
    {
      icon: 'droplet',
      name: 'Aceite y filtro',
      detail: 'Faltan 2,350 km',
      progress: 76,
      tone: 'good',
      status: 'En regla',
    },
    {
      icon: 'tire',
      name: 'Rotación de llantas',
      detail: 'Faltan 480 km',
      progress: 94,
      tone: 'warn',
      status: 'Próximo',
    },
    {
      icon: 'wrench',
      name: 'Balatas delanteras',
      detail: 'Vencido hace 1,200 km',
      progress: 100,
      tone: 'bad',
      status: 'Vencido',
    },
  ];

  protected readonly activity: readonly ActivityItem[] = [
    { icon: 'fuel', title: 'Carga de combustible', sub: 'Mobil Universidad · 8 sep', amount: '$920.00' },
    { icon: 'wrench', title: 'Cambio de aceite', sub: 'Taller Hernández · 2 sep', amount: '$1,450.00' },
    { icon: 'shield', title: 'Póliza de seguro', sub: 'Renovación anual · 28 ago', amount: '$8,400.00' },
    { icon: 'receipt', title: 'Verificación', sub: 'Verificentro 04 · 15 ago', amount: '$628.00' },
  ];
}
