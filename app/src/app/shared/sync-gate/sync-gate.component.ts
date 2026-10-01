import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { OnboardingService } from '../../core/auth/onboarding.service';
import { CatalogSeeder } from '../../core/db/seed';
import { SyncService } from '../../core/sync/sync.service';
import { IconComponent } from '../icon/icon.component';

type GatePhase = 'hidden' | 'running' | 'failed';

/**
 * Ventana de sincronización tras cada inicio de sesión.
 *
 * Es el momento en que el dispositivo se pone al día con la cuenta: sube lo
 * que quedó pendiente (p. ej. de antes de que venciera la sesión) y baja lo
 * que se hizo en otros dispositivos. Hasta que termina no se decide adónde ir,
 * porque el wizard puede haberse terminado en otro teléfono.
 *
 * Nunca atrapa al usuario: si el servidor no responde, puede seguir sin
 * sincronizar y el motor lo reintentará en segundo plano.
 */
@Component({
  selector: 'pst-sync-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './sync-gate.component.html',
  styleUrl: './sync-gate.component.scss',
})
export class SyncGateComponent {
  private readonly auth = inject(AuthService);
  private readonly sync = inject(SyncService);
  private readonly onboarding = inject(OnboardingService);
  private readonly seeder = inject(CatalogSeeder);
  private readonly router = inject(Router);

  protected readonly phase = signal<GatePhase>('hidden');
  protected readonly progress = this.sync.progress;
  protected readonly pending = this.sync.pendingCount;
  protected readonly uploads = this.sync.pendingUploads;
  protected readonly error = this.sync.lastError;
  protected readonly name = computed(() => this.auth.user()?.name.split(' ')[0] ?? '');

  constructor() {
    effect(() => {
      if (this.auth.justLoggedIn()) {
        untracked(() => void this.run());
      }
    });
  }

  protected async run(): Promise<void> {
    this.phase.set('running');

    const server = this.auth.serverUser()?.onboarding;
    if (server) {
      await this.onboarding.reconcile(server);
    }
    await this.onboarding.flush();
    await this.sync.sync();

    if (this.sync.status() === 'idle') {
      await this.finish();
    } else {
      this.phase.set('failed');
    }
  }

  protected async finish(): Promise<void> {
    // Después del pull: si el servidor ya tenía el catálogo, el cursor avanzó
    // y el seeder no hace nada. Si no respondió, se siembra igual para no
    // dejar la app vacía; el cursor en 0 es la señal de "cuenta nueva".
    await this.seeder.seedIfEmpty();
    this.auth.acknowledgeLogin();
    this.phase.set('hidden');

    const step = await this.onboarding.currentStep();
    await this.router.navigateByUrl(step === 'done' ? '/' : '/welcome');
  }
}
