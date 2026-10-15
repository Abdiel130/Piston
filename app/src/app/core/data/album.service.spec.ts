import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/piston-db';
import type { Attachment, VehicleAlbum } from '../models';
import { AlbumService, albumCover, byTakenAt } from './album.service';

const VEHICLE = '0190a000-0000-7000-8000-000000000001';

describe('AlbumService', () => {
  let service: AlbumService;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AlbumService);
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  /** Una foto con fecha de archivo; sin EXIF, esa es su `taken_at`. */
  const photo = (name: string, date: string) =>
    service.prepare(new File(['jpg'], name, { type: 'image/jpeg', lastModified: Date.parse(date) }));

  it('crea álbumes en orden y exige nombre', async () => {
    const first = await service.create(VEHICLE, { name: ' Restauración ', description: '  ' });
    const second = await service.create(VEHICLE, { name: 'Llantas', description: 'Desgaste' });

    expect(first.name).toBe('Restauración');
    expect(first.description).toBeNull();
    expect(second.sort_order).toBe(1);
    await expect(service.create(VEHICLE, { name: '  ', description: null })).rejects.toThrow('nombre');
  });

  it('muestra las fotos de un álbum por fecha de captura, no de alta', async () => {
    const album = await service.create(VEHICLE, { name: 'Pintura', description: null });
    const place = { ownerType: 'album', ownerId: album.id } as const;
    await service.addPhotos(place, [await photo('despues.jpg', '2025-03-01T12:00:00Z')]);
    await service.addPhotos(place, [await photo('antes.jpg', '2024-01-10T12:00:00Z')]);

    const [entry] = await service.albumsWithPhotos(VEHICLE);
    expect(entry.photos.map((p) => p.file_name)).toEqual(['antes.jpg', 'despues.jpg']);
    expect(entry.photos[0].taken_at).toBe('2024-01-10T12:00:00.000Z');
    expect(albumCover(entry.album, entry.photos)?.file_name).toBe('despues.jpg');
  });

  it('mueve fotos entre álbumes y a sin álbum', async () => {
    const a = await service.create(VEHICLE, { name: 'A', description: null });
    const b = await service.create(VEHICLE, { name: 'B', description: null });
    const [saved] = await service.addPhotos({ ownerType: 'album', ownerId: a.id }, [
      await photo('frente.jpg', '2024-05-01T00:00:00Z'),
    ]);

    await service.movePhotos([saved.id], { ownerType: 'album', ownerId: b.id });
    let albums = await service.albumsWithPhotos(VEHICLE);
    expect(albums.map((entry) => entry.photos.length)).toEqual([0, 1]);

    await service.movePhotos([saved.id], { ownerType: 'vehicle', ownerId: VEHICLE });
    albums = await service.albumsWithPhotos(VEHICLE);
    expect(albums.every((entry) => !entry.photos.length)).toBe(true);
    expect((await service.loosePhotos(VEHICLE)).map((p) => p.id)).toEqual([saved.id]);

    const outbox = await db.sync_outbox.where('[table_name+row_id]').equals(['attachments', saved.id]).toArray();
    expect(outbox).toHaveLength(1);
  });

  it('borrar un álbum deja sus fotos sueltas en el vehículo', async () => {
    const album = await service.create(VEHICLE, { name: 'Proyecto', description: null });
    await service.addPhotos({ ownerType: 'album', ownerId: album.id }, [
      await photo('uno.jpg', '2024-01-01T00:00:00Z'),
      await photo('dos.jpg', '2024-02-01T00:00:00Z'),
    ]);

    await service.remove(album.id);

    expect(await service.albumsWithPhotos(VEHICLE)).toEqual([]);
    const loose = await service.loosePhotos(VEHICLE);
    expect(loose.map((p) => p.file_name)).toEqual(['uno.jpg', 'dos.jpg']);
    expect(await db.attachment_blobs.count()).toBe(2);
  });

  it('la portada elegida manda mientras siga en el álbum', () => {
    const at = (id: string, taken_at: string) => ({ id, taken_at, created_at: taken_at }) as Attachment;
    const photos = [at('b', '2024-02-01'), at('a', '2024-01-01')].sort(byTakenAt);
    const album = { cover_attachment_id: 'a' } as VehicleAlbum;

    expect(albumCover(album, photos)?.id).toBe('a');
    expect(albumCover({ ...album, cover_attachment_id: 'otra' }, photos)?.id).toBe('b');
    expect(albumCover(album, [])).toBeNull();
  });
});
