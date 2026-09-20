import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface Category {
  readonly icon: IconName;
  readonly name: string;
  readonly amount: string;
  readonly share: number;
  readonly color: string;
}

/** MAQUETA: datos fijos. */
@Component({
  selector: 'pst-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.scss',
})
export class ExpensesComponent {
  private readonly island = inject(IslandService);

  constructor() {
    this.island.present({
      icon: 'receipt',
      label: 'Septiembre',
      value: '$4,318',
      tone: 'info',
      title: 'Gasto del mes',
      subtitle: '18% por encima de tu promedio',
      details: [
        { label: 'Combustible', value: '$2,840' },
        { label: 'Servicios', value: '$1,450' },
        { label: 'Por km', value: '$2.78' },
      ],
    });
  }

  protected readonly categories: readonly Category[] = [
    { icon: 'fuel', name: 'Combustible', amount: '$2,840', share: 66, color: 'var(--pst-ignition)' },
    { icon: 'wrench', name: 'Servicios', amount: '$1,450', share: 34, color: 'var(--pst-info)' },
    { icon: 'shield', name: 'Seguro', amount: '$700', share: 16, color: 'var(--pst-good)' },
    { icon: 'document', name: 'Trámites', amount: '$628', share: 15, color: 'var(--pst-warn)' },
    { icon: 'droplet', name: 'Lavado', amount: '$240', share: 6, color: 'var(--pst-idle)' },
  ];

  protected readonly upcoming = [
    { name: 'Tenencia 2027', when: 'Vence el 31 mar', amount: '$3,200' },
    { name: 'Verificación', when: 'Vence el 30 nov', amount: '$628' },
    { name: 'Póliza de seguro', when: 'Renueva el 28 ago', amount: '$8,400' },
  ];
}
