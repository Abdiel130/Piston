import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { AttachmentService, type AttachmentCaption } from '../../core/data/attachment.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { AttachmentDownloads } from '../../core/sync/attachment-downloads.service';
import type { Attachment } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';

interface FileView {
  readonly attachment: Attachment;
  /** Blob local. Nulo mientras no se baja de otro dispositivo. */
  readonly url: string | null;
  /** Por qué aún no se puede abrir. */
  readonly pending: string;
  readonly image: boolean;
}

/**
 * Los archivos guardados de un documento, leídos de IndexedDB: se ven sin
 * conexión y antes de que suban. Cada uno lleva su título y notas ("¿Cómo
 * reportar un siniestro?" y la imagen de la aseguradora); las imágenes se
 * muestran grandes para leerlas sin abrirlas.
 *
 * Con `editable` el formulario corrige título y notas y marca los que se
 * quitan; todo se aplica al guardar.
 *
 * Con `remote` (historial) no se guarda nada en el dispositivo: cada archivo
 * se trae del servidor al tocar "Ver" y se olvida al salir.
 */
@Component({
  selector: 'pst-document-files',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  styleUrl: './document-files.scss',
  template: `
    @if (visible().length) {
      <ul class="doc-files">
        @for (file of visible(); track file.attachment.id) {
          <li class="doc-file">
            <div class="doc-file__head">
              @if (!(file.url && file.image && !editable())) {
                @if (file.url && file.image) {
                  <img class="doc-file__thumb" [src]="file.url" [alt]="label(file.attachment)" />
                } @else {
                  <span class="doc-file__thumb"><pst-icon name="document" [size]="22" /></span>
                }
              }
              <span class="doc-file__body">
                @if (file.url && !editable()) {
                  <a class="doc-file__title" [href]="file.url" target="_blank" rel="noopener">{{ label(file.attachment) }}</a>
                } @else {
                  <span class="doc-file__title">{{ label(file.attachment) }}</span>
                }
                @if (!file.url) {
                  <span class="doc-file__sub">{{ remote() ? remoteText(file.attachment) : file.pending }}</span>
                } @else if (file.attachment.title) {
                  <span class="doc-file__sub">{{ file.attachment.file_name }}</span>
                }
              </span>
              @if (remote() && !file.url && file.attachment.upload_status === 'uploaded') {
                <button
                  type="button"
                  class="pst-chip"
                  [disabled]="opening().has(file.attachment.id)"
                  (click)="open(file.attachment)"
                >
                  {{ opening().has(file.attachment.id) ? 'Cargando…' : 'Ver' }}
                </button>
              }
              @if (editable()) {
                <button
                  type="button"
                  class="doc-file__remove"
                  [attr.aria-label]="'Quitar ' + label(file.attachment)"
                  (click)="remove(file.attachment)"
                >
                  <pst-icon name="close" [size]="14" />
                </button>
              }
            </div>

            @if (editable()) {
              <input
                class="pst-input"
                maxlength="120"
                placeholder="Título (ej. ¿Cómo reportar un siniestro?)"
                [attr.aria-label]="'Título de ' + file.attachment.file_name"
                [value]="caption(file.attachment).title"
                (input)="edit(file.attachment, 'title', $event)"
              />
              <textarea
                class="pst-input doc-file__notes-input"
                rows="2"
                placeholder="Notas"
                [attr.aria-label]="'Notas de ' + file.attachment.file_name"
                [value]="caption(file.attachment).notes"
                (input)="edit(file.attachment, 'notes', $event)"
              ></textarea>
            } @else {
              @if (file.url && file.image) {
                <a [href]="file.url" target="_blank" rel="noopener">
                  <img class="doc-file__preview" [src]="file.url" [alt]="label(file.attachment)" />
                </a>
              }
              @if (file.attachment.notes) {
                <p class="doc-file__notes">{{ file.attachment.notes }}</p>
              }
            }
          </li>
        }
      </ul>
    } @else if (empty()) {
      <p class="pst-field__hint">{{ empty() }}</p>
    }
  `,
})
export class DocumentFilesComponent {
  private readonly store = inject(OfflineStore);
  private readonly attachments = inject(AttachmentService);
  private readonly downloads = inject(AttachmentDownloads);

  readonly documentId = input.required<string>();
  readonly editable = input(false);
  /** Historial: sin copia local, se ve desde el servidor bajo demanda. */
  readonly remote = input(false);
  /** Texto cuando no hay archivos. Vacío = no mostrar nada. */
  readonly empty = input('');
  /** Los que el usuario quitó y aún no se guardan. */
  readonly removed = model<readonly Attachment[]>([]);
  /** Títulos y notas que el usuario cambió y aún no se guardan. */
  readonly captions = model<Readonly<Record<string, AttachmentCaption>>>({});

  private readonly rows = this.store.liveFrom(
    this.documentId,
    (id) => this.attachments.listFor('document', id),
    [] as Attachment[],
  );
  private readonly files = signal<readonly FileView[]>([]);
  /** URLs de lo que se trajo del servidor en esta visita. */
  private readonly opened = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly opening = signal<ReadonlySet<string>>(new Set());
  protected readonly failedId = signal<string | null>(null);

  protected readonly visible = computed(() => {
    const removed = new Set(this.removed().map((attachment) => attachment.id));
    const opened = this.opened();
    return this.files()
      .filter((file) => !removed.has(file.attachment.id))
      .map((file) => (file.url ? file : { ...file, url: opened.get(file.attachment.id) ?? null }));
  });

  private loads = 0;

  constructor() {
    effect(() => {
      const rows = this.rows();
      untracked(() => void this.load(rows));
    });
    inject(DestroyRef).onDestroy(() => {
      this.loads++;
      this.revoke(this.files());
      this.opened().forEach((url) => URL.revokeObjectURL(url));
    });
  }

  protected remove(attachment: Attachment): void {
    this.removed.update((removed) => [...removed, attachment]);
  }

  protected remoteText(attachment: Attachment): string {
    if (attachment.upload_status !== 'uploaded') return 'Se sube desde el dispositivo donde se adjuntó';
    if (this.failedId() === attachment.id) return 'No se pudo traer. ¿Hay conexión?';
    return 'En el servidor · requiere conexión';
  }

  /** Trae el archivo del servidor sin guardarlo en el dispositivo. */
  protected async open(attachment: Attachment): Promise<void> {
    this.failedId.set(null);
    this.opening.update((ids) => new Set(ids).add(attachment.id));
    try {
      const url = URL.createObjectURL(await this.downloads.blob(attachment));
      this.opened.update((opened) => new Map(opened).set(attachment.id, url));
    } catch {
      this.failedId.set(attachment.id);
    } finally {
      this.opening.update((ids) => {
        const next = new Set(ids);
        next.delete(attachment.id);
        return next;
      });
    }
  }

  protected label(attachment: Attachment): string {
    return attachment.title ?? attachment.file_name;
  }

  /** Lo escrito si ya se editó; si no, lo guardado. */
  protected caption(attachment: Attachment): { title: string; notes: string } {
    const edited = this.captions()[attachment.id];
    return {
      title: edited?.title ?? attachment.title ?? '',
      notes: edited?.notes ?? attachment.notes ?? '',
    };
  }

  protected edit(attachment: Attachment, key: 'title' | 'notes', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.captions.update((captions) => ({
      ...captions,
      [attachment.id]: { ...this.caption(attachment), [key]: value },
    }));
  }

  /** Cada lectura reemplaza las URLs anteriores; una lectura vieja se descarta. */
  private async load(rows: readonly Attachment[]): Promise<void> {
    const load = ++this.loads;
    const views = await Promise.all(
      rows.map(async (attachment) => ({
        attachment,
        url: await this.attachments.localUrl(attachment),
        pending: pendingText(attachment),
        image: !!attachment.mime_type?.startsWith('image/'),
      })),
    );
    if (load !== this.loads) {
      this.revoke(views);
      return;
    }
    const previous = this.files();
    this.files.set(views);
    this.revoke(previous);

    // Lo que subió otro dispositivo se baja al abrirlo; al guardarse, la
    // consulta en vivo vuelve a pintar la lista con su URL local.
    if (navigator.onLine && !this.remote()) {
      for (const attachment of rows.filter(AttachmentDownloads.missing)) {
        this.downloads.fetch(attachment).catch(() => undefined);
      }
    }
  }

  private revoke(views: readonly FileView[]): void {
    views.forEach((view) => view.url && URL.revokeObjectURL(view.url));
  }
}

function pendingText(attachment: Attachment): string {
  if (attachment.upload_status !== 'uploaded') return 'Se sube desde el dispositivo donde se adjuntó';
  return navigator.onLine ? 'Descargando…' : 'Se descarga al tener conexión';
}
