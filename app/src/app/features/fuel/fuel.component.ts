import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { GaugeComponent } from '../../shared/gauge/gauge.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface FuelRow {
  readonly date: string;
  readonly station: string;
  readonly liters: string;
  readonly amount: string;
  readonly efficiency: string;
  /** Exacto (tanque lleno) vs estimado por rayitas. Se muestra SIEMPRE. */
  readonly exact: boolean;
}

/** MAQUETA: nada se guarda. El selector de rayitas solo mueve el medidor. */
@Component({
  selector: 'pst-fuel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, GaugeComponent],
  templateUrl: './fuel.component.html',
  styleUrl: './fuel.component.scss',
})
export class FuelComponent {
  private readonly island = inject(IslandService);

  /** Único estado interactivo de toda la maqueta, y existe solo para poder
   *  ver la animación del medidor al tocar una rayita. */
  protected readonly gaugeValue = signal(5);
  protected readonly segments = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  constructor() {
    this.island.present({
      icon: 'gauge',
      label: 'Rendimiento',
      value: '13.1 km/L',
      tone: 'brand',
      title: 'Rendimiento actual',
      subtitle: 'Promedio de las últimas 5 cargas',
      details: [
        { label: 'Mejor', value: '14.2' },
        { label: 'Peor', value: '11.8' },
        { label: 'Costo/km', value: '$1.83' },
      ],
    });
  }

  protected select(value: number): void {
    this.gaugeValue.set(value);
  }

  protected readonly rows: readonly FuelRow[] = [
    { date: '8 sep', station: 'Shell Constitución', liters: '38.41 L', amount: '$920.00', efficiency: '13.1 km/L', exact: true },
    { date: '2 sep', station: 'Mobil Universidad', liters: '24.89 L', amount: '$600.00', efficiency: '12.8 km/L', exact: false },
    { date: '24 ago', station: 'Pemex Central', liters: '31.20 L', amount: '$745.00', efficiency: '13.4 km/L', exact: false },
    { date: '16 ago', station: 'Shell Constitución', liters: '42.05 L', amount: '$1,010.00', efficiency: '14.2 km/L', exact: true },
  ];
}
