import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { SyncAttempt } from '../../core/models';
import { DIAGNOSIS } from '../../core/sync/diagnosis';
import { IconComponent } from '../../shared/icon/icon.component';
import { duration, exactLocal, exactUtc, fieldLabel } from './sync-format';

/**
 * Diagnóstico de un intento fallido: qué pasó, cómo se soluciona y los datos
 * técnicos para buscarlo en los logs del servidor (request id y hora exacta).
 */
@Component({
  selector: 'pst-sync-attempt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './sync-attempt.component.html',
  styleUrl: './sync-attempt.component.scss',
})
export class SyncAttemptComponent {
  readonly attempt = input.required<SyncAttempt>();
  /** Intentos acumulados y próximo reintento, cuando es un cambio todavía en cola. */
  readonly attempts = input<number | null>(null);
  readonly nextRetry = input<string | null>(null);

  protected readonly diagnosis = computed(() => DIAGNOSIS[this.attempt().kind]);
  protected readonly fieldErrors = computed(() =>
    Object.entries(this.attempt().field_errors ?? {}).map(([field, messages]) => ({
      field: fieldLabel(field),
      messages,
    })),
  );
  protected readonly copied = signal(false);

  protected readonly exactLocal = exactLocal;
  protected readonly exactUtc = exactUtc;
  protected readonly duration = duration;

  protected async copyRequestId(): Promise<void> {
    const id = this.attempt().request_id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Sin permiso de portapapeles: el id sigue visible y seleccionable.
    }
  }
}
