import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from './core/auth/auth.service';
import { IconComponent } from './shared/icon/icon.component';
import { DynamicIslandComponent } from './shared/island/dynamic-island.component';
import { IslandService } from './shared/island/island.service';
import { SyncGateComponent } from './shared/sync-gate/sync-gate.component';
import { TabBarComponent } from './shared/tab-bar/tab-bar.component';

/** Rutas sin isla ni pestañas: todavía no hay una app que navegar. */
const BARE_ROUTES = ['/login', '/bienvenida'];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    DynamicIslandComponent,
    TabBarComponent,
    SyncGateComponent,
    IconComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly island = inject(IslandService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly islandExpanded = this.island.expanded;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly chrome = computed(
    () => !BARE_ROUTES.some((route) => this.url().startsWith(route)),
  );

  /**
   * La sesión venció pero la app sigue funcionando con sus datos locales. Solo
   * se avisa, sin bloquear: lo único que espera al login es el sync.
   */
  protected readonly sessionExpired = computed(
    () => this.auth.state() === 'expired' && this.chrome(),
  );

  protected collapseIsland(): void {
    this.island.collapse();
  }
}
