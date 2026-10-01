import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { EMPTY, formatLongDate, formatMoney, formatMonth, monthStartIso, todayIso } from '../../core/format';
import type { Expense, ExpenseCategory, FuelEntry, RecurringExpense, ServiceRecord, VehicleDocument } from '../../core/models';
import { IconComponent, type IconName, isIconName } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';

interface Category {
  readonly key: string;
  readonly icon: IconName;
  readonly name: string;
  readonly total: number;
  readonly color: string;
}

interface ExpenseData {
  readonly expenses: Expense[];
  readonly fuel: FuelEntry[];
  readonly services: ServiceRecord[];
  readonly categories: Map<string, ExpenseCategory>;
  readonly recurring: RecurringExpense[];
  readonly documents: VehicleDocument[];
}

const EMPTY_DATA: ExpenseData = {
  expenses: [],
  fuel: [],
  services: [],
  categories: new Map(),
  recurring: [],
  documents: [],
};

const PALETTE = ['var(--pst-ignition)', 'var(--pst-info)', 'var(--pst-good)', 'var(--pst-warn)', 'var(--pst-bad)', 'var(--pst-idle)'];

const DOCUMENT_LABEL: Record<VehicleDocument['type'], string> = {
  insurance: 'Seguro',
  emissions_check: 'Verificación',
  ownership_tax: 'Tenencia',
  circulation_card: 'Tarjeta de circulación',
  driver_license: 'Licencia',
  warranty: 'Garantía',
  other: 'Documento',
};

/**
 * Gastos del mes del vehículo activo: gastos capturados más lo pagado en
 * cargas y servicios. Son sumas de lo guardado, nada estimado.
 */
@Component({
  selector: 'pst-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './expenses.component.html',
  styleUrl: './expenses.component.scss',
})
export class ExpensesComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly auth = inject(AuthService);

  protected readonly month = formatMonth(new Date());
  private readonly currency = computed(() => this.auth.user()?.currency ?? 'MXN');

  private readonly data = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId): Promise<ExpenseData> => {
      if (!vehicleId) return EMPTY_DATA;
      const alive = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((row) => !row.deleted_at);
      const [expenses, fuel, services, categories, recurring, documents] = await Promise.all([
        db.expenses.where('vehicle_id').equals(vehicleId).toArray(),
        db.fuel_entries.where('vehicle_id').equals(vehicleId).toArray(),
        db.service_records.where('vehicle_id').equals(vehicleId).toArray(),
        db.expense_categories.toArray(),
        db.recurring_expenses.where('vehicle_id').equals(vehicleId).toArray(),
        db.documents.where('vehicle_id').equals(vehicleId).toArray(),
      ]);
      return {
        expenses: alive(expenses),
        fuel: alive(fuel),
        services: alive(services),
        categories: new Map(categories.map((category) => [category.id, category])),
        recurring: alive(recurring).filter((item) => item.is_active),
        documents: alive(documents),
      };
    },
    EMPTY_DATA,
  );

  protected readonly categories = computed<Category[]>(() => {
    const start = monthStartIso();
    const data = this.data();
    const totals = new Map<string, Omit<Category, 'color'>>();
    const add = (key: string, name: string, icon: IconName, amount: number) => {
      const current = totals.get(key);
      totals.set(key, { key, name, icon, total: (current?.total ?? 0) + amount });
    };

    for (const entry of data.fuel) {
      if (entry.filled_at.slice(0, 10) >= start && entry.amount_paid) add('fuel', 'Combustible', 'fuel', entry.amount_paid);
    }
    for (const record of data.services) {
      if (record.performed_at >= start && record.total_cost) add('service', 'Servicios', 'wrench', record.total_cost);
    }
    for (const expense of data.expenses) {
      if (expense.spent_at < start) continue;
      const category = data.categories.get(expense.category_id);
      const icon = category?.icon && isIconName(category.icon) ? category.icon : 'receipt';
      add(expense.category_id, category?.name ?? 'Otros', icon, expense.amount);
    }

    return [...totals.values()]
      .sort((a, b) => b.total - a.total)
      .map((category, i) => ({ ...category, color: PALETTE[i % PALETTE.length] }));
  });

  protected readonly total = computed(() => this.categories().reduce((sum, category) => sum + category.total, 0));
  protected readonly totalLabel = computed(() => (this.categories().length ? this.money(this.total()) : EMPTY));

  protected readonly upcoming = computed(() => {
    const today = todayIso();
    const data = this.data();
    return [
      ...data.recurring
        .filter((item) => item.next_due_date >= today)
        .map((item) => ({
          id: item.id,
          name: item.name,
          when: `Vence el ${formatLongDate(item.next_due_date)}`,
          date: item.next_due_date,
          amount: item.amount_estimate !== null ? this.money(item.amount_estimate) : EMPTY,
        })),
      ...data.documents
        .filter((doc) => doc.expires_at !== null && doc.expires_at >= today)
        .map((doc) => ({
          id: doc.id,
          name: doc.title ?? DOCUMENT_LABEL[doc.type],
          when: `Vence el ${formatLongDate(doc.expires_at)}`,
          date: doc.expires_at!,
          amount: doc.cost !== null ? this.money(doc.cost) : EMPTY,
        })),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  });

  constructor() {
    effect(() => {
      const [first, second] = this.categories();
      this.island.present({
        icon: 'receipt',
        label: this.month.split(' ')[0],
        value: this.totalLabel(),
        tone: 'info',
        title: 'Gasto del mes',
        subtitle: this.categories().length ? 'Gastos, cargas y servicios de este mes' : 'Sin gastos este mes',
        details: [
          { label: first?.name ?? 'Mayor gasto', value: first ? this.money(first.total) : EMPTY },
          { label: second?.name ?? 'Segundo', value: second ? this.money(second.total) : EMPTY },
          { label: 'Próximos', value: String(this.upcoming().length) },
        ],
      });
    });
  }

  protected share(category: Category): number {
    return this.total() > 0 ? (category.total / this.total()) * 100 : 0;
  }

  protected money(value: number): string {
    return formatMoney(value, this.currency());
  }
}
