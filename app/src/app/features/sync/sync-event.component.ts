import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { db } from '../../core/db/piston-db';
import type { SyncLogEntry, SyncRun } from '../../core/models';
import { OP_LABEL, TABLE_LABEL } from '../../core/sync/describe';
import { IconComponent } from '../../shared/icon/icon.component';
import { SyncAttemptComponent } from './sync-attempt.component';
import { TRIGGER_LABEL, exactLocal, exactUtc } from './sync-format';

const OUTCOME: Record<SyncLogEntry['outcome'], { label: string; tone: string; explain: string }> = {
  applied: { label: 'Subido', tone: 'good', explain: 'El servidor aplicó el cambio.' },
  stale: {
    label: 'Ganó otra versión',
    tone: 'idle',
    explain:
      'El servidor ya tenía una versión más reciente de este registro (editada en otro dispositivo) y la conservó. Este dispositivo recibió esa versión.',
  },
  rejected: { label: 'Rechazado', tone: 'bad', explain: 'El servidor no aceptó el cambio.' },
  discarded: { label: 'Descartado', tone: 'idle', explain: 'Descartaste este cambio desde este dispositivo.' },
  uploaded: { label: 'Archivo subido', tone: 'good', explain: 'El archivo llegó completo al servidor.' },
  upload_failed: { label: 'Archivo rechazado', tone: 'bad', explain: 'El servidor no aceptó el archivo.' },
};

/** Detalle de un evento del historial: qué pasó con un cambio en un ciclo concreto. */
@Component({
  selector: 'pst-sync-event',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, SyncAttemptComponent],
  templateUrl: './sync-event.component.html',
  styleUrl: './sync-detail.scss',
})
export class SyncEventComponent {
  private readonly store = inject(OfflineStore);

  readonly id = input.required<string>();

  protected readonly event = this.store.liveFrom(this.id, (id) => db.sync_log.get(id).then((e) => e ?? null), null as SyncLogEntry | null);
  protected readonly run = this.store.liveFrom(
    computed(() => this.event()?.run_id ?? null),
    async (runId) => (runId ? ((await db.sync_runs.get(runId)) ?? null) : null),
    null as SyncRun | null,
  );

  protected readonly outcome = computed(() => {
    const event = this.event();
    return event ? OUTCOME[event.outcome] : null;
  });

  protected readonly opLabel = OP_LABEL;
  protected readonly tableLabel = TABLE_LABEL;
  protected readonly triggerLabel = TRIGGER_LABEL;
  protected readonly exactLocal = exactLocal;
  protected readonly exactUtc = exactUtc;
}
