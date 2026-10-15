import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { AlbumService, photoDate } from '../../core/data/album.service';
import { AttachmentService } from '../../core/data/attachment.service';
import { formatLongDate } from '../../core/format';
import type { Attachment } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { readText } from '../capture/capture-form';
import { fromLocalInput, toLocalInput } from './gallery-view';

/** Lo que debe recorrer el dedo de lado para pasar de foto. */
const SWIPE_PX = 48;

/**
 * Visor a pantalla completa de un álbum. Se pasa de foto con flechas, el
 * teclado o deslizando de lado. Abajo, la fecha (corregible: el EXIF a veces
 * miente o no existe), título y notas; también usarla de portada o borrarla.
 *
 * Va sobre `<dialog>` nativo como la hoja: capa superior, foco atrapado y Esc
 * (o el gesto de atrás de Android) cierran sin código propio.
 */
@Component({
  selector: 'pst-photo-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  styleUrls: ['../capture/capture.scss', './photo-viewer.component.scss'],
  template: `
    <dialog
      #dialog
      class="viewer"
      aria-label="Foto"
      (close)="index.set(null)"
      (keydown.arrowLeft)="step(-1)"
      (keydown.arrowRight)="step(1)"
    >
      @if (photo(); as photo) {
        <header class="viewer__top">
          <button type="button" class="viewer__icon" aria-label="Cerrar" (click)="index.set(null)">
            <pst-icon name="close" [size]="22" />
          </button>
          <span class="viewer__count pst-numeric">{{ position() }}</span>
          <span class="viewer__spacer"></span>
        </header>

        <div class="viewer__stage" (pointerdown)="swipeStart($event)" (pointerup)="swipeEnd($event)">
          @if (urls().get(photo.id); as url) {
            <img [src]="url" [alt]="photo.title ?? photo.file_name" draggable="false" />
          } @else {
            <p class="viewer__pending">
              {{ photo.upload_status === 'uploaded' ? 'Descargando… requiere conexión' : 'Se sube desde el dispositivo donde se tomó' }}
            </p>
          }
          @if (index()! > 0) {
            <button type="button" class="viewer__nav viewer__nav--prev" aria-label="Anterior" (click)="step(-1)">
              <pst-icon name="chevronLeft" [size]="26" />
            </button>
          }
          @if (index()! < photos().length - 1) {
            <button type="button" class="viewer__nav viewer__nav--next" aria-label="Siguiente" (click)="step(1)">
              <pst-icon name="chevronRight" [size]="26" />
            </button>
          }
        </div>

        <footer class="viewer__info">
          @if (!editing()) {
            <p class="viewer__date">{{ date(photo) }}</p>
            @if (photo.title) {
              <p class="viewer__title">{{ photo.title }}</p>
            }
            @if (photo.notes) {
              <p class="viewer__notes">{{ photo.notes }}</p>
            }
            @if (error(); as message) {
              <p class="error">{{ message }}</p>
            }
            <div class="viewer__actions">
              @if (confirmRemove()) {
                <span class="viewer__ask">¿Borrar esta foto?</span>
                <button type="button" class="pst-btn pst-btn--ghost" (click)="confirmRemove.set(false)">Cancelar</button>
                <button type="button" class="pst-btn pst-btn--danger" [disabled]="busy()" (click)="remove(photo)">Borrar</button>
              } @else {
                <button type="button" class="pst-btn pst-btn--ghost" (click)="startEdit(photo)">Editar</button>
                @if (albumId() && coverId() !== photo.id) {
                  <button type="button" class="pst-btn pst-btn--ghost" [disabled]="busy()" (click)="useAsCover(photo)">Portada</button>
                }
                <button type="button" class="pst-btn pst-btn--ghost" (click)="confirmRemove.set(true)">Borrar</button>
              }
            </div>
          } @else {
            <form class="pst-form" (submit)="$event.preventDefault(); save(photo)">
              <label class="pst-field">
                <span class="pst-field__label">Fecha de la foto</span>
                <input class="pst-input" type="datetime-local" [value]="draftDate()" (input)="draftDate.set(readText($event))" />
              </label>
              <label class="pst-field">
                <span class="pst-field__label">Título</span>
                <input class="pst-input" maxlength="120" placeholder="Ej. Antes de pintar" [value]="draftTitle()" (input)="draftTitle.set(readText($event))" />
              </label>
              <label class="pst-field">
                <span class="pst-field__label">Notas</span>
                <textarea class="pst-input" rows="2" [value]="draftNotes()" (input)="draftNotes.set(readText($event))"></textarea>
              </label>
              @if (error(); as message) {
                <p class="error">{{ message }}</p>
              }
              <div class="viewer__actions">
                <button type="button" class="pst-btn pst-btn--ghost" (click)="editing.set(false)">Cancelar</button>
                <button type="submit" class="pst-btn pst-btn--primary" [disabled]="busy()">Guardar</button>
              </div>
            </form>
          }
        </footer>
      }
    </dialog>
  `,
})
export class PhotoViewerComponent {
  private readonly albums = inject(AlbumService);
  private readonly attachments = inject(AttachmentService);

  readonly photos = input.required<readonly Attachment[]>();
  readonly urls = input.required<ReadonlyMap<string, string>>();
  /** La foto abierta. Nulo = cerrado. */
  readonly index = model<number | null>(null);
  /** Álbum de las fotos, para "Portada". Nulo en Sin álbum. */
  readonly albumId = input<string | null>(null);
  readonly coverId = input<string | null>(null);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly photo = computed(() => {
    const index = this.index();
    return index === null ? null : (this.photos()[index] ?? null);
  });
  protected readonly position = computed(() => `${(this.index() ?? 0) + 1} de ${this.photos().length}`);

  protected readonly editing = signal(false);
  protected readonly confirmRemove = signal(false);
  protected readonly draftDate = signal('');
  protected readonly draftTitle = signal('');
  protected readonly draftNotes = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly readText = readText;

  private swipeX: number | null = null;

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.photo()) {
        if (!dialog.open) dialog.showModal();
      } else if (dialog.open) {
        dialog.close();
      }
    });

    // Cambiar de foto (o que la actual se borre en otro lado) descarta lo que
    // se estaba editando.
    effect(() => {
      this.photo();
      this.editing.set(false);
      this.confirmRemove.set(false);
      this.error.set(null);
    });
  }

  protected date(photo: Attachment): string {
    return formatLongDate(photoDate(photo));
  }

  protected step(delta: number): void {
    const index = this.index();
    if (index === null || this.editing()) return;
    const next = index + delta;
    if (next >= 0 && next < this.photos().length) this.index.set(next);
  }

  protected swipeStart(event: PointerEvent): void {
    this.swipeX = event.isPrimary ? event.clientX : null;
  }

  protected swipeEnd(event: PointerEvent): void {
    if (this.swipeX === null) return;
    const dx = event.clientX - this.swipeX;
    this.swipeX = null;
    if (Math.abs(dx) >= SWIPE_PX) this.step(dx < 0 ? 1 : -1);
  }

  protected startEdit(photo: Attachment): void {
    this.draftDate.set(toLocalInput(photoDate(photo)));
    this.draftTitle.set(photo.title ?? '');
    this.draftNotes.set(photo.notes ?? '');
    this.error.set(null);
    this.editing.set(true);
  }

  protected async save(photo: Attachment): Promise<void> {
    const takenAt = fromLocalInput(this.draftDate());
    await this.run(async () => {
      if (takenAt && takenAt !== photo.taken_at) await this.albums.setTakenAt(photo.id, takenAt);
      await this.attachments.setCaption(photo.id, { title: this.draftTitle(), notes: this.draftNotes() });
      this.editing.set(false);
    });
  }

  protected async useAsCover(photo: Attachment): Promise<void> {
    const albumId = this.albumId();
    if (albumId) await this.run(() => this.albums.setCover(albumId, photo.id));
  }

  /** Al borrar se queda en la misma posición: muestra la siguiente, o la anterior si era la última. */
  protected async remove(photo: Attachment): Promise<void> {
    const index = this.index() ?? 0;
    const remaining = this.photos().length - 1;
    await this.run(async () => {
      await this.albums.removePhotos([photo]);
      this.index.set(remaining > 0 ? Math.min(index, remaining - 1) : null);
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo guardar el cambio.');
    } finally {
      this.busy.set(false);
    }
  }
}
