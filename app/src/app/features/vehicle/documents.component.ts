import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { documentStatus, expiryLabel, isCurrent, type DocumentStatus } from '../../core/data/document-status';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleAlerts, worstTone } from '../../core/data/vehicle-alerts.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { db } from '../../core/db/piston-db';
import { EMPTY, formatLongDate, formatMoney, todayIso } from '../../core/format';
import type { DocumentType, VehicleDocument } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { IslandService } from '../../shared/island/island.service';
import { DocumentFilesComponent } from './document-files.component';
import { OTHER_DOCUMENT_TYPES, documentKind, type DocumentKind } from './document-kinds';
import { STATUS_BADGE, byExpiry } from './document-view';
import { emissionsPeriod, periodLabel } from './emissions-calendar';

interface DocumentView {
  readonly document: VehicleDocument;
  readonly title: string;
  readonly status: DocumentStatus;
  readonly expiry: string;
  readonly rows: readonly { label: string; value: string }[];
}

interface HistoryEntry {
  readonly document: VehicleDocument;
  readonly period: string;
  readonly cost: string | null;
}

interface DocumentGroup {
  readonly type: DocumentType;
  readonly kind: DocumentKind;
  readonly current: readonly DocumentView[];
  readonly history: readonly HistoryEntry[];
}

interface AddOption {
  readonly type: DocumentType;
  readonly kind: DocumentKind;
  readonly title: string;
  readonly sub: string;
}

/**
 * Los demás documentos del vehículo en gestión (verificación, tenencia,
 * tarjeta, licencia, garantía), agrupados por tipo. Cada grupo muestra los
 * vigentes con sus archivos y deja las vigencias renovadas como historial.
 * Mismo formulario, renovación y avisos que la póliza.
 */
@Component({
  selector: 'pst-documents',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DocumentFilesComponent, IconComponent, RouterLink],
  templateUrl: './documents.component.html',
  styleUrls: ['../capture/capture.scss', './vehicle-details.component.scss', './insurance.component.scss', './documents.component.scss'],
})
export class DocumentsComponent {
  private readonly island = inject(IslandService);
  private readonly store = inject(OfflineStore);
  private readonly context = inject(VehicleContext);
  private readonly alerts = inject(VehicleAlerts);

  protected readonly vehicle = this.context.vehicle;
  protected readonly name = this.context.displayName;
  protected readonly badge = STATUS_BADGE;

  private readonly documents = this.store.liveFrom(
    this.context.vehicleId,
    async (vehicleId) => {
      if (!vehicleId) return [];
      const rows = await db.documents.where('vehicle_id').equals(vehicleId).toArray();
      return rows.filter((row) => !row.deleted_at && row.type !== 'insurance');
    },
    [] as VehicleDocument[],
  );

  /** Periodo de verificación según engomado o placa. Nulo si no hay datos. */
  protected readonly emissions = computed(() => {
    const period = emissionsPeriod(this.vehicle());
    return period ? periodLabel(period) : null;
  });

  /** Solo los tipos con algo guardado, en el orden de `OTHER_DOCUMENT_TYPES`. */
  protected readonly groups = computed<DocumentGroup[]>(() => {
    const today = todayIso();
    const documents = this.documents();
    return OTHER_DOCUMENT_TYPES.map((type) => {
      const kind = documentKind(type);
      const ofType = documents.filter((row) => row.type === type).sort(byExpiry);
      return {
        type,
        kind,
        current: ofType.filter(isCurrent).map((document) => ({
          document,
          title: document.title ?? kind.label,
          status: documentStatus(document.expires_at, today),
          expiry: document.expires_at ? expiryLabel(document.expires_at, today) : 'Sin vencimiento',
          rows: [
            { label: kind.issuerLabel, value: document.issuer ?? EMPTY },
            { label: kind.referenceLabel, value: document.reference ?? EMPTY },
            { label: 'Inicio', value: formatLongDate(document.issued_at) },
            { label: 'Vencimiento', value: formatLongDate(document.expires_at) },
            { label: 'Costo', value: formatMoney(document.cost) },
          ],
        })),
        history: ofType
          .filter((row) => !isCurrent(row))
          .map((document) => ({
            document,
            period: `${formatLongDate(document.issued_at)} – ${formatLongDate(document.expires_at)}`,
            cost: document.cost === null ? null : formatMoney(document.cost),
          })),
      };
    }).filter((group) => group.current.length || group.history.length);
  });

  protected readonly addOptions = computed<AddOption[]>(() => {
    const groups = new Map(this.groups().map((group) => [group.type, group]));
    return OTHER_DOCUMENT_TYPES.map((type) => {
      const kind = documentKind(type);
      const has = !!groups.get(type)?.current.length;
      return {
        type,
        kind,
        title: has ? `Agregar ${kind.feminine ? 'otra' : 'otro'} ${kind.noun}` : kind.label,
        sub: type === 'emissions_check' && this.emissions() ? `Te toca en ${this.emissions()}` : has ? kind.label : 'Sin registrar',
      };
    });
  });

  constructor() {
    effect(() => {
      const alerts = this.alerts
        .forVehicle(this.context.vehicleId())
        .filter((alert) => alert.route === '/vehicle/documents');
      const tone = worstTone(alerts);
      const count = this.groups().reduce((sum, group) => sum + group.current.length, 0);
      this.island.present({
        icon: 'document',
        label: 'Documentos',
        value: alerts.length ? `${alerts.length} aviso${alerts.length === 1 ? '' : 's'}` : String(count),
        tone: tone ?? (count ? 'good' : 'idle'),
        title: this.name(),
        subtitle: alerts.length
          ? 'Hay documentos por vencer o vencidos'
          : count
            ? 'Todo vigente'
            : 'Sin documentos registrados',
        details: alerts.slice(0, 3).map((alert) => ({ label: alert.title, value: alert.detail })),
      });
    });
  }
}
