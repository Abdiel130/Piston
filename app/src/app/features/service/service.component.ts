import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface ScheduleRow {
  readonly icon: IconName;
  readonly name: string;
  readonly due: string;
  readonly tone: 'good' | 'warn' | 'bad';
  readonly status: string;
  readonly progress: number;
}

interface IssueRow {
  readonly title: string;
  readonly noticed: string;
  readonly severity: 'good' | 'warn' | 'bad';
  readonly severityLabel: string;
}

/** MAQUETA: datos fijos. */
@Component({
  selector: 'pst-service',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './service.component.html',
  styleUrl: './service.component.scss',
})
export class ServiceComponent {
  private readonly island = inject(IslandService);

  constructor() {
    this.island.present({
      icon: 'alert',
      label: 'Próximo servicio',
      value: '480 km',
      tone: 'warn',
      title: 'Rotación de llantas',
      subtitle: 'Vence al llegar a 49,130 km',
      details: [
        { label: 'Faltan', value: '480 km' },
        { label: 'Vencidos', value: '1' },
        { label: 'Al día', value: '6' },
      ],
      pulsing: true,
    });
  }

  protected readonly schedules: readonly ScheduleRow[] = [
    { icon: 'wrench', name: 'Balatas delanteras', due: 'Vencido hace 1,200 km', tone: 'bad', status: 'Vencido', progress: 100 },
    { icon: 'tire', name: 'Rotación de llantas', due: 'En 480 km', tone: 'warn', status: 'Próximo', progress: 94 },
    { icon: 'droplet', name: 'Aceite y filtro', due: 'En 2,350 km', tone: 'good', status: 'En regla', progress: 76 },
    { icon: 'spark', name: 'Bujías', due: 'En 11,400 km', tone: 'good', status: 'En regla', progress: 43 },
    { icon: 'droplet', name: 'Anticongelante', due: 'En 8 meses', tone: 'good', status: 'En regla', progress: 33 },
  ];

  protected readonly issues: readonly IssueRow[] = [
    { title: 'Ruido metálico al frenar en reversa', noticed: 'Detectado el 3 sep · 48,410 km', severity: 'warn', severityLabel: 'Media' },
    { title: 'Vibración leve arriba de 110 km/h', noticed: 'Detectado el 21 ago · 47,900 km', severity: 'good', severityLabel: 'Baja' },
  ];

  protected readonly history = [
    { name: 'Cambio de aceite 5W-30', shop: 'Taller Hernández', date: '2 sep', km: '48,200 km', cost: '$1,450' },
    { name: 'Filtro de aire y cabina', shop: 'Autopartes Delta', date: '10 may', km: '40,000 km', cost: '$680' },
    { name: 'Balatas cerámicas + discos', shop: 'Frenos MX', date: '20 mar', km: '36,500 km', cost: '$2,100' },
  ];
}
