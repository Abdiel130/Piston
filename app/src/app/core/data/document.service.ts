import { Injectable, inject } from '@angular/core';
import type { Attachment, Uuid, VehicleDocument } from '../models';
import { AttachmentService, type AttachmentCaption, type PreparedFile } from './attachment.service';
import { OfflineStore, type NewRow } from './offline-store.service';

/** Lo que captura el formulario. La cadena de renovación la lleva este servicio. */
export type DocumentFields = Omit<NewRow<VehicleDocument>, 'user_id' | 'renewed_by_id'>;

/** Un archivo nuevo con lo que el usuario escribió de él. */
export interface DocumentFile extends AttachmentCaption {
  readonly prepared: PreparedFile;
}

/** Lo que cambió en los archivos ya guardados al editar. */
export interface DocumentFileChanges {
  readonly added?: readonly DocumentFile[];
  /** Los que el usuario quitó. */
  readonly removed?: readonly Attachment[];
  /** Título y notas corregidos, por id de adjunto. */
  readonly captions?: Readonly<Record<Uuid, AttachmentCaption>>;
}

/**
 * Pólizas y demás documentos del vehículo.
 *
 * Renovar nunca edita la vigencia de un documento: crea uno nuevo y deja el
 * anterior apuntando a él (`renewed_by_id`). El anterior queda como historial
 * y deja de avisar; solo los vigentes entran a `VehicleAlerts`.
 *
 * Los archivos llegan ya preparados (`AttachmentService.prepare`), porque
 * leerlos fuera de Dexie cerraría la transacción.
 */
@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly store = inject(OfflineStore);
  private readonly attachments = inject(AttachmentService);

  async create(fields: DocumentFields, files: readonly DocumentFile[] = []): Promise<VehicleDocument> {
    return this.store.transaction(['documents', 'attachments'], async () => {
      const document = await this.insert(fields);
      await this.attach(document.id, files, 0);
      return document;
    });
  }

  async update(id: Uuid, fields: DocumentFields, changes: DocumentFileChanges = {}): Promise<VehicleDocument> {
    return this.store.transaction(['documents', 'attachments'], async () => {
      await this.require(id);
      await this.store.update<VehicleDocument>('documents', id, normalize(fields));
      const saved = await this.attachments.listFor('document', id);
      const removed = new Set((changes.removed ?? []).map((attachment) => attachment.id));
      for (const attachment of saved) {
        const caption = changes.captions?.[attachment.id];
        if (removed.has(attachment.id)) {
          await this.attachments.remove(attachment);
        } else if (caption && !sameCaption(attachment, caption)) {
          await this.attachments.setCaption(attachment.id, caption);
        }
      }
      const next = saved.reduce((max, attachment) => Math.max(max, attachment.sort_order + 1), 0);
      await this.attach(id, changes.added ?? [], next);
      return this.require(id);
    });
  }

  /** Crea el reemplazo de `previousId` y lo manda al historial. */
  async renew(previousId: Uuid, fields: DocumentFields, files: readonly DocumentFile[] = []): Promise<VehicleDocument> {
    return this.store.transaction(['documents', 'attachments'], async () => {
      const previous = await this.require(previousId);
      if (previous.renewed_by_id) {
        throw new Error('Este documento ya se renovó.');
      }
      const document = await this.insert({ ...fields, vehicle_id: previous.vehicle_id, type: previous.type });
      await this.attach(document.id, files, 0);
      await this.store.update<VehicleDocument>('documents', previousId, { renewed_by_id: document.id });
      return document;
    });
  }

  /**
   * Borra el documento con sus archivos. Si era la renovación de otro, ese
   * vuelve a quedar vigente: borrar un error no debe esconder una póliza.
   */
  async remove(id: Uuid): Promise<void> {
    await this.store.transaction(['documents', 'attachments'], async () => {
      const document = await this.require(id);
      for (const attachment of await this.attachments.listFor('document', id)) {
        await this.attachments.remove(attachment);
      }
      const siblings = await this.store.listBy<VehicleDocument>('documents', 'vehicle_id', document.vehicle_id);
      for (const previous of siblings.filter((row) => row.renewed_by_id === id)) {
        await this.store.update<VehicleDocument>('documents', previous.id, { renewed_by_id: null });
      }
      await this.store.remove('documents', id);
    });
  }

  private insert(fields: DocumentFields): Promise<VehicleDocument> {
    return this.store.create<VehicleDocument>('documents', { ...normalize(fields), user_id: null, renewed_by_id: null });
  }

  /** Una imagen es foto (la guía de la aseguradora); un PDF, el documento escaneado. */
  private async attach(id: Uuid, files: readonly DocumentFile[], firstOrder: number): Promise<void> {
    for (const [index, { prepared, title, notes }] of files.entries()) {
      const kind = prepared.file.type.startsWith('image/') ? 'photo' : 'document_scan';
      await this.attachments.attachPrepared('document', id, prepared, kind, firstOrder + index, { title, notes });
    }
  }

  private async require(id: Uuid): Promise<VehicleDocument> {
    const document = await this.store.get<VehicleDocument>('documents', id);
    if (!document) {
      throw new Error('El documento ya no existe.');
    }
    return document;
  }
}

/** Textos recortados y vacíos como null. */
function normalize(fields: DocumentFields): DocumentFields {
  return {
    ...fields,
    title: blankToNull(fields.title),
    issuer: blankToNull(fields.issuer),
    reference: blankToNull(fields.reference),
    coverage: blankToNull(fields.coverage),
    contact_phone: blankToNull(fields.contact_phone),
    assistance_phone: blankToNull(fields.assistance_phone),
    insured_number: blankToNull(fields.insured_number),
    policy_item: blankToNull(fields.policy_item),
    notes: blankToNull(fields.notes),
    issued_at: fields.issued_at || null,
    expires_at: fields.expires_at || null,
  };
}

function sameCaption(attachment: Attachment, caption: AttachmentCaption): boolean {
  return (attachment.title ?? '') === (caption.title?.trim() ?? '') && (attachment.notes ?? '') === (caption.notes?.trim() ?? '');
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
