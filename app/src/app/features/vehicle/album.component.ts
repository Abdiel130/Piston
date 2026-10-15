import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AlbumService, albumCover, type PhotoPlace } from '../../core/data/album.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import type { Attachment, VehicleAlbum } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { SheetComponent, SheetContentDirective } from '../../shared/sheet/sheet.component';
import { LIMITS, readText } from '../capture/capture-form';
import { LOOSE_ALBUM, byMonth, photoSpan } from './gallery-view';
import { PhotoViewerComponent } from './photo-viewer.component';
import { photoUrls } from './photo-urls';

interface AlbumData {
  /** Nulo en "Sin álbum". */
  readonly album: VehicleAlbum | null;
  readonly photos: readonly Attachment[];
  /** Todos los álbumes del vehículo, para "Mover a". */
  readonly albums: readonly VehicleAlbum[];
  /** El álbum de la ruta ya no existe (se borró en otro dispositivo). */
  readonly missing: boolean;
}

interface Destination {
  readonly key: string;
  readonly name: string;
  readonly place: PhotoPlace;
}

const EMPTY_DATA: AlbumData = { album: null, photos: [], albums: [], missing: false };

/**
 * Un álbum (o las fotos sin álbum): rejilla por mes, de la foto más vieja a
 * la más nueva, para ver la evolución. Se suben varias a la vez; se guardan
 * reducidas en el dispositivo y suben solas. Con "Seleccionar" se mueven a
 * otro álbum o se borran.
 */
@Component({
  selector: 'pst-album',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PhotoViewerComponent, RouterLink, SheetComponent, SheetContentDirective],
  templateUrl: './album.component.html',
  styleUrls: ['../capture/capture.scss', '../vehicles/vehicle-form.component.scss', './album.component.scss'],
})
export class AlbumComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly service = inject(AlbumService);
  private readonly router = inject(Router);

  /** Id del álbum, o `loose` para las fotos sin álbum. */
  readonly id = input.required<string>();

  protected readonly vehicle = this.context.vehicle;
  protected readonly readText = readText;

  private readonly source = computed(() => ({ vehicleId: this.context.vehicleId(), id: this.id() }));
  private readonly data = this.store.liveFrom(
    this.source,
    async ({ vehicleId, id }): Promise<AlbumData> => {
      if (!vehicleId) return EMPTY_DATA;
      const albums = await this.service.list(vehicleId);
      if (id === LOOSE_ALBUM) {
        return { album: null, photos: await this.service.loosePhotos(vehicleId), albums, missing: false };
      }
      const entry = await this.service.withPhotos(id);
      if (!entry || entry.album.vehicle_id !== vehicleId) return { ...EMPTY_DATA, albums, missing: true };
      return { album: entry.album, photos: entry.photos, albums, missing: false };
    },
    EMPTY_DATA,
  );

  protected readonly album = computed(() => this.data().album);
  protected readonly missing = computed(() => this.data().missing);
  protected readonly photos = computed(() => this.data().photos);
  protected readonly loose = computed(() => this.id() === LOOSE_ALBUM);
  protected readonly title = computed(() => this.album()?.name ?? (this.loose() ? 'Sin álbum' : 'Álbum'));
  protected readonly span = computed(() => photoSpan(this.photos()));
  protected readonly months = computed(() => byMonth(this.photos()));
  protected readonly coverId = computed(() => {
    const album = this.album();
    return album ? (albumCover(album, this.photos())?.id ?? null) : null;
  });
  protected readonly urls = photoUrls(this.photos);

  private readonly place = computed<PhotoPlace | null>(() => {
    const vehicleId = this.context.vehicleId();
    if (this.loose()) return vehicleId ? { ownerType: 'vehicle', ownerId: vehicleId } : null;
    const album = this.album();
    return album ? { ownerType: 'album', ownerId: album.id } : null;
  });

  // ── Subida ──
  protected readonly preparing = signal(0);
  protected readonly fileError = signal<string | null>(null);

  // ── Selección ──
  protected readonly selecting = signal(false);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly confirmRemove = signal(false);
  protected readonly moveOpen = signal(false);
  protected readonly destinations = computed<Destination[]>(() => {
    const vehicleId = this.context.vehicleId();
    const current = this.album()?.id;
    const albums: Destination[] = this.data()
      .albums.filter((album) => album.id !== current)
      .map((album) => ({ key: album.id, name: album.name, place: { ownerType: 'album', ownerId: album.id } }));
    if (!this.loose() && vehicleId) {
      albums.push({ key: LOOSE_ALBUM, name: 'Sin álbum', place: { ownerType: 'vehicle', ownerId: vehicleId } });
    }
    return albums;
  });

  // ── Editar álbum ──
  protected readonly editOpen = signal(false);
  protected readonly editName = signal('');
  protected readonly editDescription = signal('');
  protected readonly confirmDelete = signal(false);

  // ── Visor ──
  protected readonly viewing = signal<number | null>(null);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const photos = this.photos();
      const pending = photos.filter((photo) => photo.upload_status !== 'uploaded' && photo.local_blob_key).length;
      this.island.present({
        icon: 'image',
        label: this.title(),
        value: String(photos.length),
        tone: photos.length ? 'good' : 'idle',
        title: this.title(),
        subtitle: this.span(),
        details: [
          ...(this.preparing() ? [{ label: 'Preparando', value: String(this.preparing()) }] : []),
          ...(pending ? [{ label: 'Por subir', value: String(pending) }] : []),
        ],
        pulsing: this.preparing() > 0,
      });
    });

    // Lo seleccionado que ya no está (se movió o borró en otro lado) se suelta.
    effect(() => {
      const alive = new Set(this.photos().map((photo) => photo.id));
      const selected = this.selected();
      if ([...selected].some((id) => !alive.has(id))) {
        this.selected.set(new Set([...selected].filter((id) => alive.has(id))));
      }
    });
  }

  protected async pickFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    this.fileError.set(null);
    const place = this.place();
    if (!place) return;

    const images = picked.filter((file) => file.type.startsWith('image/'));
    const tooBig = images.filter((file) => file.size > LIMITS.attachmentBytes);
    if (images.length < picked.length) {
      this.fileError.set('Solo se pueden subir fotos.');
    } else if (tooBig.length) {
      this.fileError.set(`${tooBig.map((file) => file.name).join(', ')}: pesa más de ${LIMITS.attachmentBytes / 1024 / 1024} MB.`);
    }

    // Una por una: reducirlas usa memoria y así cada foto aparece en cuanto está.
    const accepted = images.filter((file) => file.size <= LIMITS.attachmentBytes);
    this.preparing.update((count) => count + accepted.length);
    for (const file of accepted) {
      try {
        await this.service.addPhotos(place, [await this.service.prepare(file)]);
      } catch {
        this.fileError.set(`No se pudo guardar ${file.name}.`);
      } finally {
        this.preparing.update((count) => count - 1);
      }
    }
  }

  protected tap(photo: Attachment, index: number): void {
    if (!this.selecting()) {
      this.viewing.set(index);
      return;
    }
    this.selected.update((selected) => {
      const next = new Set(selected);
      if (!next.delete(photo.id)) next.add(photo.id);
      return next;
    });
  }

  /** Índice global de una foto (el visor recorre todo el álbum, no solo el mes). */
  protected indexOf(photo: Attachment): number {
    return this.photos().indexOf(photo);
  }

  protected startSelecting(): void {
    this.selected.set(new Set());
    this.confirmRemove.set(false);
    this.selecting.set(true);
  }

  protected stopSelecting(): void {
    this.selecting.set(false);
    this.selected.set(new Set());
    this.confirmRemove.set(false);
  }

  protected async moveTo(destination: Destination): Promise<void> {
    await this.run(async () => {
      await this.service.movePhotos([...this.selected()], destination.place);
      this.moveOpen.set(false);
      this.stopSelecting();
    });
  }

  protected async removeSelected(): Promise<void> {
    const selected = this.selected();
    await this.run(async () => {
      await this.service.removePhotos(this.photos().filter((photo) => selected.has(photo.id)));
      this.stopSelecting();
    });
  }

  protected async useAsCover(): Promise<void> {
    const album = this.album();
    const [id] = this.selected();
    if (!album || !id) return;
    await this.run(async () => {
      await this.service.setCover(album.id, id);
      this.stopSelecting();
    });
  }

  protected openEdit(): void {
    const album = this.album();
    if (!album) return;
    this.editName.set(album.name);
    this.editDescription.set(album.description ?? '');
    this.confirmDelete.set(false);
    this.error.set(null);
    this.editOpen.set(true);
  }

  protected async saveEdit(): Promise<void> {
    const album = this.album();
    if (!album) return;
    await this.run(async () => {
      await this.service.update(album.id, { name: this.editName(), description: this.editDescription() });
      this.editOpen.set(false);
    });
  }

  protected async deleteAlbum(): Promise<void> {
    const album = this.album();
    if (!album) return;
    await this.run(async () => {
      await this.service.remove(album.id);
      this.editOpen.set(false);
      await this.router.navigateByUrl('/vehicle/gallery', { replaceUrl: true });
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
