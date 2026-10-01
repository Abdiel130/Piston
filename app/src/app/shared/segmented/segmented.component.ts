import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Contador opcional junto a la etiqueta (p. ej. cambios pendientes). */
  readonly count?: number;
}

/**
 * Control segmentado al estilo iOS: dos o tres vistas hermanas de una misma
 * pantalla. La píldora se desliza a la opción activa.
 */
@Component({
  selector: 'pst-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="seg"
      role="tablist"
      [attr.aria-label]="label()"
      [style.--count]="options().length"
      [style.--index]="activeIndex()"
    >
      <span class="seg__thumb" aria-hidden="true"></span>
      @for (option of options(); track option.value) {
        <button
          type="button"
          role="tab"
          class="seg__option"
          [class.is-active]="option.value === value()"
          [attr.aria-selected]="option.value === value()"
          (click)="value.set(option.value)"
        >
          {{ option.label }}
          @if (option.count) {
            <span class="seg__count pst-numeric">{{ option.count }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    .seg {
      position: relative;
      display: grid;
      grid-template-columns: repeat(var(--count), 1fr);
      padding: 0.125rem;
      border-radius: var(--pst-r-md);
      background: var(--pst-surface-2);
    }

    .seg__thumb {
      position: absolute;
      top: 0.125rem;
      bottom: 0.125rem;
      left: 0.125rem;
      width: calc((100% - 0.25rem) / var(--count));
      border-radius: calc(var(--pst-r-md) - 0.125rem);
      background: var(--pst-surface-4);
      box-shadow: var(--pst-shadow-card);
      transform: translateX(calc(100% * var(--index)));
      transition: transform var(--pst-dur-base) var(--pst-spring);
    }

    .seg__option {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--pst-space-2);
      padding: var(--pst-space-2) var(--pst-space-3);
      font-size: var(--pst-subhead);
      font-weight: 500;
      color: var(--pst-label-2);
      transition: color var(--pst-dur-fast) var(--pst-snap);
    }

    .seg__option.is-active {
      color: var(--pst-label);
      font-weight: 600;
    }

    .seg__count {
      min-width: 1.25rem;
      padding: 0 0.375rem;
      border-radius: var(--pst-r-pill);
      background: color-mix(in srgb, var(--pst-ignition) 22%, transparent);
      color: var(--pst-ignition);
      font-size: var(--pst-caption);
      line-height: 1.25rem;
    }
  `,
})
export class SegmentedComponent<T extends string> {
  readonly options = input.required<readonly SegmentedOption<T>[]>();
  readonly value = model.required<T>();
  readonly label = input<string>('');

  protected activeIndex(): number {
    return Math.max(0, this.options().findIndex((option) => option.value === this.value()));
  }
}
