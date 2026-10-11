import {
  ChangeDetectionStrategy,
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

/** Lo que hay que arrastrar hacia abajo para que la hoja se cierre sola. */
const DISMISS_PX = 96;
/** Un tirón rápido cierra aunque recorra poco, como en iOS. */
const DISMISS_VELOCITY = 0.6;
/** Hacia arriba la hoja cede, pero cada vez menos: nunca pasa de esto. */
const STRETCH_PX = 24;
/**
 * Lo que debe recorrer el dedo antes de decidir si arrastra la hoja o desplaza
 * la lista. Menor que el umbral con el que el navegador empieza a desplazar,
 * para decidir antes que él.
 */
const SLOP_PX = 6;
/**
 * Respaldo por si `animationend` no llega (pestaña en segundo plano, motor sin
 * animaciones). Algo más que la salida más larga.
 */
const CLOSE_FALLBACK_MS = 600;

/** `closing` dura lo que la animación de salida; el `<dialog>` sigue abierto. */
type Phase = 'closed' | 'open' | 'closing';

/**
 * Un toque sobre el contenido empieza `pending`. Si el primer movimiento claro
 * es hacia abajo con la lista hasta arriba, pasa a `drag`; si no, a `scroll` y
 * la hoja ya no lo toca hasta que se levante el dedo.
 */
type Gesture = 'idle' | 'pending' | 'drag' | 'scroll';

/**
 * Hoja inferior modal. Es la única de la app: cualquier hoja nueva se arma con
 * `<pst-sheet [(open)]="…" label="…">` y su contenido.
 *
 * Va sobre `<dialog>` nativo a propósito: `showModal()` la pone en la capa
 * superior (sin pelear z-index con la isla ni la barra de pestañas), atrapa el
 * foco y cierra con Esc (y con el gesto de atrás de Android) sin código
 * propio. Lo que sí es propio es el gesto: tocar fuera o arrastrar hacia abajo
 * también la cierra. Se arrastra desde el asa o, en pantallas táctiles, desde
 * cualquier parte del contenido cuando la lista ya está hasta arriba, como en
 * las hojas nativas. Con ratón solo desde el asa, para no pelear con la
 * selección de texto.
 *
 * Al abrir, el foco va al propio `<dialog>` (`autofocus`) y no al primer
 * botón: ese botón todavía está fuera de la pantalla y el navegador
 * desplazaba la hoja para mostrarlo, lo que se veía como un parpadeo.
 *
 * Cerrar no es inmediato: primero corre la salida y solo al terminar se llama
 * a `dialog.close()`. Si se cerrara antes, la hoja desaparecería de golpe.
 */
@Component({
  selector: 'pst-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="sheet"
      autofocus
      [class.is-closing]="phase() === 'closing'"
      [class.is-dragging]="dragging()"
      [style.--sheet-veil]="veil()"
      [attr.aria-label]="label()"
      (click)="onBackdrop($event)"
      (cancel)="onCancel($event)"
      (close)="onClosed()"
    >
      <div
        #panel
        class="sheet__panel"
        [style.transform]="dragY() ? 'translateY(' + dragY() + 'px)' : null"
        (animationend)="onAnimationEnd($event)"
        (pointerdown)="dragStart($event)"
        (pointermove)="dragMove($event)"
        (pointerup)="dragEnd($event)"
        (pointercancel)="dragCancel()"
      >
        <div #grip class="sheet__grip">
          <span class="sheet__handle" aria-hidden="true"></span>
        </div>
        <div #body class="sheet__body pst-scroll-area">
          <ng-content />
        </div>
      </div>
    </dialog>
  `,
  styleUrl: './sheet.component.scss',
})
export class SheetComponent {
  readonly open = model(false);
  /** Nombre accesible del diálogo. */
  readonly label = input<string>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly grip = viewChild.required<ElementRef<HTMLElement>>('grip');
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  protected readonly phase = signal<Phase>('closed');
  protected readonly dragY = signal(0);
  protected readonly dragging = signal(false);
  /**
   * Cuánto velo queda: 1 con la hoja en su lugar, 0 si bajara entera. El
   * `::backdrop` lo hereda del `<dialog>` y con él escala oscuridad y blur,
   * así el fondo se va aclarando mientras el dedo baja la hoja.
   */
  protected readonly veil = computed(() => {
    const y = this.dragY();
    return y > 0 ? Math.max(0, 1 - y / this.panelHeight) : 1;
  });
  private panelHeight = 1;
  private gesture: Gesture = 'idle';
  private startY = 0;
  private startAt = 0;
  /** Tras un arrastre, el `click` que llega al soltar no debe activar un botón. */
  private swallowClick = false;
  private fallback: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open()) {
        clearTimeout(this.fallback);
        if (!dialog.open) dialog.showModal();
        // También rescata una hoja que se reabre a media salida.
        this.phase.set('open');
      } else if (dialog.open && this.phase() !== 'closing') {
        this.phase.set('closing');
        this.fallback = setTimeout(() => this.finishClose(), CLOSE_FALLBACK_MS);
      }
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.fallback));

    // Estos dos van a mano porque Angular no deja elegir `passive` ni la fase
    // de captura desde la plantilla.
    afterNextRender(() => {
      const panel = this.panel().nativeElement;
      // Cancelar el `touchmove` es lo único que impide al navegador desplazar
      // la lista mientras el dedo arrastra la hoja. Llega después del
      // `pointermove` del mismo movimiento, así que `gesture` ya está decidido.
      panel.addEventListener(
        'touchmove',
        (event) => {
          if (this.gesture === 'drag') event.preventDefault();
        },
        { passive: false },
      );
      panel.addEventListener(
        'click',
        (event) => {
          if (!this.swallowClick) return;
          this.swallowClick = false;
          event.preventDefault();
          event.stopPropagation();
        },
        { capture: true },
      );
    });
  }

  /** El panel no llena el `<dialog>`: un clic que cae en él mismo es fuera. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.open.set(false);
    }
  }

  /** Esc pasa por la misma salida animada que los demás cierres. */
  protected onCancel(event: Event): void {
    event.preventDefault();
    this.open.set(false);
  }

  /**
   * El `<dialog>` ya se cerró. Casi siempre fue `finishClose`, pero el
   * navegador puede forzarlo (un segundo Esc seguido no se deja cancelar).
   */
  protected onClosed(): void {
    clearTimeout(this.fallback);
    this.phase.set('closed');
    this.dragY.set(0);
    this.open.set(false);
  }

  /** Las animaciones del contenido también burbujean aquí; solo cuenta la salida. */
  protected onAnimationEnd(event: AnimationEvent): void {
    if (event.target === event.currentTarget && this.phase() === 'closing') {
      this.finishClose();
    }
  }

  private finishClose(): void {
    clearTimeout(this.fallback);
    const dialog = this.dialog().nativeElement;
    if (dialog.open && this.phase() === 'closing') dialog.close();
  }

  protected dragStart(event: PointerEvent): void {
    if (this.phase() !== 'open' || !event.isPrimary) return;
    this.swallowClick = false;
    const fromGrip = this.grip().nativeElement.contains(event.target as Node);
    if (!fromGrip && event.pointerType === 'mouse') return;
    this.startY = event.clientY;
    this.startAt = event.timeStamp;
    this.gesture = 'pending';
    // El asa no tiene nada que desplazar: arrastra desde el primer píxel.
    if (fromGrip) this.beginDrag(event);
  }

  protected dragMove(event: PointerEvent): void {
    if (this.gesture === 'pending') {
      const delta = event.clientY - this.startY;
      if (Math.abs(delta) < SLOP_PX) return;
      if (delta > 0 && this.body().nativeElement.scrollTop <= 0) {
        // Se toma como origen este punto: si no, la hoja saltaría el umbral.
        this.startY = event.clientY;
        this.beginDrag(event);
      } else {
        this.gesture = 'scroll';
      }
      return;
    }
    if (this.gesture !== 'drag') return;
    const delta = event.clientY - this.startY;
    // Hacia arriba la hoja ya está en su altura natural: solo se estira un
    // poco con resistencia, como el rebote de una lista en iOS.
    this.dragY.set(delta >= 0 ? delta : -STRETCH_PX * (1 - Math.exp(delta / (STRETCH_PX * 3))));
  }

  protected dragEnd(event: PointerEvent): void {
    const wasDragging = this.gesture === 'drag';
    this.gesture = 'idle';
    if (!wasDragging) return;
    const distance = this.dragY();
    const velocity = distance / Math.max(1, event.timeStamp - this.startAt);
    this.dragging.set(false);
    this.swallowClick = Math.abs(distance) > SLOP_PX;
    if (distance > DISMISS_PX || (distance > 16 && velocity > DISMISS_VELOCITY)) {
      // Se deja `dragY` tal cual: la salida parte de donde quedó el dedo.
      this.open.set(false);
    } else {
      this.dragY.set(0);
    }
  }

  protected dragCancel(): void {
    this.gesture = 'idle';
    this.dragging.set(false);
    this.dragY.set(0);
  }

  private beginDrag(event: PointerEvent): void {
    // Con la captura, el resto del gesto llega al panel aunque el dedo salga.
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.panelHeight = Math.max(1, this.panel().nativeElement.offsetHeight);
    this.gesture = 'drag';
    this.dragging.set(true);
  }
}
