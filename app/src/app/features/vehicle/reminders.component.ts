import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { dueLabel, reminderState, repeatLabel, type ReminderState } from '../../core/data/reminder-schedule';
import { ReminderService } from '../../core/data/reminder.service';
import { VehicleAlerts, isOpen, worstTone } from '../../core/data/vehicle-alerts.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { formatLongDate, todayIso } from '../../core/format';
import type { Reminder } from '../../core/models';
import { UnitsService } from '../../core/units.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { SheetComponent, SheetContentDirective } from '../../shared/sheet/sheet.component';
import { LIMITS, readNumber, readText } from '../capture/capture-form';
import { REMINDER_TEMPLATES } from './reminder-templates';

interface ReminderView {
  readonly reminder: Reminder;
  readonly state: ReminderState;
  readonly due: string;
  readonly repeat: string;
  readonly date: string | null;
}

interface LogEntry {
  readonly reminder: Reminder;
  readonly dismissed: boolean;
  readonly date: string;
  readonly km: string | null;
}

const BADGE: Record<ReminderState, string> = {
  ok: 'pst-badge--good',
  upcoming: 'pst-badge--warn',
  overdue: 'pst-badge--bad',
};

/**
 * Recordatorios del vehículo en gestión: vencidos, próximos y la bitácora de
 * lo hecho. Marcar hecho pide fecha, km y notas en una hoja; el siguiente se
 * programa solo si se repite.
 */
@Component({
  selector: 'pst-reminders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, SheetComponent, SheetContentDirective],
  templateUrl: './reminders.component.html',
  styleUrls: [
    '../capture/capture.scss',
    '../vehicles/vehicle-form.component.scss',
    './reminders.component.scss',
  ],
})
export class RemindersComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly alerts = inject(VehicleAlerts);
  private readonly service = inject(ReminderService);
  protected readonly units = inject(UnitsService);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  protected readonly badge = BADGE;
  protected readonly templates = REMINDER_TEMPLATES;

  private readonly reminders = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId) => {
      if (!vehicleId) return [];
      const rows = await db.reminders.where('vehicle_id').equals(vehicleId).toArray();
      return rows.filter((row) => !row.deleted_at);
    },
    [] as Reminder[],
  );

  /** Abiertos, el que toca antes primero. */
  private readonly open = computed<ReminderView[]>(() => {
    const today = todayIso();
    const km = this.vehicle()?.current_odometer_km ?? null;
    const distance = (value: number) => this.units.formatDistance(value);
    return this.reminders()
      .filter(isOpen)
      .map((reminder) => ({
        reminder,
        state: reminderState(reminder, today, km),
        due: dueLabel(reminder, today, km, distance) || 'Sin fecha',
        repeat: repeatLabel(reminder, distance),
        date: reminder.due_date ? formatLongDate(reminder.due_date) : null,
      }))
      .sort((a, b) => urgency(a) - urgency(b) || (a.reminder.due_date ?? '9').localeCompare(b.reminder.due_date ?? '9'));
  });

  protected readonly overdue = computed(() => this.open().filter((view) => view.state === 'overdue'));
  protected readonly upcoming = computed(() => this.open().filter((view) => view.state !== 'overdue'));

  /** Lo hecho y lo descartado, lo más reciente primero. */
  protected readonly log = computed<LogEntry[]>(() =>
    this.reminders()
      .filter((reminder) => reminder.status === 'done' || reminder.status === 'dismissed')
      .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '') || b.updated_at.localeCompare(a.updated_at))
      .map((reminder) => ({
        reminder,
        dismissed: reminder.status === 'dismissed',
        date: formatLongDate(reminder.done_at),
        km: reminder.done_odometer_km === null ? null : this.units.formatDistance(reminder.done_odometer_km),
      })),
  );

  // ── Marcar hecho ─────────────────────────────────────────────────────────
  protected readonly doneOpen = signal(false);
  protected readonly doneTarget = signal<Reminder | null>(null);
  protected readonly doneAt = signal('');
  protected readonly doneKm = signal<number | null>(null);
  protected readonly doneNotes = signal('');
  protected readonly doneSubmitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly readText = readText;
  protected readonly readNumber = readNumber;
  protected readonly today = todayIso;

  protected readonly doneError = computed(() => {
    const day = this.doneAt();
    if (!day) return 'Indica cuándo se hizo.';
    if (day > todayIso()) return 'No puede ser en el futuro.';
    const km = this.doneKm();
    if (km !== null && (!Number.isInteger(km) || km < 0 || this.units.toOdometerKm(km)! > LIMITS.km)) {
      return `El odómetro debe ser un número entero de ${this.units.distanceSymbol()}.`;
    }
    return null;
  });

  constructor() {
    effect(() => {
      const alerts = this.alerts
        .forVehicle(this.context.vehicleId())
        .filter((alert) => alert.route === '/vehicle/reminders');
      const tone = worstTone(alerts);
      const count = this.open().length;
      this.island.present({
        icon: 'bell',
        label: 'Recordatorios',
        value: alerts.length ? `${alerts.length} aviso${alerts.length === 1 ? '' : 's'}` : String(count),
        tone: tone ?? (count ? 'good' : 'idle'),
        title: this.name(),
        subtitle: alerts.length ? 'Hay recordatorios que atender' : count ? 'Todo al día' : 'Sin recordatorios',
        details: alerts.slice(0, 3).map((alert) => ({ label: alert.title, value: alert.detail })),
      });
    });
  }

  protected openDone(reminder: Reminder): void {
    this.doneTarget.set(reminder);
    this.doneAt.set(todayIso());
    this.doneKm.set(this.units.inputDistance(this.vehicle()?.current_odometer_km ?? null));
    this.doneNotes.set('');
    this.doneSubmitted.set(false);
    this.actionError.set(null);
    this.doneOpen.set(true);
  }

  protected async complete(): Promise<void> {
    this.doneSubmitted.set(true);
    const target = this.doneTarget();
    if (!target || this.doneError() || this.busy()) return;
    await this.run(async () => {
      await this.service.complete(target.id, {
        done_at: this.doneAt(),
        done_odometer_km: this.units.toOdometerKm(this.doneKm()),
        notes: this.doneNotes(),
      });
      this.doneOpen.set(false);
    });
  }

  protected async dismiss(reminder: Reminder): Promise<void> {
    await this.run(() => this.service.dismiss(reminder.id, todayIso()));
  }

  private async run(work: () => Promise<unknown>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await work();
    } catch (error) {
      this.actionError.set(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      this.busy.set(false);
    }
  }
}

function urgency(view: ReminderView): number {
  return view.state === 'overdue' ? 0 : view.state === 'upcoming' ? 1 : 2;
}
