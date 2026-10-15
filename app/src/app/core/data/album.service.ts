import { Injectable, inject } from '@angular/core';
import { db } from '../db/piston-db';
import type { Attachment, IsoDateTime, Uuid, VehicleAlbum } from '../models';
import { AttachmentService, type PreparedFile } from './attachment.service';
import { OfflineStore } from './offline-store.service';
import { preparePhoto } from './photo-prep';

/** Lo que captura el usuario de un álbum. */
export interface AlbumFields {
  readonly name: string;
  readonly description: string | null;
}

/**
 * Dónde vive una foto: en un álbum o suelta en el vehículo ("Sin álbum").
 * Es el `owner_type`/`owner_id` del adjunto.
 */
export interface PhotoPlace {
  readonly ownerType: 'album' | 'vehicle';
  readonly ownerId: Uuid;
}

/** Un álbum con sus fotos, de la más vieja a la más nueva. */
export interface AlbumWithPhotos {
  readonly album: VehicleAlbum;
  readonly photos: readonly Attachment[];
}

/**
 * Galería del vehículo: álbumes y sus fotos.
 *
 * Una foto es un adjunto cuyo dueño es el álbum (`owner_type: 'album'`) o, si
 * no tiene álbum, el vehículo. Moverla solo cambia el dueño: el archivo, que
 * quizá ni ha subido, no se toca. Borrar un álbum nunca borra fotos: pasan a
 * "Sin álbum".
 */
@Injectable({ providedIn: 'root' })
export class AlbumService {
  private readonly store = inject(OfflineStore);
  private readonly attachments = inject(AttachmentService);

  /**
   * Reduce la foto, lee su fecha y saca el checksum. Fuera de cualquier
   * transacción: leer el archivo la cerraría (ver `AttachmentService.prepare`).
   */
  async prepare(file: File): Promise<PreparedFile> {
    const photo = await preparePhoto(file);
    const prepared = await this.attachments.prepare(photo.file);
    return { ...prepared, width: photo.width, height: photo.height, takenAt: photo.takenAt };
  }

  async create(vehicleId: Uuid, fields: AlbumFields): Promise<VehicleAlbum> {
    const albums = await this.list(vehicleId);
    return this.store.create<VehicleAlbum>('vehicle_albums', {
      ...normalize(fields),
      user_id: null,
      vehicle_id: vehicleId,
      cover_attachment_id: null,
      sort_order: albums.reduce((max, album) => Math.max(max, album.sort_order + 1), 0),
    });
  }

  async update(id: Uuid, fields: AlbumFields): Promise<void> {
    await this.require(id);
    await this.store.update<VehicleAlbum>('vehicle_albums', id, normalize(fields));
  }

  async setCover(id: Uuid, attachmentId: Uuid | null): Promise<void> {
    await this.store.update<VehicleAlbum>('vehicle_albums', id, { cover_attachment_id: attachmentId });
  }

  /** Borra el álbum; sus fotos quedan sueltas en el vehículo. */
  async remove(id: Uuid): Promise<void> {
    await this.store.transaction(['vehicle_albums', 'attachments'], async () => {
      const album = await this.require(id);
      for (const photo of await this.attachments.listFor('album', id)) {
        await this.attachments.move(photo.id, 'vehicle', album.vehicle_id);
      }
      await this.store.remove('vehicle_albums', id);
    });
  }

  /** Guarda fotos ya preparadas (`prepare`) en un álbum o sueltas. */
  async addPhotos(place: PhotoPlace, files: readonly PreparedFile[]): Promise<Attachment[]> {
    return this.store.transaction(['attachments'], async () => {
      const saved: Attachment[] = [];
      for (const prepared of files) {
        saved.push(await this.attachments.attachPrepared(place.ownerType, place.ownerId, prepared, 'photo'));
      }
      return saved;
    });
  }

  async movePhotos(ids: readonly Uuid[], place: PhotoPlace): Promise<void> {
    await this.store.transaction(['attachments'], async () => {
      for (const id of ids) {
        await this.attachments.move(id, place.ownerType, place.ownerId);
      }
    });
  }

  async removePhotos(photos: readonly Attachment[]): Promise<void> {
    await this.store.transaction(['attachments'], async () => {
      for (const photo of photos) {
        await this.attachments.remove(photo);
      }
    });
  }

  async setTakenAt(id: Uuid, takenAt: IsoDateTime | null): Promise<void> {
    await this.attachments.setTakenAt(id, takenAt);
  }

  /** Los álbumes del vehículo en su orden, cada uno con sus fotos por fecha. */
  async albumsWithPhotos(vehicleId: Uuid): Promise<AlbumWithPhotos[]> {
    const albums = await this.list(vehicleId);
    if (!albums.length) return [];
    const photos = await db.attachments
      .where('[owner_type+owner_id]')
      .anyOf(albums.map((album) => ['album', album.id]))
      .toArray();
    return albums.map((album) => ({
      album,
      photos: photos.filter((photo) => photo.owner_id === album.id && !photo.deleted_at).sort(byTakenAt),
    }));
  }

  /** Un álbum vivo con sus fotos por fecha. Nulo si ya no existe. */
  async withPhotos(id: Uuid): Promise<AlbumWithPhotos | null> {
    const album = await this.store.get<VehicleAlbum>('vehicle_albums', id);
    if (!album) return null;
    return { album, photos: (await this.attachments.listFor('album', id)).sort(byTakenAt) };
  }

  /** Fotos sueltas del vehículo, por fecha. */
  async loosePhotos(vehicleId: Uuid): Promise<Attachment[]> {
    return (await this.attachments.listFor('vehicle', vehicleId)).filter(isPhoto).sort(byTakenAt);
  }

  /** Los álbumes del vehículo en su orden, sin fotos. */
  async list(vehicleId: Uuid): Promise<VehicleAlbum[]> {
    const albums = await this.store.listBy<VehicleAlbum>('vehicle_albums', 'vehicle_id', vehicleId);
    return albums.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }

  private async require(id: Uuid): Promise<VehicleAlbum> {
    const album = await this.store.get<VehicleAlbum>('vehicle_albums', id);
    if (!album || album.deleted_at) {
      throw new Error('El álbum ya no existe.');
    }
    return album;
  }
}

/** Cuándo se tomó; las fotos sin fecha usan cuándo se agregaron. */
export function photoDate(photo: Attachment): IsoDateTime {
  return photo.taken_at ?? photo.created_at;
}

/** De la más vieja a la más nueva: así se lee la evolución. */
export function byTakenAt(a: Attachment, b: Attachment): number {
  return photoDate(a).localeCompare(photoDate(b)) || a.created_at.localeCompare(b.created_at);
}

/** La portada elegida si sigue en el álbum; si no, la foto más reciente. */
export function albumCover(album: VehicleAlbum, photos: readonly Attachment[]): Attachment | null {
  return photos.find((photo) => photo.id === album.cover_attachment_id) ?? photos.at(-1) ?? null;
}

function isPhoto(attachment: Attachment): boolean {
  return !!attachment.mime_type?.startsWith('image/');
}

function normalize(fields: AlbumFields): AlbumFields {
  const name = fields.name.trim();
  if (!name) {
    throw new Error('Ponle nombre al álbum.');
  }
  return { name, description: fields.description?.trim() || null };
}
