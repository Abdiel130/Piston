import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { db } from '../../core/db/piston-db';
import type { Attachment, OutboxEntry, SyncAttempt } from '../../core/models';
import { DIAGNOSIS } from '../../core/sync/diagnosis';
import { OP_LABEL, describeRow, rowLabel } from '../../core/sync/describe';
import { SyncService } from '../../core/sync/sync.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { SyncAttemptComponent } from './sync-attempt.component';
import { exactLocal, fieldLabel, relative } from './sync-format';

/** Columnas que el usuario no necesita ver en el resumen de lo enviado. */
const HIDDEN_FIELDS = new Set(['id', 'user_id', 'rev', 'created_at', 'updated_at', 'deleted_at', 'local_blob_key']);

/**
 * Detalle de algo que no subió: un cambio del outbox (`/cambio/:id`) o el
 * binario de un adjunto (`/archivo/:id`). Dice por qué, cómo se arregla, y da
 * el request id y la hora exacta para buscarlo en los logs del servidor.
 */
@Component({
  selector: 'pst-sync-change',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, SyncAttemptComponent],
  templateUrl: './sync-change.component.html',
  styleUrl: './sync-detail.scss',
})
export class SyncChangeComponent {
  private readonly store = inject(OfflineStore);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);

  /** Parámetro de la ruta (`withComponentInputBinding`). */
  readonly id = input.required<string>();
  /** `data.kind` de la ruta. */
  readonly kind = input<'change' | 'upload'>('change');

  protected readonly online = this.sync.online;
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly confirming = signal(false);
  protected readonly dependents = signal<readonly string[]>([]);

  private readonly target = computed(() => ({ id: this.id(), kind: this.kind() }));
  private readonly loaded = signal(false);

  protected readonly entry = this.store.liveFrom(
    this.target,
    async ({ id, kind }) => {
      const found = kind === 'change' ? await db.sync_outbox.get(id) : undefined;
      this.loaded.set(true);
      return found ?? null;
    },
    null as OutboxEntry | null,
  );

  private readonly upload = this.store.liveFrom(
    this.target,
    async ({ id, kind }) => {
      if (kind !== 'upload') return null;
      const attachment = await db.attachments.get(id);
      const blob = attachment?.local_blob_key ? await db.attachment_blobs.get(attachment.local_blob_key) : undefined;
      this.loaded.set(true);
      return attachment ? { attachment, attempt: blob?.last_attempt ?? null } : null;
    },
    null as { attachment: Attachment; attempt: SyncAttempt | null } | null,
  );

  protected readonly blockedBy = this.store.liveFrom(
    computed(() => this.entry()?.blocked_by ?? null),
    async (ref) => {
      if (!ref) return null;
      const entry = await db.sync_outbox.where('[table_name+row_id]').equals([ref.table, ref.id]).first();
      const row = (await db.table(ref.table).get(ref.id)) as Record<string, unknown> | undefined;
      return {
        link: entry ? ['/settings/sync', entry.status === 'conflict' ? 'conflict' : 'change', entry.id] : null,
        label: rowLabel(ref.table, row ?? null),
        conflict: entry?.status === 'conflict',
      };
    },
    null as { link: string[] | null; label: string; conflict: boolean } | null,
  );


  protected readonly gone = computed(() => this.loaded() && !this.entry() && !this.upload());

  protected readonly payload = computed<Record<string, unknown> | null>(() => {
    const entry = this.entry();
    if (entry?.payload) return JSON.parse(entry.payload) as Record<string, unknown>;
    const upload = this.upload();
    return upload ? (upload.attachment as unknown as Record<string, unknown>) : null;
  });

  protected readonly heading = computed(() => {
    const entry = this.entry();
    if (entry) {
      const { title, detail } = describeRow(entry.table_name, this.payload());
      return { title, detail, op: OP_LABEL[entry.op] };
    }
    const upload = this.upload();
    return upload
      ? { title: upload.attachment.file_name, detail: 'Foto o archivo', op: OP_LABEL.upload }
      : { title: 'Cambio', detail: '', op: '' };
  });

  protected readonly attempt = computed(() => this.entry()?.last_attempt ?? this.upload()?.attempt ?? null);

  protected readonly state = computed(() => {
    const entry = this.entry();
    const upload = this.upload()?.attachment;
    const status = entry?.status ?? (upload?.upload_status === 'failed' ? 'failed' : upload ? 'pending' : null);
    switch (status) {
      case 'failed':
        return { label: 'Con error', tone: 'bad' };
      case 'blocked':
        return { label: 'Bloqueado', tone: 'warn' };
      case 'in_flight':
        return { label: 'Enviando', tone: 'warn' };
      default:
        return { label: 'Pendiente', tone: 'warn' };
    }
  });

  protected readonly fields = computed(() =>
    Object.entries(this.payload() ?? {})
      .filter(([key, value]) => !HIDDEN_FIELDS.has(key) && value !== null && value !== '')
      .map(([key, value]) => ({ label: fieldLabel(key), value: String(value) })),
  );

  protected readonly canDiscard = computed(() => {
    const attempt = this.attempt();
    return this.kind() === 'upload' || !attempt || DIAGNOSIS[attempt.kind].actions.includes('discard') || this.entry()?.status === 'failed';
  });

  protected readonly exactLocal = exactLocal;
  protected readonly relative = relative;

  protected async retry(): Promise<void> {
    await this.run(async () => {
      if (this.kind() === 'upload') {
        await db.attachments.update(this.id(), { upload_status: 'pending' });
        await this.sync.sync('manual');
      } else {
        await this.sync.retryOne(this.id());
      }
    });
  }

  protected async askDiscard(): Promise<void> {
    if (this.kind() === 'change') {
      const dependents = await this.sync.dependentsOf(this.id());
      this.dependents.set(dependents.map((d) => rowLabel(d.table_name, d.payload ? JSON.parse(d.payload) : null)));
    }
    this.confirming.set(true);
  }

  protected async discard(): Promise<void> {
    await this.run(async () => {
      if (this.kind() === 'upload') {
        const attachment = this.upload()?.attachment;
        if (attachment?.local_blob_key) await db.attachment_blobs.delete(attachment.local_blob_key);
        await this.store.remove('attachments', this.id());
      } else {
        await this.sync.discard(this.id());
      }
      await this.router.navigate(['/settings/sync']);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await action();
    } catch (error) {
      this.actionError.set(
        this.online()
          ? `No se pudo completar: ${error instanceof Error ? error.message : String(error)}`
          : 'Necesitas conexión para restaurar la versión del servidor.',
      );
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }
}
