import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { DEFAULT_NOTIFY_DAYS, DEFAULT_NOTIFY_KM, addPeriod, repeatLabel } from '../../core/data/reminder-schedule';
import { ReminderService, type ReminderFields } from '../../core/data/reminder.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { todayIso } from '../../core/format';
import type { Reminder, RepeatUnit } from '../../core/models';
import { UnitsService } from '../../core/units.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { LIMITS, readNumber, readText, type Errors } from '../capture/capture-form';
import { nextEmissionsDeadline } from './emissions-calendar';
import { reminderTemplate } from './reminder-templates';

/**
 * `once`: una sola vez. `period`: cada N desde que se hace. `fixed`: cada N
 * en la misma fecha del calendario. `km`: solo por kilometraje.
 */
type RepeatMode = 'once' | 'period' | 'fixed' | 'km';

/** Distancias en la unidad del usuario; se pasan a km al guardar. */
interface FormValue {
  title: string;
  mode: RepeatMode;
  every: number | null;
  unit: RepeatUnit;
  repeat_km: number | null;
  due_date: string;
  due_km: number | null;
  notify_days: number | null;
  notify_km: number | null;
  notes: string;
  /** Solo en la bitácora. */
  done_at: string;
  done_km: number | null;
}

type Field = keyof FormValue;

const BLANK: FormValue = {
  title: '',
  mode: 'period',
  every: 1,
  unit: 'month',
  repeat_km: null,
  due_date: '',
  due_km: null,
  notify_days: 15,
  notify_km: 500,
  notes: '',
  done_at: '',
  done_km: null,
};

const MODES: readonly { value: RepeatMode; label: string }[] = [
  { value: 'period', label: 'Cada cierto tiempo' },
  { value: 'fixed', label: 'Misma fecha' },
  { value: 'km', label: 'Por kilometraje' },
  { value: 'once', label: 'Una vez' },
];

const UNITS: readonly { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: 'Días' },
  { value: 'week', label: 'Semanas' },
  { value: 'month', label: 'Meses' },
  { value: 'year', label: 'Años' },
];

/**
 * Alta y edición de un recordatorio del vehículo. Con `template` (query
 * param) arranca de una plantilla; con `id` edita. Una entrada de la
 * bitácora solo deja corregir lo que se anotó al hacerla.
 */
@Component({
  selector: 'pst-reminder-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './reminder-form.component.html',
  styleUrls: ['../capture/capture.scss', '../vehicles/vehicle-form.component.scss', './document-form.component.scss'],
})
export class ReminderFormComponent {
  private readonly store = inject(OfflineStore);
  private readonly reminders = inject(ReminderService);
  private readonly context = inject(VehicleContext);
  private readonly router = inject(Router);
  protected readonly units = inject(UnitsService);

  readonly back = input.required<string>();
  readonly backLabel = input.required<string>();
  /** Parámetro de ruta: el recordatorio a editar. */
  readonly id = input<string>();
  /** Query param: la plantilla de la que arranca un alta. */
  readonly template = input<string>();

  protected readonly modes = MODES;
  protected readonly unitOptions = UNITS;

  protected readonly editing = computed(() => !!this.id());
  protected readonly saved = this.store.liveFrom(
    computed(() => this.id() ?? null),
    async (id) => (id ? ((await this.store.get<Reminder>('reminders', id)) ?? null) : null),
    undefined as Reminder | null | undefined,
  );
  protected readonly missing = computed(() => this.editing() && this.saved() === null);
  /** Hecho o descartado: es una entrada de la bitácora. */
  protected readonly isLog = computed(() => {
    const status = this.saved()?.status;
    return status === 'done' || status === 'dismissed';
  });

  protected readonly owner = computed(() => {
    const vehicleId = this.saved()?.vehicle_id ?? this.context.vehicleId();
    return this.context.vehicles().find((vehicle) => vehicle.id === vehicleId) ?? null;
  });
  /** Odómetro actual en la unidad del usuario. */
  protected readonly odometer = computed(() => this.units.inputDistance(this.owner()?.current_odometer_km ?? null));

  protected readonly form = signal<FormValue>({ ...BLANK });
  private readonly hydrated = signal(false);

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);

  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  protected readonly title = computed(() => {
    if (this.isLog()) return 'Entrada de la bitácora';
    return this.editing() ? 'Editar recordatorio' : 'Nuevo recordatorio';
  });

  /** "Cada 2 meses", para confirmar lo que se va a guardar. */
  protected readonly summary = computed(() => {
    const fields = this.toFields(this.form(), '');
    return repeatLabel(fields, (km) => this.units.formatDistance(km));
  });

  protected readonly errors = computed<Errors<Field>>(() => {
    const f = this.form();
    const e: Errors<Field> = {};
    const title = f.title.trim();
    if (!title) e.title = 'Ponle un nombre.';
    else if (title.length > 160) e.title = 'Máximo 160 caracteres.';
    const whole = (key: Field, value: number | null, min: number, max: number, required: boolean, message: string) => {
      if (value === null) {
        if (required) e[key] = message;
      } else if (!Number.isInteger(value) || value < min || value > max) {
        e[key] = `Debe ser un entero entre ${min} y ${max.toLocaleString('es-MX')}.`;
      }
    };

    if (this.isLog()) {
      if (!f.done_at) e.done_at = 'Indica cuándo se hizo.';
      else if (f.done_at > todayIso()) e.done_at = 'No puede ser en el futuro.';
      whole('done_km', f.done_km, 0, LIMITS.km, false, '');
      return e;
    }

    const byDate = f.mode === 'period' || f.mode === 'fixed';
    if (byDate) whole('every', f.every, 1, 999, true, 'Indica cada cuánto.');
    whole('repeat_km', f.repeat_km, 1, 1_000_000, f.mode === 'km', 'Indica cada cuántos.');
    whole('due_km', f.due_km, 0, LIMITS.km, f.mode === 'km', 'Indica a qué kilometraje toca.');
    if (f.mode !== 'km' && !f.due_date && !(f.mode === 'once' && f.due_km !== null)) {
      e.due_date = 'Indica cuándo toca.';
    }
    whole('notify_days', f.notify_days, 0, 365, false, '');
    whole('notify_km', f.notify_km, 0, 100_000, false, '');
    return e;
  });

  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  constructor() {
    // Se hidrata UNA vez: después el formulario es del usuario. Un alta
    // espera al vehículo para proponer fechas y km.
    effect(() => {
      if (untracked(this.hydrated)) return;
      if (this.editing()) {
        const source = this.saved();
        if (!source) return;
        untracked(() => this.form.set(this.toForm(source)));
      } else {
        const owner = this.owner();
        if (!owner) return;
        untracked(() => this.form.set(this.fromTemplate()));
      }
      untracked(() => this.hydrated.set(true));
    });
  }

  protected set<K extends Field>(key: K, value: FormValue[K]): void {
    this.form.update((form) => ({ ...form, [key]: value }));
  }

  /** Al pasar a kilometraje sin km de vencimiento, propone odómetro + intervalo. */
  protected setMode(mode: RepeatMode): void {
    this.form.update((form) => {
      const next = { ...form, mode };
      if (mode === 'km' && next.due_km === null && next.repeat_km !== null && this.odometer() !== null) {
        next.due_km = this.odometer()! + next.repeat_km;
      }
      return next;
    });
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const vehicleId = this.saved()?.vehicle_id ?? this.context.vehicleId();
    if (!vehicleId || !this.valid() || this.saving()) return;

    this.saving.set(true);
    this.saveError.set(null);
    const f = this.form();
    try {
      const id = this.id();
      if (id && this.isLog()) {
        await this.reminders.updateLog(id, {
          title: f.title,
          done_at: f.done_at,
          done_odometer_km: this.units.toOdometerKm(f.done_km),
          notes: f.notes,
        });
      } else if (id) {
        await this.reminders.update(id, this.toFields(f, vehicleId));
      } else {
        await this.reminders.create(this.toFields(f, vehicleId));
      }
      await this.router.navigateByUrl(this.back());
    } catch (error) {
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id) return;
    try {
      await this.reminders.remove(id);
      await this.router.navigateByUrl(this.back());
    } catch (error) {
      this.confirmDelete.set(false);
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo borrar.');
    }
  }

  /** Plantilla o en blanco, con el primer vencimiento ya propuesto. */
  private fromTemplate(): FormValue {
    const template = reminderTemplate(this.template());
    if (!template) return { ...BLANK, due_date: addPeriod(todayIso(), 1, 'month') };
    const today = todayIso();
    const mode: RepeatMode = template.repeat_every
      ? template.repeat_anchor === 'due'
        ? 'fixed'
        : 'period'
      : template.repeat_km
        ? 'km'
        : 'once';
    const repeatKm = this.units.inputDistance(template.repeat_km);
    const calendar = template.emissions ? nextEmissionsDeadline(this.owner(), today) : null;
    return {
      ...BLANK,
      title: template.title,
      mode,
      every: template.repeat_every,
      unit: template.repeat_unit ?? 'month',
      repeat_km: repeatKm,
      due_date: template.repeat_every ? (calendar ?? addPeriod(today, template.repeat_every, template.repeat_unit!)) : '',
      due_km: mode === 'km' && this.odometer() !== null && repeatKm !== null ? this.odometer()! + repeatKm : null,
      notify_days: template.notify_days_before,
      notify_km: this.units.inputDistance(template.notify_km_before),
    };
  }

  private toForm(r: Reminder): FormValue {
    const mode: RepeatMode = r.repeat_every ? (r.repeat_anchor === 'due' ? 'fixed' : 'period') : r.repeat_km ? 'km' : 'once';
    return {
      title: r.title,
      mode,
      every: r.repeat_every,
      unit: r.repeat_unit ?? 'month',
      repeat_km: this.units.inputDistance(r.repeat_km),
      due_date: r.due_date ?? '',
      due_km: this.units.inputDistance(r.due_odometer_km),
      notify_days: r.notify_days_before,
      notify_km: this.units.inputDistance(r.notify_km_before),
      notes: r.notes ?? '',
      done_at: r.done_at ?? '',
      done_km: this.units.inputDistance(r.done_odometer_km),
    };
  }

  private toFields(f: FormValue, vehicleId: string): ReminderFields {
    const byDate = f.mode === 'period' || f.mode === 'fixed';
    const byKm = f.mode === 'km' || f.mode === 'period';
    return {
      vehicle_id: vehicleId,
      title: f.title,
      due_date: f.mode === 'km' ? null : f.due_date || null,
      due_odometer_km: f.mode === 'fixed' ? null : this.units.toOdometerKm(f.due_km),
      notify_days_before: f.notify_days ?? DEFAULT_NOTIFY_DAYS,
      notify_km_before: this.units.toOdometerKm(f.notify_km) ?? DEFAULT_NOTIFY_KM,
      repeat_every: byDate ? f.every : null,
      repeat_unit: byDate ? f.unit : null,
      repeat_km: byKm ? this.units.toOdometerKm(f.repeat_km) : null,
      repeat_anchor: f.mode === 'fixed' ? 'due' : 'done',
      notes: f.notes,
    };
  }
}
