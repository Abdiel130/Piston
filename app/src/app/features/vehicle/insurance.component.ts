import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { daysUntil, documentStatus, expiryLabel, isCurrent, type DocumentStatus } from '../../core/data/document-status';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { EMPTY, formatLongDate, formatMoney, todayIso } from '../../core/format';
import type { VehicleDocument } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { DocumentFilesComponent } from './document-files.component';
import { STATUS_BADGE, byExpiry } from './document-view';

interface PolicyView {
  readonly document: VehicleDocument;
  readonly status: DocumentStatus;
  readonly expiry: string;
  /** Lo que piden al reportar: "Póliza 123 · Asegurado A-42". */
  readonly claimIds: string | null;
  readonly rows: readonly { label: string; value: string }[];
}

interface TimelineEntry {
  readonly document: VehicleDocument;
  readonly current: boolean;
  readonly event: 'Alta' | 'Renovación';
  readonly period: string;
  readonly summary: string;
  readonly cost: string | null;
  /** Contra la vigencia anterior: "+$800 (8 %) · Cambió de Qualitas a Chubb". */
  readonly change: string | null;
}

/**
 * Póliza de seguro del vehículo en gestión: la vigente a la mano (teléfonos
 * que se marcan con un toque, el PDF sin conexión) y las anteriores como
 * historial. Si hay más de una vigente (una cobertura extra) se muestran
 * todas, y cada una avisa por su cuenta.
 */
@Component({
  selector: 'pst-insurance',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DocumentFilesComponent, IconComponent, RouterLink],
  templateUrl: './insurance.component.html',
  styleUrls: ['../capture/capture.scss', './vehicle-details.component.scss', './insurance.component.scss'],
})
export class InsuranceComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  protected readonly badge = STATUS_BADGE;

  private readonly policies = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId) => {
      if (!vehicleId) return [];
      const rows = await db.documents.where('[vehicle_id+type]').equals([vehicleId, 'insurance']).toArray();
      return rows.filter((row) => !row.deleted_at);
    },
    [] as VehicleDocument[],
  );

  protected readonly current = computed<PolicyView[]>(() => {
    const today = todayIso();
    return this.policies()
      .filter(isCurrent)
      .sort(byExpiry)
      .map((document) => ({
        document,
        status: documentStatus(document.expires_at, today),
        expiry: document.expires_at ? expiryLabel(document.expires_at, today) : 'Sin vencimiento',
        claimIds:
          [
            document.reference && `Póliza ${document.reference}`,
            document.policy_item && `Inciso ${document.policy_item}`,
            document.insured_number && `Asegurado ${document.insured_number}`,
          ]
            .filter(Boolean)
            .join(' · ') || null,
        rows: [
          { label: 'Aseguradora', value: document.issuer ?? EMPTY },
          { label: 'Número de póliza', value: document.reference ?? EMPTY },
          ...(document.policy_item ? [{ label: 'Inciso', value: document.policy_item }] : []),
          // Opcional: solo algunas aseguradoras lo dan. Sin dato, no ocupa fila.
          ...(document.insured_number ? [{ label: 'Número de asegurado', value: document.insured_number }] : []),
          { label: 'Cobertura', value: document.coverage ?? EMPTY },
          { label: 'Inicio', value: formatLongDate(document.issued_at) },
          { label: 'Vencimiento', value: formatLongDate(document.expires_at) },
          { label: 'Costo', value: formatMoney(document.cost) },
        ],
      }));
  });

  /**
   * Línea de tiempo de todas las vigencias, la más reciente arriba. Cada
   * renovación muestra qué cambió contra la que reemplazó (costo, aseguradora).
   * Solo aparece cuando ya hubo al menos una renovación.
   */
  protected readonly timeline = computed<TimelineEntry[]>(() => {
    const policies = this.policies();
    if (!policies.some((row) => row.renewed_by_id)) return [];
    const byReplacement = new Map(policies.filter((row) => row.renewed_by_id).map((row) => [row.renewed_by_id!, row]));
    return [...policies].sort(byExpiry).map((document) => {
      const previous = byReplacement.get(document.id) ?? null;
      return {
        document,
        current: isCurrent(document),
        event: previous ? 'Renovación' : 'Alta',
        period: `${formatLongDate(document.issued_at)} – ${formatLongDate(document.expires_at)}`,
        summary: [document.issuer, document.reference && `Póliza ${document.reference}`, document.coverage]
          .filter(Boolean)
          .join(' · '),
        cost: document.cost === null ? null : formatMoney(document.cost),
        change: previous ? describeChange(previous, document) : null,
      };
    });
  });

  constructor() {
    effect(() => {
      const [first] = this.current();
      const days = first?.document.expires_at ? daysUntil(first.document.expires_at, todayIso()) : null;
      this.island.present({
        icon: 'shield',
        label: 'Póliza',
        value: days === null ? EMPTY : days < 0 ? 'Vencida' : `${days} d`,
        tone: !first ? 'idle' : first.status === 'expired' ? 'bad' : first.status === 'expiring' ? 'warn' : 'good',
        title: this.name(),
        subtitle: first ? first.expiry : 'Sin póliza registrada',
        details: first
          ? [
              { label: 'Aseguradora', value: first.document.issuer ?? EMPTY },
              { label: 'Vence', value: formatLongDate(first.document.expires_at) },
            ]
          : [],
      });
    });
  }

  protected tel(phone: string): string {
    return `tel:${phone.replace(/[^0-9+]/g, '')}`;
  }
}

function describeChange(previous: VehicleDocument, next: VehicleDocument): string | null {
  const parts: string[] = [];
  if (previous.cost !== null && next.cost !== null && previous.cost !== next.cost) {
    const delta = next.cost - previous.cost;
    const percent = previous.cost > 0 ? ` (${Math.round((delta / previous.cost) * 100)} %)` : '';
    parts.push(`${delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta))}${percent}`);
  }
  if (previous.issuer && next.issuer && previous.issuer !== next.issuer) {
    parts.push(`Cambió de ${previous.issuer} a ${next.issuer}`);
  }
  if (previous.coverage && next.coverage && previous.coverage !== next.coverage) {
    parts.push(`Cobertura ${next.coverage}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
