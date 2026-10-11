import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/piston-db';
import type { VehicleDocument } from '../models';
import { AttachmentService } from './attachment.service';
import { DocumentService, type DocumentFields } from './document.service';

const VEHICLE = '0190a000-0000-7000-8000-000000000001';

function fields(overrides: Partial<DocumentFields> = {}): DocumentFields {
  return {
    vehicle_id: VEHICLE,
    type: 'insurance',
    title: null,
    issuer: ' Qualitas ',
    reference: '123-456',
    coverage: 'Amplia',
    issued_at: '2025-11-01',
    expires_at: '2026-11-01',
    cost: 9_800,
    notes: '  ',
    contact_phone: '800 800 2880',
    assistance_phone: '',
    insured_number: ' A-0042 ',
    policy_item: '1',
    ...overrides,
  };
}

describe('DocumentService', () => {
  let service: DocumentService;
  let attachments: AttachmentService;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DocumentService);
    attachments = TestBed.inject(AttachmentService);
    await db.open();
    await Promise.all(db.tables.map((table) => table.clear()));
  });

  const file = async (name = 'poliza.pdf', caption: { title?: string; notes?: string } = {}) => ({
    prepared: await attachments.prepare(
      new File(['%PDF'], name, { type: name.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf' }),
    ),
    ...caption,
  });

  it('guarda vigente, normaliza textos y adjunta los archivos', async () => {
    const document = await service.create(fields(), [
      await file(),
      await file('tarjeta.jpg', { title: '¿Cómo reportar un siniestro?', notes: 'Llamar primero' }),
    ]);

    expect(document.issuer).toBe('Qualitas');
    expect(document.notes).toBeNull();
    expect(document.assistance_phone).toBeNull();
    expect(document.insured_number).toBe('A-0042');
    expect(document.renewed_by_id).toBeNull();

    const saved = await attachments.listFor('document', document.id);
    expect(saved.map((a) => [a.file_name, a.kind, a.sort_order, a.title])).toEqual([
      ['poliza.pdf', 'document_scan', 0, null],
      ['tarjeta.jpg', 'photo', 1, '¿Cómo reportar un siniestro?'],
    ]);
    expect(saved[1].notes).toBe('Llamar primero');
  });

  it('editar agrega archivos después de los que ya había', async () => {
    const document = await service.create(fields(), [await file()]);
    await service.update(document.id, fields({ cost: 10_200 }), { added: [await file('recibo.jpg')] });

    const row = await db.documents.get(document.id);
    expect(row?.cost).toBe(10_200);
    const saved = await attachments.listFor('document', document.id);
    expect(saved.map((a) => a.sort_order)).toEqual([0, 1]);
  });

  it('editar quita los marcados y corrige títulos y notas', async () => {
    const document = await service.create(fields(), [await file(), await file('tarjeta.jpg')]);
    const [pdf, photo] = await attachments.listFor('document', document.id);

    await service.update(document.id, fields(), {
      removed: [pdf],
      captions: { [photo.id]: { title: 'Tarjeta del seguro', notes: 'Va en la guantera' } },
    });

    const saved = await attachments.listFor('document', document.id);
    expect(saved.map((a) => [a.file_name, a.title, a.notes])).toEqual([['tarjeta.jpg', 'Tarjeta del seguro', 'Va en la guantera']]);
  });

  it('renovar crea la nueva y manda la anterior al historial', async () => {
    const previous = await service.create(fields());
    const next = await service.renew(previous.id, fields({ issued_at: '2026-11-01', expires_at: '2027-11-01' }));

    expect(next.vehicle_id).toBe(VEHICLE);
    expect(next.renewed_by_id).toBeNull();
    expect((await db.documents.get(previous.id))?.renewed_by_id).toBe(next.id);
    await expect(service.renew(previous.id, fields())).rejects.toThrow('ya se renovó');
  });

  it('borrar una renovación devuelve la anterior a vigente', async () => {
    const previous = await service.create(fields());
    const next = await service.renew(previous.id, fields(), [await file()]);

    await service.remove(next.id);

    const rows = (await db.documents.toArray()) as VehicleDocument[];
    expect(rows.find((row) => row.id === next.id)?.deleted_at).not.toBeNull();
    expect(rows.find((row) => row.id === previous.id)?.renewed_by_id).toBeNull();
    expect(await attachments.listFor('document', next.id)).toEqual([]);
  });
});
