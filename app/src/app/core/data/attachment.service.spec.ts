import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/piston-db';
import { AttachmentService } from './attachment.service';
import { OfflineStore } from './offline-store.service';

const OWNER = '01900000-0000-7000-8000-000000000001';

describe('AttachmentService', () => {
  let store: OfflineStore;
  let attachments: AttachmentService;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(OfflineStore);
    attachments = TestBed.inject(AttachmentService);

    await db.open();
    await Promise.all([db.attachments.clear(), db.attachment_blobs.clear(), db.sync_outbox.clear()]);
  });

  it('guarda fila, binario y mutación dentro de la transacción del dueño', async () => {
    const prepared = await attachments.prepare(new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' }));

    await store.transaction(['attachments'], () => attachments.attachPrepared('fuel_entry', OWNER, prepared, 'receipt', 1));

    const [row] = await db.attachments.toArray();
    expect(row).toMatchObject({ owner_type: 'fuel_entry', owner_id: OWNER, kind: 'receipt', sort_order: 1, checksum: prepared.checksum });
    expect(await db.attachment_blobs.get(row.local_blob_key!)).toBeDefined();
    expect(await db.sync_outbox.filter((entry) => entry.row_id === row.id).count()).toBe(1);
  });

  it('si la transacción falla no queda ni la fila ni el binario', async () => {
    const prepared = await attachments.prepare(new File(['ticket'], 'ticket.jpg', { type: 'image/jpeg' }));

    await expect(
      store.transaction(['attachments'], async () => {
        await attachments.attachPrepared('fuel_entry', OWNER, prepared);
        throw new Error('falla después');
      }),
    ).rejects.toThrow('falla después');

    expect(await db.attachments.count()).toBe(0);
    expect(await db.attachment_blobs.count()).toBe(0);
    expect(await db.sync_outbox.count()).toBe(0);
  });
});
