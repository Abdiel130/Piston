import { photoDate } from '../../core/data/album.service';
import { formatLongDate, formatMonth } from '../../core/format';
import type { Attachment } from '../../core/models';

/** Id de ruta de las fotos sin álbum: `/vehicle/gallery/loose`. */
export const LOOSE_ALBUM = 'loose';

/** Fotos de un mismo mes, para leer la evolución por etapas. */
export interface MonthGroup {
  readonly key: string;
  readonly label: string;
  readonly photos: readonly Attachment[];
}

/** Agrupa por mes de captura, en el orden en que llegan (ya ordenadas por fecha). */
export function byMonth(photos: readonly Attachment[]): MonthGroup[] {
  const groups: { key: string; label: string; photos: Attachment[] }[] = [];
  for (const photo of photos) {
    const date = new Date(photoDate(photo));
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const last = groups.at(-1);
    if (last?.key === key) {
      last.photos.push(photo);
    } else {
      groups.push({ key, label: formatMonth(date), photos: [photo] });
    }
  }
  return groups;
}

/** "12 fotos · 3 ene 2024 – 9 mar 2025"; una sola fecha si todas son del mismo día. */
export function photoSpan(photos: readonly Attachment[]): string {
  if (!photos.length) return 'Sin fotos';
  const count = photos.length === 1 ? '1 foto' : `${photos.length} fotos`;
  const from = formatLongDate(photoDate(photos[0]));
  const to = formatLongDate(photoDate(photos.at(-1)!));
  return from === to ? `${count} · ${from}` : `${count} · ${from} – ${to}`;
}

/** ISO → valor de `<input type="datetime-local">` en hora local. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** Valor de `<input type="datetime-local">` → ISO. Nulo si está vacío o es inválido. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
