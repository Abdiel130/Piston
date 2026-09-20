import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface SettingRow {
  readonly icon: IconName;
  readonly title: string;
  readonly value?: string;
}

interface SettingGroup {
  readonly title: string;
  readonly rows: readonly SettingRow[];
}

/** MAQUETA: ningún ajuste hace nada todavía. */
@Component({
  selector: 'pst-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './settings.component.html',
})
export class SettingsComponent {
  private readonly island = inject(IslandService);

  constructor() {
    this.island.present({
      icon: 'cloudOff',
      label: 'Sin conexión',
      value: '3',
      tone: 'warn',
      title: 'Cambios sin sincronizar',
      subtitle: 'Se enviarán al recuperar la señal',
      details: [
        { label: 'En cola', value: '3' },
        { label: 'Fotos', value: '1' },
        { label: 'Último sync', value: 'hace 2 h' },
      ],
      pulsing: true,
    });
  }

  protected readonly groups: readonly SettingGroup[] = [
    {
      title: 'Vehículos',
      rows: [
        { icon: 'car', title: 'Mazda 3 Sedan', value: 'Principal' },
        { icon: 'plus', title: 'Agregar vehículo' },
        { icon: 'garage', title: 'Vehículos archivados', value: '0' },
      ],
    },
    {
      title: 'Datos y sincronización',
      rows: [
        { icon: 'sync', title: 'Sincronización', value: 'Automática' },
        { icon: 'cloudCheck', title: 'Último respaldo', value: 'hace 2 h' },
        { icon: 'document', title: 'Exportar expediente' },
      ],
    },
    {
      title: 'Recordatorios',
      rows: [
        { icon: 'bell', title: 'Notificaciones', value: 'Activadas' },
        { icon: 'calendar', title: 'Avisar antes de', value: '15 días' },
        { icon: 'road', title: 'Avisar antes de', value: '500 km' },
      ],
    },
    {
      title: 'Unidades',
      rows: [
        { icon: 'road', title: 'Distancia', value: 'Kilómetros' },
        { icon: 'droplet', title: 'Volumen', value: 'Litros' },
        { icon: 'receipt', title: 'Moneda', value: 'MXN' },
      ],
    },
  ];
}
