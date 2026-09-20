import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IslandService } from './island.service';

/**
 * La Dynamic Island de Piston.
 *
 * Tres detalles hacen que se sienta como iOS y no como un acordeón:
 *
 * 1. MORFOLOGÍA, no aparición. La píldora no desaparece para que aparezca una
 *    tarjeta: es la MISMA forma que cambia de ancho, alto y radio a la vez. Por
 *    eso se animan width/height/border-radius en lugar de usar scale o
 *    clip-path, que deformarían el contenido.
 *
 * 2. FUSIÓN GOOEY. El punto satélite y la píldora son dos formas separadas bajo
 *    un filtro de desenfoque + contraste. Al acercarse, sus bordes se funden
 *    como una gota de mercurio: es el truco exacto que usa iOS cuando una Live
 *    Activity se separa en dos blobs. El filtro se aplica solo a la capa de
 *    fondo; el contenido va encima y sin filtrar, si no saldría borroso.
 *
 * 3. EL CONTENIDO NO SE MUEVE CON LA CAJA. Al expandir, la caja usa la curva de
 *    muelle y el contenido entra un poco después con un desenfoque que se
 *    disipa. Ese desfase es lo que evita que parezca un `display: none`.
 */
@Component({
  selector: 'pst-dynamic-island',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './dynamic-island.component.html',
  styleUrl: './dynamic-island.component.scss',
})
export class DynamicIslandComponent {
  private readonly island = inject(IslandService);

  readonly activity = this.island.activity;
  readonly expanded = this.island.expanded;

  protected readonly toneVar = computed(() => {
    const map: Record<string, string> = {
      idle: 'var(--pst-idle)',
      good: 'var(--pst-good)',
      warn: 'var(--pst-warn)',
      bad: 'var(--pst-bad)',
      info: 'var(--pst-info)',
      brand: 'var(--pst-ignition)',
    };
    return map[this.activity().tone] ?? 'var(--pst-idle)';
  });

  protected toggle(): void {
    this.island.toggle();
  }
}
