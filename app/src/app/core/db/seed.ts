import { inject, Injectable } from '@angular/core';
import { OfflineStore } from '../data/offline-store.service';
import { db } from './piston-db';
import { GLOBAL_CURSOR, type ExpenseCategory, type ServiceCategory, type ServiceType } from '../models';

interface SeedServiceType {
  readonly name: string;
  readonly category: ServiceCategory;
  readonly icon: string;
  readonly km: number | null;
  readonly months: number | null;
}

/** Catálogo base de mantenimiento, con los intervalos típicos de un auto. */
const SERVICE_TYPES: readonly SeedServiceType[] = [
  { name: 'Cambio de aceite y filtro', category: 'oil_filters', icon: 'droplet', km: 10_000, months: 12 },
  { name: 'Filtro de aire de motor', category: 'oil_filters', icon: 'droplet', km: 20_000, months: 24 },
  { name: 'Filtro de cabina', category: 'oil_filters', icon: 'droplet', km: 20_000, months: 12 },
  { name: 'Filtro de gasolina', category: 'oil_filters', icon: 'fuel', km: 40_000, months: null },
  { name: 'Balatas delanteras', category: 'brakes', icon: 'wrench', km: 40_000, months: null },
  { name: 'Balatas traseras', category: 'brakes', icon: 'wrench', km: 60_000, months: null },
  { name: 'Líquido de frenos', category: 'brakes', icon: 'droplet', km: null, months: 24 },
  { name: 'Rotación de llantas', category: 'tires', icon: 'tire', km: 10_000, months: null },
  { name: 'Alineación y balanceo', category: 'tires', icon: 'tire', km: 20_000, months: 12 },
  { name: 'Cambio de llantas', category: 'tires', icon: 'tire', km: 60_000, months: 60 },
  { name: 'Bujías', category: 'engine', icon: 'spark', km: 40_000, months: null },
  { name: 'Banda de accesorios', category: 'engine', icon: 'wrench', km: 80_000, months: null },
  { name: 'Banda de distribución', category: 'engine', icon: 'wrench', km: 100_000, months: null },
  { name: 'Anticongelante', category: 'engine', icon: 'droplet', km: 50_000, months: 36 },
  { name: 'Afinación mayor', category: 'engine', icon: 'wrench', km: 40_000, months: 24 },
  { name: 'Aceite de transmisión', category: 'transmission', icon: 'droplet', km: 60_000, months: null },
  { name: 'Batería', category: 'electrical', icon: 'spark', km: null, months: 36 },
  { name: 'Amortiguadores', category: 'suspension', icon: 'wrench', km: 80_000, months: null },
  { name: 'Limpiaparabrisas', category: 'body', icon: 'wrench', km: null, months: 12 },
  { name: 'Revisión general', category: 'general', icon: 'wrench', km: 20_000, months: 12 },
];

/** Categorías de gasto que NO son combustible ni servicio (esos tienen tabla propia). */
const EXPENSE_CATEGORIES: readonly { name: string; icon: string }[] = [
  { name: 'Tenencia', icon: 'receipt' },
  { name: 'Verificación', icon: 'shield' },
  { name: 'Seguro', icon: 'shield' },
  { name: 'Lavado', icon: 'droplet' },
  { name: 'Estacionamiento', icon: 'mapPin' },
  { name: 'Casetas', icon: 'road' },
  { name: 'Multas', icon: 'alert' },
  { name: 'Accesorios', icon: 'car' },
];

/**
 * Siembra los catálogos del sistema la primera vez que arranca la app.
 *
 * Se siembra en el CLIENTE, no con un seeder de Laravel, porque la app tiene
 * que ser usable desde el primer segundo sin haber hablado nunca con el
 * servidor. Las filas nacen con su UUIDv7 y su entrada en el outbox, así que
 * viajan hacia arriba como cualquier otro dato del usuario.
 *
 * La condición de "primera vez" es doble —tabla vacía Y cursor de sync en 0—
 * para no volver a sembrar en un dispositivo que sí tiene servidor y todavía
 * no ha terminado su primer pull.
 */
@Injectable({ providedIn: 'root' })
export class CatalogSeeder {
  private readonly store = inject(OfflineStore);

  async seedIfEmpty(): Promise<void> {
    const cursor = await db.sync_state.get(GLOBAL_CURSOR);
    if (cursor && cursor.last_rev > 0) {
      return;
    }

    if ((await db.service_types.count()) === 0) {
      for (const type of SERVICE_TYPES) {
        await this.store.create<ServiceType>('service_types', {
          user_id: null,
          name: type.name,
          category: type.category,
          applies_to: null,
          default_interval_km: type.km,
          default_interval_months: type.months,
          icon: type.icon,
          is_system: true,
        });
      }
    }

    if ((await db.expense_categories.count()) === 0) {
      for (const category of EXPENSE_CATEGORIES) {
        await this.store.create<ExpenseCategory>('expense_categories', {
          user_id: null,
          name: category.name,
          icon: category.icon,
          is_system: true,
        });
      }
    }
  }
}
