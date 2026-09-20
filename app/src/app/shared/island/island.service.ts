import { Injectable, signal } from '@angular/core';
import type { IconName } from '../icon/icon.component';

/** Color semántico de la actividad. Tiñe el icono, el halo y el pulso. */
export type IslandTone = 'idle' | 'good' | 'warn' | 'bad' | 'info' | 'brand';

/** Una línea del detalle que aparece al expandir. */
export interface IslandDetail {
  readonly label: string;
  readonly value: string;
}

/**
 * Lo que la isla muestra AHORA.
 *
 * El modelo imita a una Live Activity de iOS: un estado vivo y contextual, no
 * un título de pantalla. Por eso cada pantalla publica el dato que más importa
 * en ese contexto (nivel de tanque en el garage, último rendimiento en
 * combustible, próximo servicio en mantenimiento) y la isla se transforma al
 * cambiar de pestaña. Esa transformación es la identidad de la app.
 */
export interface IslandActivity {
  readonly icon: IconName;
  /** Etiqueta corta a la izquierda. Se corta si no cabe, así que: 2-3 palabras. */
  readonly label: string;
  /** Cifra compacta a la derecha del estado colapsado. */
  readonly value: string;
  readonly tone: IslandTone;
  /** Encabezado del estado expandido. */
  readonly title: string;
  readonly subtitle: string;
  readonly details: readonly IslandDetail[];
  /**
   * Muestra el punto satélite latiendo junto a la píldora. Reservado para algo
   * que de verdad está ocurriendo (una sincronización en curso, una alerta sin
   * ver); si late siempre, deja de significar nada.
   */
  readonly pulsing?: boolean;
}

const DEFAULT_ACTIVITY: IslandActivity = {
  icon: 'car',
  label: 'Piston',
  value: '—',
  tone: 'idle',
  title: 'Sin vehículo activo',
  subtitle: 'Agrega un vehículo para empezar',
  details: [],
};

@Injectable({ providedIn: 'root' })
export class IslandService {
  private readonly _activity = signal<IslandActivity>(DEFAULT_ACTIVITY);
  private readonly _expanded = signal(false);

  readonly activity = this._activity.asReadonly();
  readonly expanded = this._expanded.asReadonly();

  /** La llama cada pantalla al entrar. */
  present(activity: IslandActivity): void {
    this._activity.set(activity);
  }

  reset(): void {
    this._activity.set(DEFAULT_ACTIVITY);
  }

  toggle(): void {
    this._expanded.update((open) => !open);
  }

  collapse(): void {
    this._expanded.set(false);
  }
}
