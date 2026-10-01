import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { OfflineStore } from '../../core/data/offline-store.service';
import { db } from '../../core/db/piston-db';
import type { Attachment, OutboxEntry, SyncAttempt, SyncLogEntry, SyncRun } from '../../core/models';
import { DIAGNOSIS } from '../../core/sync/diagnosis';
import { OP_LABEL, describeRow } from '../../core/sync/describe';
import { SyncService } from '../../core/sync/sync.service';
import { IconComponent, type IconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { SegmentedComponent, type SegmentedOption } from '../../shared/segmented/segmented.component';
import { SyncAttemptComponent } from './sync-attempt.component';
import { CONFLICT_SHORT, TABLE_ICON, TRIGGER_LABEL, clock, dayLabel, relative } from './sync-format';

type View = 'current' | 'history';

/** Una fila de la vista "Actual": un cambio o un archivo que no ha subido. */
interface PendingItem {
  readonly id: string;
  readonly link: readonly string[];
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string;
  readonly cause: string;
  readonly badge: string;
  readonly tone: 'bad' | 'warn' | 'idle';
}

interface HistoryItem {
  readonly id: string;
  readonly at: string;
  readonly run: SyncRun | null;
  readonly event: SyncLogEntry | null;
}

interface HistoryDay {
  readonly label: string;
  readonly items: readonly HistoryItem[];
}

const OUTCOME_TEXT: Record<SyncLogEntry['outcome'], { label: string; tone: string }> = {
  applied: { label: 'Subido', tone: 'good' },
  merged: { label: 'Se combinó con otro dispositivo', tone: 'good' },
  stale: { label: 'Ganó otra versión', tone: 'idle' },
  rejected: { label: 'Rechazado', tone: 'bad' },
  conflict: { label: 'Conflicto', tone: 'bad' },
  resolved_mine: { label: 'Conflicto: se conservó la tuya', tone: 'good' },
  resolved_theirs: { label: 'Conflicto: se usó la del servidor', tone: 'good' },
  resolved_fields: { label: 'Conflicto: se eligió por campo', tone: 'good' },
  resolved_restore: { label: 'Conflicto: se restauró', tone: 'good' },
  resolved_accept_delete: { label: 'Conflicto: se aceptó el borrado', tone: 'idle' },
  discarded: { label: 'Descartado', tone: 'idle' },
  uploaded: { label: 'Archivo subido', tone: 'good' },
  upload_failed: { label: 'Archivo rechazado', tone: 'bad' },
};

/**
 * Centro de sincronización: el ÚNICO lugar para ver y resolver el sync.
 *
 * "Actual" es lo que falta por subir (en conflicto, con error, bloqueado o en
 * cola) y cada fila lleva a su diagnóstico. "Historial" son los ciclos recientes y qué pasó
 * con cada cambio. El botón de abajo reintenta todo de una vez.
 */
@Component({
  selector: 'pst-sync-center',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, SegmentedComponent, SyncAttemptComponent],
  templateUrl: './sync-center.component.html',
  styleUrl: './sync-center.component.scss',
})
export class SyncCenterComponent {
  private readonly sync = inject(SyncService);
  private readonly store = inject(OfflineStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly island = inject(IslandService);

  protected readonly summary = this.sync.summary;
  protected readonly progress = this.sync.progress;
  protected readonly lastAttempt = this.sync.lastAttempt;
  protected readonly retrying = signal(false);
  protected readonly expandedRun = signal<string | null>(null);

  protected readonly view = toSignal(
    this.route.queryParamMap.pipe(map((params) => (params.get('view') === 'history' ? 'history' : 'current') as View)),
    { initialValue: 'current' as View },
  );

  private readonly outbox = this.store.liveSignal(() => db.sync_outbox.toArray(), [] as OutboxEntry[]);

  private readonly uploads = this.store.liveSignal(async () => {
    const attachments = await db.attachments
      .where('upload_status')
      .anyOf('pending', 'uploading', 'failed')
      .filter((attachment) => !!attachment.local_blob_key)
      .toArray();
    const blobs = await db.attachment_blobs.bulkGet(attachments.map((a) => a.local_blob_key!));
    return attachments.map((attachment, i) => ({ attachment, attempt: blobs[i]?.last_attempt ?? null }));
  }, [] as { attachment: Attachment; attempt: SyncAttempt | null }[]);

  private readonly runs = this.store.liveSignal(
    () => db.sync_runs.orderBy('started_at').reverse().limit(200).toArray(),
    [] as SyncRun[],
  );

  private readonly events = this.store.liveSignal(
    () => db.sync_log.orderBy('at').reverse().limit(1000).toArray(),
    [] as SyncLogEntry[],
  );

  protected readonly conflicts = computed(() => this.itemsFor('conflict'));
  protected readonly failed = computed(() => this.itemsFor('failed'));
  protected readonly blocked = computed(() => this.itemsFor('blocked'));
  protected readonly pending = computed(() => this.itemsFor('pending'));
  protected readonly fileItems = computed<PendingItem[]>(() =>
    this.uploads().map(({ attachment, attempt }) => {
      const failed = attachment.upload_status === 'failed';
      return {
        id: attachment.id,
        link: ['file', attachment.id],
        icon: 'camera',
        title: attachment.file_name,
        detail: 'Foto o archivo',
        cause: attempt ? DIAGNOSIS[attempt.kind].short : 'En cola',
        badge: failed ? 'Error' : attachment.upload_status === 'uploading' ? 'Subiendo' : 'Pendiente',
        tone: failed ? 'bad' : 'warn',
      };
    }),
  );

  protected readonly totalOpen = computed(
    () =>
      this.conflicts().length +
      this.failed().length +
      this.blocked().length +
      this.pending().length +
      this.fileItems().length,
  );

  protected readonly viewOptions = computed<readonly SegmentedOption<View>[]>(() => [
    { value: 'current', label: 'Actual', count: this.totalOpen() },
    { value: 'history', label: 'Historial' },
  ]);

  protected readonly history = computed<HistoryDay[]>(() => {
    const items: HistoryItem[] = [
      ...this.runs().map((run) => ({ id: run.id, at: run.started_at, run, event: null })),
      // Lo que no pertenece a un ciclo (p. ej. un descarte) va suelto en la línea de tiempo.
      ...this.events()
        .filter((event) => event.run_id === null)
        .map((event) => ({ id: event.id, at: event.at, run: null, event })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const days: { label: string; items: HistoryItem[] }[] = [];
    for (const item of items) {
      const label = dayLabel(item.at);
      const last = days.at(-1);
      if (last?.label === label) last.items.push(item);
      else days.push({ label, items: [item] });
    }
    return days;
  });

  private readonly eventsByRun = computed(() => {
    const byRun = new Map<string, SyncLogEntry[]>();
    for (const event of this.events()) {
      if (!event.run_id) continue;
      const list = byRun.get(event.run_id) ?? [];
      list.push(event);
      byRun.set(event.run_id, list);
    }
    return byRun;
  });

  protected readonly headline = computed(() => {
    const s = this.summary();
    const open = s.pending + s.blocked + s.failed + s.conflicts + s.uploads + s.failedUploads;
    switch (s.health) {
      case 'expired':
        return { icon: 'cloudOff' as IconName, tone: 'warn', title: 'Sesión expirada', sub: 'Inicia sesión para enviar lo pendiente.' };
      case 'offline':
        return {
          icon: 'cloudOff' as IconName,
          tone: 'warn',
          title: 'Sin conexión',
          sub: open > 0 ? `${open} ${open === 1 ? 'cambio espera' : 'cambios esperan'} la señal. Se enviarán solos.` : 'Todo lo que captures se guarda aquí y se envía al volver la señal.',
        };
      case 'syncing':
        return { icon: 'sync' as IconName, tone: 'brand', title: 'Sincronizando…', sub: this.phaseText() };
      case 'conflict':
        return {
          icon: 'alert' as IconName,
          tone: 'bad',
          title: s.conflicts === 1 ? '1 conflicto' : `${s.conflicts} conflictos`,
          sub: 'Se cambió lo mismo en otro dispositivo. Toca cada uno para decidir qué versión conservar.',
        };
      case 'error':
        return {
          icon: 'alert' as IconName,
          tone: 'bad',
          title: `${s.failed + s.failedUploads} con error`,
          sub: 'El servidor rechazó algunos cambios. Toca cada uno para ver por qué.',
        };
      case 'pending': {
        const attempt = this.lastAttempt();
        return {
          icon: 'clock' as IconName,
          tone: 'warn',
          title: `${open} por subir`,
          sub: attempt ? `${DIAGNOSIS[attempt.kind].short} · se reintenta solo` : 'Se están enviando en segundo plano.',
        };
      }
      default:
        return {
          icon: 'cloudCheck' as IconName,
          tone: 'good',
          title: 'Todo sincronizado',
          sub: `Última sincronización ${relative(s.lastSyncedAt)}.`,
        };
    }
  });

  protected readonly syncDisabledReason = computed(() => {
    const s = this.summary();
    if (s.health === 'expired') return 'Inicia sesión para poder sincronizar.';
    if (s.health === 'offline') return 'Sin conexión. Se sincronizará solo al volver la señal.';
    return null;
  });

  protected readonly clock = clock;
  protected readonly relative = relative;
  protected readonly triggerLabel = TRIGGER_LABEL;
  protected readonly outcomeText = OUTCOME_TEXT;

  constructor() {
    effect(() => {
      const s = this.summary();
      const open = s.pending + s.blocked + s.failed + s.conflicts + s.uploads + s.failedUploads;
      this.island.present({
        icon: this.headline().icon,
        label: 'Sincronización',
        value: String(open),
        tone: s.health === 'error' || s.health === 'conflict' ? 'bad' : open > 0 ? 'warn' : 'good',
        title: this.headline().title,
        subtitle: this.headline().sub,
        details: [
          ...(s.conflicts > 0 ? [{ label: 'Conflictos', value: String(s.conflicts) }] : []),
          { label: 'Pendientes', value: String(s.pending + s.blocked) },
          { label: 'Con error', value: String(s.failed + s.failedUploads) },
          { label: 'Último sync', value: relative(s.lastSyncedAt) },
        ],
        pulsing: s.health === 'syncing',
      });
    });
  }

  protected setView(view: View): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: view === 'current' ? null : view },
      replaceUrl: true,
    });
  }

  protected async syncAll(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try {
      await this.sync.retryAll();
    } finally {
      this.retrying.set(false);
    }
  }

  protected relogin(): void {
    void this.router.navigateByUrl('/login');
  }

  protected toggleRun(id: string): void {
    this.expandedRun.update((current) => (current === id ? null : id));
  }

  protected runEvents(id: string): readonly SyncLogEntry[] {
    return this.eventsByRun().get(id) ?? [];
  }

  protected runSummary(run: SyncRun): string {
    const parts: string[] = [];
    if (run.applied) parts.push(`${run.applied} subidos`);
    if (run.stale) parts.push(`${run.stale} ya actualizados`);
    if (run.rejected) parts.push(`${run.rejected} rechazados o en conflicto`);
    if (run.pulled) parts.push(`${run.pulled} recibidos`);
    if (run.uploaded) parts.push(`${run.uploaded} archivos`);
    if (run.error) parts.push(DIAGNOSIS[run.error.kind].short);
    return parts.join(' · ') || 'Sin cambios';
  }

  protected runTone(run: SyncRun): string {
    switch (run.outcome) {
      case 'ok':
        return 'good';
      case 'partial':
        return 'bad';
      case 'failed':
      case 'auth':
        return 'warn';
      default:
        return 'idle';
    }
  }

  protected runLabel(run: SyncRun): string {
    switch (run.outcome) {
      case 'ok':
        return 'Correcto';
      case 'partial':
        return 'Con rechazos';
      case 'failed':
        return 'Falló';
      case 'auth':
        return 'Sin sesión';
      default:
        return 'En curso';
    }
  }

  protected eventTitle(event: SyncLogEntry): string {
    return `${OP_LABEL[event.op]} · ${event.label}`;
  }

  private itemsFor(status: 'conflict' | 'failed' | 'blocked' | 'pending'): PendingItem[] {
    return this.outbox()
      .filter((entry) => (status === 'pending' ? entry.status === 'pending' || entry.status === 'in_flight' : entry.status === status))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((entry) => {
        const { title, detail } = describeRow(entry.table_name, entry.payload ? JSON.parse(entry.payload) : null);
        const attempt = entry.last_attempt;
        return {
          id: entry.id,
          link: [status === 'conflict' ? 'conflict' : 'change', entry.id],
          icon: TABLE_ICON[entry.table_name] ?? 'sync',
          title: `${title} · ${OP_LABEL[entry.op].toLowerCase()}`,
          detail,
          cause:
            status === 'conflict'
              ? CONFLICT_SHORT[entry.conflict?.kind ?? 'edit_edit']
              : entry.status === 'in_flight'
                ? 'Enviando…'
                : attempt
                  ? DIAGNOSIS[attempt.kind].short
                  : 'En cola',
          badge:
            status === 'conflict'
              ? 'Conflicto'
              : status === 'failed'
                ? 'Error'
                : status === 'blocked'
                  ? 'Bloqueado'
                  : entry.status === 'in_flight'
                    ? 'Enviando'
                    : 'Pendiente',
          tone: status === 'failed' || status === 'conflict' ? 'bad' : status === 'blocked' ? 'warn' : 'idle',
        };
      });
  }

  private phaseText(): string {
    switch (this.progress().phase) {
      case 'push':
        return 'Enviando cambios al servidor.';
      case 'pull':
        return `Recibiendo datos (${this.progress().pulled}).`;
      case 'uploads':
        return 'Subiendo fotos y archivos.';
      default:
        return 'Poniéndose al día.';
    }
  }
}
