import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Un icono se describe con geometría, no con markup.
 *
 * Guardar el `d` de cada trazo en vez de una cadena de SVG permite renderizarlo
 * con bindings normales de Angular, sin innerHTML ni sanitización, y deja el
 * grosor de línea y el color bajo control del CSS (`currentColor`).
 *
 * Todos los iconos comparten rejilla de 24×24 y trazo de 1.75, que es lo que
 * hace que el set se lea como un solo set y no como una colección de piezas
 * sueltas.
 */
interface IconShape {
  /** Trazos `<path d="...">`. */
  readonly paths?: readonly string[];
  /** Círculos `[cx, cy, r, relleno?]`. */
  readonly circles?: readonly (readonly [number, number, number, boolean?])[];
}

/**
 * Catálogo completo. Va embebido en el bundle a propósito: la app es
 * offline-first y un icono que depende de la red es un icono que no aparece
 * justo cuando el usuario está en una gasolinera sin señal.
 */
const ICONS: Readonly<Record<string, IconShape>> = {
  // --- Navegación principal -------------------------------------------------
  garage: {
    paths: [
      'M3.5 20.5V9.8a1 1 0 0 1 .62-.93l7.5-3a1 1 0 0 1 .76 0l7.5 3a1 1 0 0 1 .62.93v10.7',
      'M7.5 20.5v-6.2a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v6.2',
      'M7.5 17h9',
      'M2 20.5h20',
    ],
  },
  fuel: {
    paths: [
      'M4.5 20.5V5a2 2 0 0 1 2-2h4.6a2 2 0 0 1 2 2v15.5',
      'M3 20.5h12.1',
      'M6.7 6h4.2v3.4H6.7z',
      'M13.1 9.4h2.6a2 2 0 0 1 2 2v6a1.6 1.6 0 0 0 3.2 0v-6.6l-2.4-2.4',
    ],
  },
  wrench: {
    paths: [
      'M14.9 6.2a1 1 0 0 0 0 1.4l1.5 1.5a1 1 0 0 0 1.4 0l3.6-3.6a6 6 0 0 1-7.9 7.9l-6.6 6.6a2.1 2.1 0 0 1-3-3l6.6-6.6a6 6 0 0 1 7.9-7.9z',
    ],
  },
  receipt: {
    paths: [
      'M5.5 3h13v18l-2.2-1.5-2.2 1.5-2.1-1.5L9.8 21l-2.1-1.5L5.5 21z',
      'M9 8.5h6',
      'M9 12.5h6',
    ],
  },
  settings: {
    paths: ['M3.5 7.5h8.2', 'M16.3 7.5h4.2', 'M3.5 16.5h3.2', 'M11.3 16.5h9.2'],
    circles: [
      [14, 7.5, 2.4],
      [9, 16.5, 2.4],
    ],
  },

  // --- Dominio --------------------------------------------------------------
  car: {
    paths: [
      'M3.6 13.4l1.7-5A2.5 2.5 0 0 1 7.7 6.7h8.6a2.5 2.5 0 0 1 2.4 1.7l1.7 5',
      'M2.6 13.4h18.8v3.6a1 1 0 0 1-1 1h-1.6a1 1 0 0 1-1-1v-1H7.2v1a1 1 0 0 1-1 1H4.6a1 1 0 0 1-1-1z',
    ],
    circles: [
      [7, 15.4, 0.9, true],
      [17, 15.4, 0.9, true],
    ],
  },
  gauge: {
    paths: ['M4 17.5a8 8 0 1 1 16 0', 'M12 17.5l4-4.6'],
    circles: [[12, 17.5, 1.3, true]],
  },
  droplet: {
    paths: ['M12 3.2s6.2 6.6 6.2 10.5a6.2 6.2 0 0 1-12.4 0C5.8 9.8 12 3.2 12 3.2z'],
  },
  road: {
    paths: ['M7.2 21L9 3', 'M16.8 21L15 3', 'M12 5.5v2.6', 'M12 11.2v2.6', 'M12 16.9v2.6'],
  },
  tire: {
    paths: ['M12 3.5v4.2', 'M12 16.3v4.2', 'M3.5 12h4.2', 'M16.3 12h4.2'],
    circles: [
      [12, 12, 8.5],
      [12, 12, 3.4],
    ],
  },
  spark: {
    paths: ['M13.4 2.5L5.6 13.8h5.3L10.6 21.5l7.8-11.3h-5.3z'],
  },
  shield: {
    paths: ['M12 3l7.4 2.9v6.2c0 4.6-3.1 8.3-7.4 9.4-4.3-1.1-7.4-4.8-7.4-9.4V5.9z'],
  },
  document: {
    paths: [
      'M7 3h7.2L19 7.8V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
      'M14 3v5h5',
      'M9 13h6',
      'M9 16.8h4',
    ],
  },
  camera: {
    paths: [
      'M4 8.2h3.1l1.5-2.6h6.8l1.5 2.6H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z',
    ],
    circles: [[12, 13.4, 3.2]],
  },
  mapPin: {
    paths: ['M12 21.2s7-6.4 7-11.2a7 7 0 1 0-14 0c0 4.8 7 11.2 7 11.2z'],
    circles: [[12, 10, 2.6]],
  },
  chart: {
    paths: ['M3.5 18.2l5.2-5.6 3.4 2.9 6.6-7.3', 'M14.6 8.2h4.7v4.7'],
  },

  // --- Estado ---------------------------------------------------------------
  bell: {
    paths: [
      'M18 8.4a6 6 0 1 0-12 0c0 6.7-2.4 8.3-2.4 8.3h16.8S18 15.1 18 8.4z',
      'M13.7 20.2a2 2 0 0 1-3.4 0',
    ],
  },
  clock: {
    paths: ['M12 7.1V12l3.2 2'],
    circles: [[12, 12, 8.5]],
  },
  calendar: {
    paths: [
      'M5.2 5.8h13.6a1 1 0 0 1 1 1v12.4a1 1 0 0 1-1 1H5.2a1 1 0 0 1-1-1V6.8a1 1 0 0 1 1-1z',
      'M4.2 10.2h15.6',
      'M8.4 3.4v4',
      'M15.6 3.4v4',
    ],
  },
  alert: {
    paths: ['M12 4.2l8.8 15.3H3.2z', 'M12 9.8v4.3'],
    circles: [[12, 17, 0.85, true]],
  },
  checkCircle: {
    paths: ['M8.2 12.2l2.7 2.7 4.9-5.1'],
    circles: [[12, 12, 8.5]],
  },
  cloudOff: {
    paths: [
      'M18.6 18.6H7.2a4.5 4.5 0 0 1-1.1-8.9',
      'M8.8 5.9A5.5 5.5 0 0 1 18.2 10h.4a4.3 4.3 0 0 1 2.9 7',
      'M3 3l18 18',
    ],
  },
  cloudCheck: {
    paths: [
      'M18.6 18.6H7.2a4.5 4.5 0 0 1-.9-8.9 5.6 5.6 0 0 1 10.7-1.1h.6a4.5 4.5 0 0 1 1 8.9z',
      'M9.8 14.2l1.9 1.9 3.3-3.3',
    ],
  },
  sync: {
    paths: [
      'M20 12.6a8 8 0 0 1-13.6 5.1',
      'M4 11.4a8 8 0 0 1 13.6-5.1',
      'M17.2 2.6v4h-4',
      'M6.8 21.4v-4h4',
    ],
  },

  // --- Controles ------------------------------------------------------------
  chevronRight: { paths: ['M9.2 5.2l6.9 6.8-6.9 6.8'] },
  chevronLeft: { paths: ['M14.8 5.2L7.9 12l6.9 6.8'] },
  chevronDown: { paths: ['M5.2 9.2l6.8 6.9 6.8-6.9'] },
  plus: { paths: ['M12 5.2v13.6', 'M5.2 12h13.6'] },
  close: { paths: ['M6.4 6.4l11.2 11.2', 'M17.6 6.4L6.4 17.6'] },
  search: {
    paths: ['M16.1 16.1l4.4 4.4'],
    circles: [[10.8, 10.8, 6.3]],
  },
  more: {
    circles: [
      [5.2, 12, 1.25, true],
      [12, 12, 1.25, true],
      [18.8, 12, 1.25, true],
    ],
  },
  arrowUpRight: { paths: ['M7 17L17 7', 'M8.6 7H17v8.4'] },
};

export type IconName = keyof typeof ICONS;

/**
 * Uso: `<pst-icon name="fuel" [size]="20" />`
 *
 * Hereda color del contexto, así que se tiñe con `color` como si fuera texto.
 * `label` lo convierte en un icono con significado propio para lectores de
 * pantalla; sin él se marca como decorativo, que es lo correcto cuando va
 * acompañado de texto visible.
 */
@Component({
  selector: 'pst-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    style: 'display: inline-flex;',
  },
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.aria-hidden]="label() ? null : 'true'"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label()"
    >
      @for (d of shape().paths ?? []; track d) {
        <path [attr.d]="d" />
      }
      @for (c of shape().circles ?? []; track c) {
        <circle
          [attr.cx]="c[0]"
          [attr.cy]="c[1]"
          [attr.r]="c[2]"
          [attr.fill]="c[3] ? 'currentColor' : 'none'"
          [attr.stroke]="c[3] ? 'none' : 'currentColor'"
        />
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number>(24);
  readonly label = input<string | null>(null);

  /**
   * El trazo se adelgaza en iconos grandes y engorda en los pequeños, para que
   * el peso óptico se mantenga constante en toda la escala.
   */
  protected readonly strokeWidth = computed(() => {
    const s = this.size();
    if (s <= 16) return 2;
    if (s >= 40) return 1.5;
    return 1.75;
  });

  protected readonly shape = computed<IconShape>(() => ICONS[this.name()] ?? {});
}
