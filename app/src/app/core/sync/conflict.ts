import type { OutboxEntry, SyncConflict } from '../models';

/** De qué lado se queda un campo en conflicto. */
export type ConflictSide = 'mine' | 'theirs';

/**
 * Columnas que no son datos del usuario: las administra el sync o solo
 * existen en este dispositivo. No cuentan como "cambio" al comparar versiones.
 */
const NOT_COMPARED: ReadonlySet<string> = new Set([
  'id',
  'rev',
  'user_id',
  'created_at',
  'updated_at',
  'client_updated_at',
  'deleted_at',
  'local_blob_key',
  'upload_status',
  'storage_path',
]);

/** Lo local que el servidor no conoce y una versión del servidor no debe borrar. */
const LOCAL_ONLY = ['local_blob_key', 'upload_status'] as const;

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T/;

type Row = Readonly<Record<string, unknown>>;

/**
 * Igualdad por valor, con la misma tolerancia que el servidor (`Field::normalize`):
 * `12.5` y `"12.50"` son el mismo decimal, y dos timestamps del mismo instante
 * son iguales aunque uno traiga microsegundos.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if ((a ?? null) === null || (b ?? null) === null) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return Math.abs(x - y) < 1e-9;
  }
  if (typeof a === 'string' && typeof b === 'string' && ISO_DATETIME.test(a) && ISO_DATETIME.test(b)) {
    const x = Date.parse(a);
    const y = Date.parse(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x === y;
  }
  if (typeof a === 'object' || typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

/** Campos de datos en los que `current` difiere de `base`. */
export function changedFields(base: Row, current: Row): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
  return [...keys].filter((key) => !NOT_COMPARED.has(key) && !sameValue(base[key], current[key])).sort();
}

/** Las tres versiones de un conflicto y qué se combinó solo. */
export interface ConflictView {
  readonly conflict: SyncConflict;
  /** Lo que vio este dispositivo antes de editar. */
  readonly base: Row;
  /** Mi versión (el payload en cola). `null` si mi cambio es un borrado. */
  readonly mine: Row | null;
  /** La versión del servidor (en `create_in_deleted_parent`, el padre). */
  readonly theirs: Row | null;
  /** Campos que chocan: los que tiene que decidir el usuario. */
  readonly fields: readonly string[];
  /** Campos que cambió solo el otro dispositivo: se conservan. */
  readonly fromTheirs: readonly string[];
  /** Campos que cambié solo yo: se conservan. */
  readonly fromMine: readonly string[];
}

export function conflictView(entry: OutboxEntry): ConflictView | null {
  const conflict = entry.conflict;
  if (!conflict) {
    return null;
  }

  const mine = parse(entry.payload);
  const theirs = conflict.server_row as Row | null;
  // Sin base (entrada vieja) no se sabe qué vio el usuario: se compara contra
  // el servidor, que es lo que hizo el servidor al detectar el choque.
  const base = parse(entry.base) ?? theirs ?? {};
  const isMyDelete = entry.op === 'delete';
  // En `create_in_deleted_parent` la fila del servidor es el padre: comparar
  // campos no tiene sentido.
  const comparable = conflict.kind !== 'create_in_deleted_parent';

  const mineChanged = mine && comparable && !isMyDelete ? changedFields(base, mine) : [];
  const theirsChanged = theirs && comparable && !theirs['deleted_at'] ? changedFields(base, theirs) : [];
  const fields = [...conflict.fields];

  return {
    conflict,
    base,
    mine: isMyDelete ? null : mine,
    theirs,
    fields,
    fromTheirs: theirsChanged.filter((field) => !mineChanged.includes(field)),
    fromMine: mineChanged.filter((field) => !fields.includes(field)),
  };
}

/**
 * La versión resuelta: parte de la del servidor (con lo que cambió el otro
 * dispositivo), le aplica lo que cambié yo sin choque y, en cada campo en
 * conflicto, el lado elegido. Así "usar la del servidor" no tira mis cambios
 * en campos que nadie más tocó.
 */
export function resolvedRow(view: ConflictView, choices: Readonly<Record<string, ConflictSide>>): Record<string, unknown> {
  const mine = view.mine ?? {};
  const result: Record<string, unknown> = { ...(view.theirs ?? mine) };

  for (const field of view.fromMine) {
    result[field] = mine[field];
  }
  for (const field of view.fields) {
    result[field] = (choices[field] ?? 'mine') === 'mine' ? mine[field] : view.theirs?.[field];
  }
  for (const field of LOCAL_ONLY) {
    if (field in mine) result[field] = mine[field];
  }
  return result;
}

function parse(json: string | null): Row | null {
  return json ? (JSON.parse(json) as Row) : null;
}
