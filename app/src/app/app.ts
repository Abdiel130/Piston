import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DynamicIslandComponent } from './shared/island/dynamic-island.component';
import { IslandService } from './shared/island/island.service';
import { TabBarComponent } from './shared/tab-bar/tab-bar.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, DynamicIslandComponent, TabBarComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly island = inject(IslandService);

  protected readonly islandExpanded = this.island.expanded;

  protected collapseIsland(): void {
    this.island.collapse();
  }
}
