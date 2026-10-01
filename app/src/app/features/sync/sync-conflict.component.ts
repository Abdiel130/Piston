import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { db } from '../../core/db/piston-db';
import type { OutboxEntry } from '../../core/models';
import { conflictView, type ConflictSide } from '../../core/sync/conflict';
import { describeRow, rowLabel, TABLE_LABEL } from '../../core/sync/describe';
import { SyncService } from '../../core/sync/sync.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { exactLocal, fieldLabel, fieldValue } from './sync-format';

/** Lo que el usuario está por hacer, para pedirle confirmación antes. */
type Action = 'fields' | 'mine' | 'theirs' | 'restore' | 'accept_delete' | 'restore_parent' | 'discard';

interface CompareRow {
  readonly field: string;
  readonly label: string;
  readonly mine: string;
  readonly theirs: string;
}

interface MergedRow {
  readonly label: string;
  readonly value: string;
  readonly from: string;
}

/**
 * Detalle de un conflicto: qué chocó, las dos versiones lado a lado (solo los
 * campos en conflicto) y lo que se combinó solo. Ninguna acción se ejecuta sin
 * confirmar, y cada resolución queda en el Historial.
 */
@Component({
  selector: 'pst-sync-conflict',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './sync-conflict.component.html',
  styleUrls: ['./sync-detail.scss', './sync-conflict.component.scss'],
})
export class SyncConflictComponent {
  private readonly store = inject(OfflineStore);
  private readonly sync = inject(SyncService);
  private readonly router = inject(Router);

  /** Parámetro de la ruta (`withComponentInputBinding`). */
  readonly id = input.required<string>();

  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);
  protected readonly confirming = signal<Action | null>(null);
  protected readonly dependents = signal<readonly string[]>([]);
  /** Lado elegido por campo. Por defecto, el mío: nada cambia sin que el usuario lo pida. */
  protected readonly choices = signal<Readonly<Record<string, ConflictSide>>>({});

  private readonly loaded = signal(false);

  protected readonly entry = this.store.liveFrom(
    this.id,
    async (id) => {
      const found = await db.sync_outbox.get(id);
      this.loaded.set(true);
      return found ?? null;
    },
    null as OutboxEntry | null,
  );

  protected readonly view = computed(() => {
    const entry = this.entry();
    return entry?.status === 'conflict' ? conflictView(entry) : null;
  });

  protected readonly gone = computed(() => this.loaded() && !this.view());

  /** Lo que espera detrás de este conflicto (hijos bloqueados). */
  protected readonly waiting = this.store.liveFrom(
    computed(() => this.entry()),
    async (entry) => {
      if (!entry) return [] as string[];
      const blocked = await db.sync_outbox.where('status').equals('blocked').toArray();
      return blocked
        .filter((other) => other.blocked_by?.table === entry.table_name && other.blocked_by.id === entry.row_id)
        .map((other) => rowLabel(other.table_name, other.payload ? JSON.parse(other.payload) : null));
    },
    [] as string[],
  );

  protected readonly kind = computed(() => {
    const view = this.view();
    if (!view) return null;
    if (view.conflict.kind === 'edit_delete' && !view.mine) return 'delete_edit' as const;
    return view.conflict.kind;
  });

  protected readonly heading = computed(() => {
    const entry = this.entry();
    const { title, detail } = describeRow(entry?.table_name ?? 'vehicles', this.view()?.mine ?? this.view()?.base ?? null);
    switch (this.kind()) {
      case 'edit_edit':
        return { title, detail, headline: 'Se editó en otro dispositivo al mismo tiempo' };
      case 'edit_delete':
        return { title, detail, headline: 'Se borró en otro dispositivo mientras lo editabas' };
      case 'delete_edit':
        return { title, detail, headline: 'Lo borraste, pero se editó en otro dispositivo' };
      case 'create_in_deleted_parent':
        return { title, detail, headline: 'Lo registraste dentro de algo que se borró' };
      default:
        return { title, detail, headline: '' };
    }
  });

  /** Lado a lado, solo los campos en conflicto. */
  protected readonly compare = computed<CompareRow[]>(() => {
    const view = this.view();
    if (!view || this.kind() === 'create_in_deleted_parent') return [];
    return view.fields.map((field) => ({
      field,
      label: fieldLabel(field),
      mine: view.mine ? fieldValue(field, view.mine[field]) : 'Borrado',
      theirs: this.kind() === 'edit_delete' ? 'Borrado' : fieldValue(field, view.theirs?.[field]),
    }));
  });

  /** Lo que se combinó solo: no chocaba y se conserva de los dos lados. */
  protected readonly merged = computed<MergedRow[]>(() => {
    const view = this.view();
    if (!view || this.kind() !== 'edit_edit') return [];
    return [
      ...view.fromMine.map((field) => ({ label: fieldLabel(field), value: fieldValue(field, view.mine?.[field]), from: 'Tuyo' })),
      ...view.fromTheirs.map((field) => ({
        label: fieldLabel(field),
        value: fieldValue(field, view.theirs?.[field]),
        from: 'Otro dispositivo',
      })),
    ];
  });

  protected readonly parentLabel = computed(() => {
    const view = this.view();
    const parent = view?.conflict.parent;
    return parent ? rowLabel(parent.table, view.theirs as Record<string, unknown> | null) : '';
  });

  protected readonly parentTable = computed(() => {
    const parent = this.view()?.conflict.parent;
    return parent ? TABLE_LABEL[parent.table].toLowerCase() : 'registro';
  });

  protected readonly mixedChoice = computed(() => {
    const picked = new Set(this.compare().map((row) => this.choices()[row.field] ?? 'mine'));
    return picked.size > 1;
  });

  protected readonly exactLocal = exactLocal;

  constructor() {
    // Al cambiar de conflicto, las elecciones vuelven a "la mía".
    effect(() => {
      this.id();
      this.choices.set({});
      this.confirming.set(null);
    });
  }

  protected side(field: string): ConflictSide {
    return this.choices()[field] ?? 'mine';
  }

  protected pick(field: string, side: ConflictSide): void {
    this.choices.update((current) => ({ ...current, [field]: side }));
  }

  protected async ask(action: Action): Promise<void> {
    this.actionError.set(null);
    if (action === 'accept_delete' || action === 'discard') {
      const dependents = await this.sync.dependentsOf(this.id());
      this.dependents.set(dependents.map((d) => rowLabel(d.table_name, d.payload ? JSON.parse(d.payload) : null)));
    } else {
      this.dependents.set([]);
    }
    this.confirming.set(action);
  }

  protected async confirm(): Promise<void> {
    const action = this.confirming();
    if (!action || this.busy()) return;

    this.busy.set(true);
    this.actionError.set(null);
    try {
      const next = await this.execute(action);
      await this.router.navigate(next ?? ['/settings/sync']);
    } catch (error) {
      this.actionError.set(
        this.sync.online()
          ? `No se pudo completar: ${error instanceof Error ? error.message : String(error)}`
          : 'Necesitas conexión para restaurar la versión del servidor de lo que depende de este cambio.',
      );
    } finally {
      this.busy.set(false);
      this.confirming.set(null);
    }
  }

  /** @returns a dónde ir después, si no es el centro de sincronización. */
  private async execute(action: Action): Promise<string[] | null> {
    const id = this.id();
    switch (action) {
      case 'fields':
        await this.sync.resolveFields(id, this.choices());
        return null;
      case 'mine':
        await this.sync.resolveKeepMine(id);
        return null;
      case 'theirs':
        await this.sync.resolveTakeServer(id);
        return null;
      case 'restore':
        await this.sync.resolveRestore(id);
        return null;
      case 'accept_delete':
        await this.sync.resolveAcceptDelete(id);
        return null;
      case 'restore_parent': {
        const parentConflict = await this.sync.resolveRestoreParent(id);
        return parentConflict ? ['/settings/sync/conflict', parentConflict.id] : null;
      }
      case 'discard':
        await this.sync.discard(id);
        return null;
    }
  }
}
