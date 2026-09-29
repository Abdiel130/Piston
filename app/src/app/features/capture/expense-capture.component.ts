import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { todayIso } from '../../core/format';
import type { Expense, ExpenseCategory } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { LIMITS, blankToNull, readNumber, readText, type Errors } from './capture-form';

type Field = 'spent_at' | 'category_id' | 'amount' | 'odometer_km';

/** Captura de un gasto que no es combustible ni servicio (esos tienen su propia captura). */
@Component({
  selector: 'pst-expense-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './expense-capture.component.html',
  styleUrl: './capture.scss',
})
export class ExpenseCaptureComponent {
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;

  protected readonly categories = this.store.liveSignal(
    async () =>
      (await db.expense_categories.toArray())
        .filter((category) => !category.deleted_at)
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [] as ExpenseCategory[],
  );

  protected readonly spentAt = signal(todayIso());
  protected readonly category = signal<string | null>(null);
  protected readonly amount = signal<number | null>(null);
  protected readonly description = signal('');
  protected readonly odometer = signal<number | null>(null);
  protected readonly notes = signal('');

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly errors = computed<Errors<Field>>(() => {
    const errors: Errors<Field> = {};
    const amount = this.amount();
    const km = this.odometer();
    if (!this.spentAt()) errors.spent_at = 'Indica la fecha.';
    if (!this.category()) errors.category_id = 'Elige una categoría.';
    if (amount === null) errors.amount = 'Anota el monto.';
    else if (amount <= 0 || amount > LIMITS.money10) errors.amount = 'Monto fuera de rango.';
    if (km !== null && (!Number.isInteger(km) || km < 0 || km > LIMITS.km)) errors.odometer_km = 'Debe ser un número entero de km.';
    return errors;
  });

  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);
  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const vehicle = this.vehicle();
    if (!vehicle || !this.valid() || this.saving()) return;

    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.store.create<Expense>('expenses', {
        user_id: null,
        vehicle_id: vehicle.id,
        category_id: this.category()!,
        recurring_expense_id: null,
        spent_at: this.spentAt(),
        odometer_km: this.odometer(),
        amount: this.amount()!,
        currency: this.auth.user()?.currency ?? 'MXN',
        description: blankToNull(this.description()),
        notes: blankToNull(this.notes()),
      });
      await this.router.navigateByUrl('/expenses');
    } catch (error) {
      this.saveError.set(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.saving.set(false);
    }
  }
}
