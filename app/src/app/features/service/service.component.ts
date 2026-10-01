import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { EMPTY, formatShortDate } from '../../core/format';
import { UnitsService } from '../../core/units.service';
import type {
  Issue,
  IssueSeverity,
  MaintenanceSchedule,
  ServiceRecord,
  ServiceRecordItem,
  ServiceType,
} from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { SCHEDULE_TONE, scheduleDue } from './schedule-display';

const SEVERITY: Record<IssueSeverity, { tone: string; label: string }> = {
  low: { tone: 'good', label: 'Baja' },
  medium: { tone: 'warn', label: 'Media' },
  high: { tone: 'bad', label: 'Alta' },
  critical: { tone: 'bad', label: 'Crítica' },
};

interface ServiceData {
  readonly schedules: MaintenanceSchedule[];
  readonly issues: Issue[];
  readonly records: ServiceRecord[];
  readonly items: ServiceRecordItem[];
  readonly types: Map<string, ServiceType>;
}

const EMPTY_DATA: ServiceData = { schedules: [], issues: [], records: [], items: [], types: new Map() };

/** Mantenimiento del vehículo activo: plan, fallas en seguimiento e historial reales. */
@Component({
  selector: 'pst-service',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  templateUrl: './service.component.html',
  styleUrl: './service.component.scss',
})
export class ServiceComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly units = inject(UnitsService);
  private readonly distance = (km: number) => this.units.formatDistance(km);

  private readonly data = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId): Promise<ServiceData> => {
      if (!vehicleId) return EMPTY_DATA;
      const [schedules, issues, records, types] = await Promise.all([
        db.maintenance_schedules.where('vehicle_id').equals(vehicleId).toArray(),
        db.issues.where('vehicle_id').equals(vehicleId).toArray(),
        db.service_records.where('vehicle_id').equals(vehicleId).toArray(),
        db.service_types.toArray(),
      ]);
      const liveRecords = records.filter((record) => !record.deleted_at);
      const items = await db.service_record_items
        .where('service_record_id')
        .anyOf(liveRecords.map((record) => record.id))
        .toArray();
      return {
        schedules: schedules.filter((schedule) => !schedule.deleted_at && schedule.is_active),
        issues: issues
          .filter((issue) => !issue.deleted_at && (issue.status === 'open' || issue.status === 'monitoring'))
          .sort((a, b) => b.noticed_at.localeCompare(a.noticed_at)),
        records: liveRecords.sort((a, b) => b.performed_at.localeCompare(a.performed_at)),
        items: items.filter((item) => !item.deleted_at),
        types: new Map(types.map((type) => [type.id, type])),
      };
    },
    EMPTY_DATA,
  );

  protected readonly triage = computed(() => {
    const count = (status: MaintenanceSchedule['status']) =>
      this.data().schedules.filter((schedule) => schedule.status === status).length;
    return { urgent: count('urgent'), warning: count('warning'), optimal: count('optimal') };
  });

  protected readonly schedules = computed(() =>
    this.data().schedules.map((schedule) => ({
      id: schedule.id,
      name: this.data().types.get(schedule.service_type_id)?.name ?? 'Servicio',
      due: scheduleDue(schedule, this.distance),
      ...SCHEDULE_TONE[schedule.status],
    })),
  );

  protected readonly issues = computed(() =>
    this.data().issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      noticed: [
        `Detectado el ${formatShortDate(issue.noticed_at)}`,
        issue.noticed_odometer_km !== null ? this.distance(issue.noticed_odometer_km) : null,
      ]
        .filter(Boolean)
        .join(' · '),
      ...SEVERITY[issue.severity],
    })),
  );

  protected readonly history = computed(() => {
    const itemsByRecord = new Map<string, string[]>();
    for (const item of this.data().items) {
      const name = item.description ?? this.data().types.get(item.service_type_id)?.name;
      if (!name) continue;
      itemsByRecord.set(item.service_record_id, [...(itemsByRecord.get(item.service_record_id) ?? []), name]);
    }
    return this.data().records.map((record) => ({
      id: record.id,
      name: itemsByRecord.get(record.id)?.join(', ') || 'Servicio',
      sub: [record.is_diy ? 'Hecho por mí' : record.shop_name, formatShortDate(record.performed_at), this.distance(record.odometer_km)]
        .filter(Boolean)
        .join(' · '),
      cost: record.total_cost ? this.units.formatMoney(record.total_cost, record.currency) : EMPTY,
    }));
  });

  constructor() {
    effect(() => {
      const next = this.data().schedules.find((schedule) => schedule.status === 'urgent')
        ?? this.data().schedules.find((schedule) => schedule.status === 'warning');
      const triage = this.triage();
      this.island.present({
        icon: next ? 'alert' : 'wrench',
        label: next ? 'Próximo servicio' : 'Mantenimiento',
        value: String(triage.urgent + triage.warning),
        tone: triage.urgent > 0 ? 'bad' : triage.warning > 0 ? 'warn' : 'good',
        title: next ? (this.data().types.get(next.service_type_id)?.name ?? 'Servicio') : 'Sin pendientes',
        subtitle: next ? scheduleDue(next, this.distance) : 'Nada vencido ni por vencer',
        details: [
          { label: 'Vencidos', value: String(triage.urgent) },
          { label: 'Próximos', value: String(triage.warning) },
          { label: 'Al día', value: String(triage.optimal) },
        ],
        pulsing: triage.urgent > 0,
      });
    });
  }
}
