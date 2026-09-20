import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface Segment {
  readonly d: string;
  readonly filled: boolean;
  /** Retardo de entrada: las rayitas se encienden una tras otra, de vacío a lleno. */
  readonly delay: string;
}

const VIEWBOX = 120;
const CENTER = VIEWBOX / 2;
const RADIUS = 48;
/** Arco de 200°, abierto por abajo: la forma que todo el mundo lee como "medidor". */
const START_ANGLE = 170;
const SWEEP = 200;
/** Hueco entre rayitas, en grados. Es lo que las hace legibles como unidades. */
const GAP = 3;

function polar(angleDeg: number): readonly [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [CENTER + RADIUS * Math.cos(rad), CENTER + RADIUS * Math.sin(rad)];
}

function arc(fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(fromDeg);
  const [x2, y2] = polar(toDeg);
  const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * El medidor por rayitas.
 *
 * Se dibuja como segmentos discretos y no como un arco continuo a propósito:
 * el usuario no lee "62% de tanque", lee "cinco rayitas". Representar el dato
 * con la misma granularidad con la que se captura evita sugerir una precisión
 * que no existe.
 *
 * `value` acepta decimales para las medias rayitas: una rayita a medias se
 * dibuja a media opacidad en vez de redondearse.
 */
@Component({
  selector: 'pst-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gauge.component.html',
  styleUrl: './gauge.component.scss',
})
export class GaugeComponent {
  readonly segments = input<number>(8);
  readonly value = input<number>(0);
  readonly size = input<number>(160);
  /** Texto grande del centro. */
  readonly caption = input<string>('');
  /** Texto pequeño bajo el anterior. */
  readonly hint = input<string>('');

  protected readonly viewBox = `0 0 ${VIEWBOX} ${VIEWBOX}`;

  protected readonly arcs = computed<readonly Segment[]>(() => {
    const total = Math.max(1, this.segments());
    const step = SWEEP / total;
    const value = this.value();

    return Array.from({ length: total }, (_, i) => ({
      d: arc(START_ANGLE + i * step + GAP / 2, START_ANGLE + (i + 1) * step - GAP / 2),
      filled: i < value,
      delay: `${(i * 0.045).toFixed(3)}s`,
    }));
  });

  /**
   * De vacío a lleno: rojo → ámbar → verde. Es el mismo código de color que el
   * semáforo de mantenimiento, para que "ámbar" signifique lo mismo en toda la
   * app.
   */
  protected readonly tone = computed(() => {
    const ratio = this.value() / Math.max(1, this.segments());
    if (ratio <= 0.25) return 'var(--pst-bad)';
    if (ratio <= 0.5) return 'var(--pst-warn)';
    return 'var(--pst-good)';
  });
}
