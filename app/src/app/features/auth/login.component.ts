import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AccountMismatchError, AuthService } from '../../core/auth/auth.service';
import { isApiErrorBody } from '../../core/models';
import { SyncService } from '../../core/sync/sync.service';
import { IconComponent } from '../../shared/icon/icon.component';

/**
 * Inicio de sesión.
 *
 * No hay registro: las cuentas se crean en el servidor. Si la sesión venció,
 * el correo queda fijo en el de la cuenta dueña del dispositivo; entrar con
 * otra mezclaría datos de dos personas.
 *
 * Al terminar no navega: la ventana de sincronización toma el control y decide
 * adónde ir cuando el dispositivo esté al día.
 */
@Component({
  selector: 'pst-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly sync = inject(SyncService);

  protected readonly reauth = computed(() => this.auth.state() === 'expired');
  protected readonly online = this.sync.online;

  protected readonly email = signal(
    this.auth.state() === 'expired' ? (this.auth.user()?.email ?? '') : '',
  );
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canSubmit = computed(
    () => this.online() && !this.busy() && this.email().trim() !== '' && this.password() !== '',
  );

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) {
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email().trim(), this.password());
      this.password.set('');
    } catch (error) {
      this.error.set(messageFor(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}

function messageFor(error: unknown): string {
  if (error instanceof AccountMismatchError) {
    return error.message;
  }
  if (!(error instanceof HttpErrorResponse)) {
    return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
  }
  if (error.status === 0) {
    return 'No hay conexión con el servidor.';
  }
  if (!isApiErrorBody(error.error)) {
    return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
  }

  // El servidor ya manda el mensaje para humanos; solo se afina el de límite
  // de intentos, que puede decir cuánto esperar.
  const body = error.error;
  if (body.code === 'too_many_requests' && typeof body.meta.retry_after === 'number') {
    return `Demasiados intentos. Espera ${body.meta.retry_after} s y vuelve a probar.`;
  }
  return body.errors?.['email']?.[0] ?? body.message;
}
