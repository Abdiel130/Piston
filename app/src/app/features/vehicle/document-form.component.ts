import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AttachmentService, type AttachmentCaption, type PreparedFile } from '../../core/data/attachment.service';
import { addMonths } from '../../core/data/document-status';
import { DocumentService, type DocumentFields } from '../../core/data/document.service';
import { OfflineStore } from '../../core/data/offline-store.service';
import { VehicleContext } from '../../core/data/vehicle-context.service';
import { AttachmentDownloads } from '../../core/sync/attachment-downloads.service';
import { formatLongDate, todayIso } from '../../core/format';
import type { Attachment, DocumentType, VehicleDocument } from '../../core/models';
import { IconComponent } from '../../shared/icon/icon.component';
import { LIMITS, readNumber, readText, type Errors } from '../capture/capture-form';
import { DocumentFilesComponent } from './document-files.component';
import { documentKind } from './document-kinds';
import { emissionsPeriod, nextEmissionsDeadline, periodLabel } from './emissions-calendar';

interface FormValue {
  title: string;
  issuer: string;
  reference: string;
  coverage: string;
  issued_at: string;
  expires_at: string;
  cost: number | null;
  contact_phone: string;
  assistance_phone: string;
  insured_number: string;
  policy_item: string;
  notes: string;
  notify_enabled: boolean;
}

type Field = keyof FormValue;

interface PendingFile {
  readonly id: number;
  readonly prepared: PreparedFile;
  readonly url: string | null;
  readonly title: string;
  readonly notes: string;
}

interface EmissionsHint {
  /** "enero–febrero y julio–agosto (engomado amarillo)". Nulo sin engomado ni placa. */
  readonly label: string | null;
  readonly suggested: string | null;
  readonly suggestedLabel: string | null;
}

const BLANK: FormValue = {
  title: '',
  issuer: '',
  reference: '',
  coverage: '',
  issued_at: '',
  expires_at: '',
  cost: null,
  contact_phone: '',
  assistance_phone: '',
  insured_number: '',
  policy_item: '',
  notes: '',
  notify_enabled: true,
};

const PHONE = /^[0-9+()\-.\s]*$/;

/**
 * Alta, edición y renovación de un documento del vehículo.
 *
 * Es uno solo para todos los tipos: el tipo llega por los datos de la ruta
 * (póliza) o el query param `type` (documentos); al editar sin él, se toma
 * del documento guardado. `documentKind` decide etiquetas y campos. Con `id` edita; con `renew` crea
 * el reemplazo de ese documento, prellenado con lo que no cambia de un año a
 * otro (aseguradora, número, teléfonos).
 */
@Component({
  selector: 'pst-document-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DocumentFilesComponent, IconComponent, RouterLink],
  templateUrl: './document-form.component.html',
  styleUrls: ['../capture/capture.scss', '../vehicles/vehicle-form.component.scss', './document-files.scss', './document-form.component.scss'],
})
export class DocumentFormComponent {
  private readonly store = inject(OfflineStore);
  private readonly documents = inject(DocumentService);
  private readonly attachments = inject(AttachmentService);
  private readonly context = inject(VehicleContext);
  private readonly downloads = inject(AttachmentDownloads);
  private readonly router = inject(Router);

  /** Datos de ruta o query param. */
  readonly type = input<DocumentType>();
  readonly back = input.required<string>();
  readonly backLabel = input.required<string>();
  /** Parámetro de ruta: el documento a editar. */
  readonly id = input<string>();
  /** Query param: el documento que se está renovando. */
  readonly renew = input<string>();

  protected readonly editing = computed(() => !!this.id());
  protected readonly renewing = computed(() => !this.editing() && !!this.renew());

  /** El documento editado, o el que se renueva. En vivo por el sync. */
  protected readonly saved = this.store.liveFrom(
    computed(() => this.id() ?? this.renew() ?? null),
    async (id) => (id ? ((await this.store.get<VehicleDocument>('documents', id)) ?? null) : null),
    undefined as VehicleDocument | null | undefined,
  );
  /** Sin tipo en la ruta (edición desde Documentos), manda el guardado. */
  protected readonly docType = computed<DocumentType>(() => this.type() ?? this.saved()?.type ?? 'other');
  protected readonly kind = computed(() => documentKind(this.docType()));
  protected readonly missing = computed(() => (this.editing() || this.renewing()) && this.saved() === null);
  protected readonly alreadyRenewed = computed(() => this.renewing() && !!this.saved()?.renewed_by_id);

  protected readonly form = signal<FormValue>({ ...BLANK });
  private readonly hydrated = signal(false);

  protected readonly files = signal<readonly PendingFile[]>([]);
  protected readonly removed = signal<readonly Attachment[]>([]);
  protected readonly captions = signal<Readonly<Record<string, AttachmentCaption>>>({});

  /** Al renovar: los archivos de la anterior y cuáles pasan a la nueva. */
  protected readonly previousFiles = this.store.liveFrom(
    this.renew,
    async (id) => (id ? this.attachments.listFor('document', id) : []),
    [] as Attachment[],
  );
  protected readonly keep = signal<ReadonlySet<string>>(new Set());
  private keepChosen = false;
  protected readonly preparing = signal(0);
  protected readonly fileError = signal<string | null>(null);
  private nextFileId = 0;

  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);

  protected readonly readText = readText;
  protected readonly readNumber = readNumber;

  protected readonly title = computed(() => {
    const { noun, feminine } = this.kind();
    if (this.editing()) return `Editar ${noun}`;
    if (this.renewing()) return `Renovar ${noun}`;
    return `${feminine ? 'Nueva' : 'Nuevo'} ${noun}`;
  });

  protected readonly errors = computed<Errors<Field>>(() => {
    const f = this.form();
    const e: Errors<Field> = {};
    const tooLong = (key: Field, max: number) => {
      if ((f[key] as string).trim().length > max) e[key] = `Máximo ${max} caracteres.`;
    };
    tooLong('title', 160);
    tooLong('issuer', 120);
    tooLong('reference', 80);
    tooLong('coverage', 120);
    tooLong('insured_number', 80);
    tooLong('policy_item', 20);
    for (const key of ['contact_phone', 'assistance_phone'] as const) {
      if (!PHONE.test(f[key])) e[key] = 'Solo números, espacios y + ( ) -';
      else tooLong(key, 30);
    }
    if (this.kind().expiresRequired && !f.expires_at) e.expires_at = 'Indica cuándo vence.';
    if (f.issued_at && f.expires_at && f.expires_at < f.issued_at) e.expires_at = 'Vence antes de empezar.';
    if (f.cost !== null && (f.cost < 0 || f.cost > LIMITS.money10)) e.cost = 'Fuera de rango.';
    return e;
  });

  protected readonly valid = computed(() => Object.keys(this.errors()).length === 0);

  /** Verificación: el vehículo del documento, para su calendario. */
  private readonly owner = computed(() => {
    const vehicleId = this.saved()?.vehicle_id ?? this.context.vehicleId();
    return this.context.vehicles().find((vehicle) => vehicle.id === vehicleId) ?? null;
  });

  /** Periodo y vencimiento que propone el calendario. Nulo fuera de verificación o sin datos. */
  protected readonly emissions = computed<EmissionsHint | null>(() => {
    if (this.docType() !== 'emissions_check') return null;
    const period = emissionsPeriod(this.owner());
    if (!period) return { label: null, suggested: null, suggestedLabel: null };
    const suggested = nextEmissionsDeadline(this.owner(), this.form().issued_at || todayIso());
    return { label: periodLabel(period), suggested, suggestedLabel: suggested && formatLongDate(suggested) };
  });
  private emissionsPrefilled = false;

  constructor() {
    // Se hidrata UNA vez: después el formulario es del usuario.
    effect(() => {
      const source = this.saved();
      if (untracked(this.hydrated)) return;
      if (!this.editing() && !this.renewing()) {
        untracked(() => this.hydrated.set(true));
        return;
      }
      if (source) {
        untracked(() => {
          this.form.set(this.editing() ? toForm(source) : this.renewalOf(source));
          this.hydrated.set(true);
        });
      }
    });
    // Por defecto se conservan las imágenes (guías, tarjeta del seguro) y no
    // los PDF: la póliza del año pasado no sirve en la nueva.
    effect(() => {
      const previous = this.previousFiles();
      if (this.keepChosen || !previous.length) return;
      this.keepChosen = true;
      untracked(() =>
        this.keep.set(new Set(previous.filter((file) => file.mime_type?.startsWith('image/')).map((file) => file.id))),
      );
    });
    // Alta de verificación: el vencimiento arranca con el que da el calendario.
    effect(() => {
      const suggested = this.emissions()?.suggested;
      if (this.emissionsPrefilled || !suggested || !this.hydrated() || this.editing() || this.renewing()) return;
      this.emissionsPrefilled = true;
      untracked(() => {
        if (!this.form().expires_at) this.set('expires_at', suggested);
      });
    });
    inject(DestroyRef).onDestroy(() => this.files().forEach((file) => file.url && URL.revokeObjectURL(file.url)));
  }

  protected set<K extends Field>(key: K, value: FormValue[K]): void {
    this.form.update((form) => ({ ...form, [key]: value }));
  }

  protected async pickFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = '';
    this.fileError.set(null);

    const tooBig = picked.filter((file) => file.size > LIMITS.attachmentBytes);
    if (tooBig.length) {
      this.fileError.set(`${tooBig.map((file) => file.name).join(', ')}: pesa más de ${LIMITS.attachmentBytes / 1024 / 1024} MB.`);
    }

    for (const file of picked.filter((file) => file.size <= LIMITS.attachmentBytes)) {
      this.preparing.update((count) => count + 1);
      try {
        const prepared = await this.attachments.prepare(file);
        const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
        this.files.update((files) => [...files, { id: this.nextFileId++, prepared, url, title: '', notes: '' }]);
      } catch {
        this.fileError.set(`No se pudo leer ${file.name}.`);
      } finally {
        this.preparing.update((count) => count - 1);
      }
    }
  }

  protected captionFile(id: number, key: 'title' | 'notes', event: Event): void {
    const value = readText(event);
    this.files.update((files) => files.map((file) => (file.id === id ? { ...file, [key]: value } : file)));
  }

  protected toggleKeep(id: string): void {
    this.keep.update((keep) => {
      const next = new Set(keep);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected removeFile(id: number): void {
    const file = this.files().find((candidate) => candidate.id === id);
    if (file?.url) URL.revokeObjectURL(file.url);
    this.files.update((files) => files.filter((candidate) => candidate.id !== id));
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const vehicleId = this.saved()?.vehicle_id ?? this.context.vehicleId();
    if (!vehicleId || !this.valid() || this.saving() || this.preparing() > 0) return;

    this.saving.set(true);
    this.saveError.set(null);
    const fields = this.toFields(this.form(), vehicleId);
    const files = this.files().map(({ prepared, title, notes }) => ({ prepared, title, notes }));
    try {
      const id = this.id();
      const renew = this.renew();
      if (id) {
        await this.documents.update(id, fields, { added: files, removed: this.removed(), captions: this.captions() });
      } else if (renew) {
        await this.documents.renew(renew, fields, [...(await this.keptFiles()), ...files]);
        // La anterior ya es historial: sus archivos dejan el dispositivo si ya
        // subieron (si no, el siguiente sync lo hace).
        void this.downloads.evictHistory().catch(() => undefined);
      } else {
        await this.documents.create(fields, files);
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
      await this.documents.remove(id);
      await this.router.navigateByUrl(this.back());
    } catch (error) {
      this.confirmDelete.set(false);
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo borrar.');
    }
  }

  /**
   * Copia de los archivos conservados como adjuntos nuevos de la renovada.
   * Si el binario ya no está aquí, se trae del servidor: necesita conexión.
   */
  private async keptFiles(): Promise<{ prepared: PreparedFile; title: string | null; notes: string | null }[]> {
    const kept = this.previousFiles().filter((file) => this.keep().has(file.id));
    const copies = [];
    for (const attachment of kept) {
      let blob: Blob;
      try {
        blob = await this.downloads.blob(attachment);
      } catch {
        throw new Error(`No se pudo traer «${attachment.title ?? attachment.file_name}» para conservarlo. Revisa la conexión o desmárcalo.`);
      }
      const file = new File([blob], attachment.file_name, { type: attachment.mime_type ?? blob.type });
      copies.push({ prepared: await this.attachments.prepare(file), title: attachment.title, notes: attachment.notes });
    }
    return copies;
  }

  /** Lo que se repite al renovar; la vigencia nueva arranca donde terminó la anterior. */
  private renewalOf(previous: VehicleDocument): FormValue {
    const start = previous.expires_at ?? '';
    return {
      ...toForm(previous),
      issued_at: start,
      expires_at: start ? this.renewedExpiry(start) : '',
      cost: null,
      notes: '',
    };
  }

  /** Verificación sigue su calendario; el resto suma los meses de su tipo. */
  private renewedExpiry(start: string): string {
    const calendar = this.docType() === 'emissions_check' ? nextEmissionsDeadline(this.owner(), start) : null;
    return calendar ?? addMonths(start, this.kind().renewMonths);
  }

  private toFields(f: FormValue, vehicleId: string): DocumentFields {
    const insurance = this.kind().insurance;
    return {
      vehicle_id: vehicleId,
      type: this.docType(),
      title: f.title,
      issuer: f.issuer,
      reference: f.reference,
      coverage: insurance ? f.coverage : null,
      issued_at: f.issued_at || null,
      expires_at: f.expires_at || null,
      cost: f.cost,
      notes: f.notes,
      contact_phone: insurance ? f.contact_phone : null,
      assistance_phone: insurance ? f.assistance_phone : null,
      insured_number: insurance ? f.insured_number : null,
      policy_item: insurance ? f.policy_item : null,
      notify_enabled: f.notify_enabled,
    };
  }
}

function toForm(d: VehicleDocument): FormValue {
  return {
    title: d.title ?? '',
    issuer: d.issuer ?? '',
    reference: d.reference ?? '',
    coverage: d.coverage ?? '',
    issued_at: d.issued_at ?? '',
    expires_at: d.expires_at ?? '',
    cost: d.cost,
    contact_phone: d.contact_phone ?? '',
    assistance_phone: d.assistance_phone ?? '',
    insured_number: d.insured_number ?? '',
    policy_item: d.policy_item ?? '',
    notes: d.notes ?? '',
    notify_enabled: d.notify_enabled !== false,
  };
}
