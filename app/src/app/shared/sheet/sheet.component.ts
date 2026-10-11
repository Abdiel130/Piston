import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';

/** Lo que hay que arrastrar hacia abajo para que la hoja se cierre sola. */
const DISMISS_PX = 96;
/** Un tirón rápido cierra aunque recorra poco, como en iOS. */
const DISMISS_VELOCITY = 0.6;

/**
 * Hoja inferior modal.
 *
 * Va sobre `<dialog>` nativo a propósito: `showModal()` la pone en la capa
 * superior (sin pelear z-index con la isla ni la barra de pestañas), atrapa el
 * foco y cierra con Esc sin código propio. Lo que sí es propio es el gesto:
 * tocar fuera o arrastrar el asa hacia abajo también la cierra.
 */
@Component({
  selector: 'pst-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="sheet"
      [attr.aria-label]="label()"
      (click)="onBackdrop($event)"
      (close)="open.set(false)"
    >
      <div class="sheet__panel" [style.transform]="dragY() ? 'translateY(' + dragY() + 'px)' : null" [class.is-dragging]="dragging()">
        <div
          class="sheet__grip"
          (pointerdown)="dragStart($event)"
          (pointermove)="dragMove($event)"
          (pointerup)="dragEnd($event)"
          (pointercancel)="dragCancel()"
        >
          <span class="sheet__handle" aria-hidden="true"></span>
        </div>
        <div class="sheet__body pst-scroll-area">
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

  protected readonly dragY = signal(0);
  protected readonly dragging = signal(false);
  private startY = 0;
  private startAt = 0;

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open() && !dialog.open) {
        dialog.showModal();
      } else if (!this.open() && dialog.open) {
        dialog.close();
      }
    });
  }

  /** El panel no llena el `<dialog>`: un clic que cae en él mismo es fuera. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.open.set(false);
    }
  }

  protected dragStart(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.startY = event.clientY;
    this.startAt = event.timeStamp;
    this.dragging.set(true);
  }

  protected dragMove(event: PointerEvent): void {
    if (!this.dragging()) return;
    // Hacia arriba no se mueve: la hoja ya está en su altura natural.
    this.dragY.set(Math.max(0, event.clientY - this.startY));
  }

  protected dragEnd(event: PointerEvent): void {
    if (!this.dragging()) return;
    const distance = this.dragY();
    const velocity = distance / Math.max(1, event.timeStamp - this.startAt);
    this.dragCancel();
    if (distance > DISMISS_PX || (distance > 16 && velocity > DISMISS_VELOCITY)) {
      this.open.set(false);
    }
  }

  protected dragCancel(): void {
    this.dragging.set(false);
    this.dragY.set(0);
  }
}
