import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AlbumService, albumCover, photoDate, type AlbumWithPhotos } from '../../core/data/album.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { formatLongDate } from '../../core/format';
import type { Attachment } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { SheetComponent, SheetContentDirective } from '../../shared/sheet/sheet.component';
import { readText } from '../capture/capture-form';
import { LOOSE_ALBUM, photoSpan } from './gallery-view';
import { photoUrls } from './photo-urls';

interface AlbumCard {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly cover: Attachment | null;
}

interface Gallery {
  readonly albums: readonly AlbumWithPhotos[];
  readonly loose: readonly Attachment[];
}

/**
 * Galería del vehículo en gestión: sus álbumes con portada, cuántas fotos y
 * qué periodo cubren, y las fotos sin álbum. Crear un álbum lleva directo a
 * él para empezar a subir.
 */
@Component({
  selector: 'pst-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, SheetComponent, SheetContentDirective],
  templateUrl: './gallery.component.html',
  styleUrls: ['../capture/capture.scss', '../vehicles/vehicle-form.component.scss', './gallery.component.scss'],
})
export class GalleryComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly albums = inject(AlbumService);
  private readonly router = inject(Router);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  protected readonly readText = readText;

  private readonly gallery = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId): Promise<Gallery> =>
      vehicleId
        ? { albums: await this.albums.albumsWithPhotos(vehicleId), loose: await this.albums.loosePhotos(vehicleId) }
        : { albums: [], loose: [] },
    { albums: [], loose: [] } as Gallery,
  );

  protected readonly cards = computed<AlbumCard[]>(() => {
    const { albums, loose } = this.gallery();
    const cards = albums.map(({ album, photos }) => ({
      id: album.id,
      name: album.name,
      sub: photoSpan(photos),
      cover: albumCover(album, photos),
    }));
    if (loose.length) {
      cards.push({ id: LOOSE_ALBUM, name: 'Sin álbum', sub: photoSpan(loose), cover: loose.at(-1) ?? null });
    }
    return cards;
  });

  private readonly covers = computed(() => this.cards().flatMap((card) => (card.cover ? [card.cover] : [])));
  protected readonly urls = photoUrls(this.covers);

  protected readonly total = computed(() => {
    const { albums, loose } = this.gallery();
    return albums.reduce((sum, entry) => sum + entry.photos.length, loose.length);
  });

  protected readonly createOpen = signal(false);
  protected readonly newName = signal('');
  protected readonly newDescription = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const { albums, loose } = this.gallery();
      const all = [...albums.flatMap((entry) => entry.photos), ...loose];
      const latest = all.reduce<string | null>((max, photo) => {
        const date = photoDate(photo);
        return !max || date > max ? date : max;
      }, null);
      const pending = all.filter((photo) => photo.upload_status !== 'uploaded' && photo.local_blob_key).length;
      this.island.present({
        icon: 'image',
        label: 'Galería',
        value: String(all.length),
        tone: all.length ? 'good' : 'idle',
        title: this.name(),
        subtitle: all.length
          ? `${albums.length} álbum${albums.length === 1 ? '' : 'es'} · ${all.length} foto${all.length === 1 ? '' : 's'}`
          : 'Sin fotos todavía',
        details: [
          ...(latest ? [{ label: 'Última foto', value: formatLongDate(latest) }] : []),
          ...(pending ? [{ label: 'Por subir', value: String(pending) }] : []),
        ],
      });
    });
  }

  protected openCreate(): void {
    this.newName.set('');
    this.newDescription.set('');
    this.error.set(null);
    this.createOpen.set(true);
  }

  protected async create(): Promise<void> {
    const vehicleId = this.context.vehicleId();
    if (!vehicleId || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const album = await this.albums.create(vehicleId, { name: this.newName(), description: this.newDescription() });
      this.createOpen.set(false);
      await this.router.navigate(['/vehicle/gallery', album.id]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo crear el álbum.');
    } finally {
      this.busy.set(false);
    }
  }
}
