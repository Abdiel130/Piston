/*
 * Subida de pendientes con la app cerrada.
 *
 * SOLO sube el outbox: no jala ni resuelve conflictos. Un conflicto se marca
 * y espera a que el usuario decida en la app (core/sync/sync.service.ts).
 * Aquí se mantiene a propósito lo mínimo para que las dos copias no se
 * desalineen:
 *
 * - `sync` (Background Sync): el navegador lo dispara al volver la red, aunque
 *   la app esté cerrada. La app lo registra cada vez que queda algo en cola.
 * - `periodicsync` (Periodic Background Sync): aproximadamente una vez al día,
 *   cuando Chrome lo decida. Solo en la PWA instalada. Sin pendientes no toca
 *   la red.
 *
 * Usa Dexie (copiado de node_modules en el build) sobre la misma base: así las
 * pestañas abiertas ven los cambios por liveQuery. Comparte con la app los Web
 * Locks `piston-sync` y `piston-refresh`: nunca sincronizan ni rotan la sesión
 * a la vez.
 */
/* global Dexie */
importScripts('./sw/dexie.min.js');

const OUTBOX_TAG = 'piston-outbox';
const DAILY_TAG = 'piston-daily';
const API = `${self.location.origin}/api`;
const BATCH = 200;

/** Mismo orden que TABLE_ORDER en core/models/sync.ts: padres antes que hijos. */
const ORDER = [
  'vehicles', 'gauge_calibration_points', 'odometer_readings', 'fuel_stations', 'service_types',
  'expense_categories', 'fuel_entries', 'fuel_station_prices', 'service_records', 'service_record_items',
  'service_parts', 'maintenance_schedules', 'issues', 'issue_service_links', 'recurring_expenses',
  'expenses', 'documents', 'trips', 'reminders', 'attachments',
];

/** Mismo texto que TABLE_LABEL en core/sync/describe.ts, para el historial. */
const LABEL = {
  vehicles: 'Vehículo', gauge_calibration_points: 'Calibración del tanque', odometer_readings: 'Lectura de odómetro',
  fuel_stations: 'Gasolinera', fuel_station_prices: 'Precio de gasolinera', fuel_entries: 'Carga de combustible',
  service_types: 'Tipo de servicio', service_records: 'Servicio', service_record_items: 'Concepto de servicio',
  service_parts: 'Refacción', maintenance_schedules: 'Plan de mantenimiento', issues: 'Falla',
  issue_service_links: 'Falla ligada a servicio', reminders: 'Recordatorio', expense_categories: 'Categoría de gasto',
  recurring_expenses: 'Gasto recurrente', expenses: 'Gasto', documents: 'Documento', trips: 'Viaje',
  attachments: 'Foto o archivo',
};

self.addEventListener('sync', (event) => {
  // Si falla por red, se relanza: el navegador reintenta el Background Sync.
  if (event.tag === OUTBOX_TAG) event.waitUntil(backgroundPush({ rethrowTransient: true }));
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === DAILY_TAG) event.waitUntil(backgroundPush({ rethrowTransient: false }));
});

async function backgroundPush(options) {
  const locks = self.navigator && self.navigator.locks;
  if (!locks) return pushOutbox(options);
  // Si la app está sincronizando en este momento, ella se encarga.
  return locks.request('piston-sync', { ifAvailable: true }, (lock) => (lock ? pushOutbox(options) : undefined));
}

async function pushOutbox({ rethrowTransient }) {
  // Nunca crear la base desde aquí: si no existe, la app todavía no la armó.
  if (!(await Dexie.exists('piston'))) return;

  const db = new Dexie('piston');
  await db.open();
  try {
    const entries = (await db.table('sync_outbox').where('status').equals('pending').toArray()).sort(
      (a, b) => ORDER.indexOf(a.table_name) - ORDER.indexOf(b.table_name) || a.created_at.localeCompare(b.created_at),
    );
    if (entries.length === 0) return;

    const run = {
      id: uuid(), started_at: new Date().toISOString(), finished_at: null, trigger: 'background',
      pushed: 0, applied: 0, stale: 0, rejected: 0, pulled: 0, uploaded: 0,
      outcome: 'running', error: null, request_ids: [],
    };

    try {
      const token = await accessToken();
      if (!token) {
        // Sesión vencida o sin red para renovarla: la app lo resolverá al abrirse.
        run.outcome = 'auth';
        run.error = attempt('auth', null, null, 'No se pudo renovar la sesión en segundo plano.', null, null);
        return;
      }
      for (let i = 0; i < entries.length; i += BATCH) {
        await pushBatch(db, entries.slice(i, i + BATCH), token, run);
      }
      run.outcome = run.rejected > 0 ? 'partial' : 'ok';
    } catch (error) {
      run.outcome = 'failed';
      run.error = run.error || attempt(self.navigator.onLine ? 'server_unreachable' : 'offline', null, null, String(error), null, null);
      if (rethrowTransient) throw error;
    } finally {
      run.finished_at = new Date().toISOString();
      await db.table('sync_runs').put(run);
    }
  } finally {
    db.close();
  }
}

async function pushBatch(db, batch, token, run) {
  const requestId = uuid();
  const startedAt = Date.now();
  run.request_ids.push(requestId);

  const response = await fetch(`${API}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Piston-Client': 'web',
      'X-Request-Id': requestId,
    },
    body: JSON.stringify({
      mutations: batch.map(toMutation),
    }),
  });
  const body = await response.json().catch(() => null);
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const kind = response.status >= 500 ? (response.status === 500 ? 'server_error' : 'unavailable')
      : response.status === 429 ? 'rate_limited' : response.status === 401 ? 'auth' : 'validation';
    run.error = attempt(kind, response.status, body && body.code, (body && body.message) || `HTTP ${response.status}`, requestId, durationMs);
    // Un rechazo del lote entero (413, 422) lo parte y diagnostica la app.
    throw new Error(`HTTP ${response.status}`);
  }

  const { applied, rejected } = body.data;
  const byRow = new Map(batch.map((e) => [`${e.table_name}/${e.row_id}`, e]));
  run.pushed += batch.length;

  await db.transaction('rw', db.tables, async () => {
    for (const item of applied) {
      const entry = byRow.get(`${item.table}/${item.id}`);
      if (!entry) continue;
      // Solo el rev: si hubo mezcla, la fila combinada llega con el pull de la app.
      if (item.rev > 0 && !item.stale) await db.table(item.table).update(item.id, { rev: item.rev });
      await db.table('sync_outbox').delete(entry.id);
      const outcome = item.stale ? 'stale' : item.merged && item.merged.length ? 'merged' : 'applied';
      await db.table('sync_log').add(log(run.id, entry, outcome, requestId, null));
      if (item.stale) run.stale += 1; else run.applied += 1;
    }
    for (const item of rejected) {
      const entry = byRow.get(`${item.table}/${item.id}`);
      // parent_missing: el padre sigue en cola; la app decide si queda bloqueado.
      if (!entry || item.code === 'parent_missing') continue;
      if (item.conflict) {
        await markConflict(db, entry, item, requestId, durationMs);
        await db.table('sync_log').add(log(run.id, entry, 'conflict', requestId, null));
        run.rejected += 1;
        continue;
      }
      const failure = attempt(kindOf(item.code), 200, item.code, item.message, requestId, durationMs, item.errors);
      await db.table('sync_outbox').update(entry.id, { status: 'failed', attempts: entry.attempts + 1, last_attempt: failure });
      await db.table('sync_log').add(log(run.id, entry, 'rejected', requestId, failure));
      run.rejected += 1;
    }
  });
}

/** Igual que `toMutation` en sync.service.ts: sin `base_rev` (entrada vieja), last-write-wins. */
function toMutation(e) {
  const mutation = { table: e.table_name, id: e.row_id, op: e.op, payload: e.payload ? JSON.parse(e.payload) : null };
  if (e.base_rev === null || e.base_rev === undefined) return mutation;
  mutation.base_rev = e.base_rev;
  mutation.base = e.base ? JSON.parse(e.base) : null;
  if (e.resolve) mutation.resolve = e.resolve;
  return mutation;
}

/**
 * Igual que `markConflict` en sync.service.ts. Nunca resuelve: un hijo de un
 * padre borrado queda detrás del padre si este también está en cola.
 */
async function markConflict(db, entry, item, requestId, durationMs) {
  const detail = item.conflict;
  const parent = detail.parent || null;
  const parentQueued = parent
    ? (await db.table('sync_outbox').where('[table_name+row_id]').equals([parent.table, parent.id]).count()) > 0
    : false;
  const failure = attempt(
    item.code === 'parent_deleted' ? 'parent_deleted' : 'edit_conflict',
    200, item.code, item.message, requestId, durationMs, item.errors,
  );
  await db.table('sync_outbox').update(entry.id, {
    status: parentQueued ? 'blocked' : 'conflict',
    blocked_by: parentQueued ? parent : null,
    attempts: entry.attempts + 1,
    last_attempt: failure,
    conflict: parentQueued ? null : { ...detail, detected_at: failure.at, request_id: requestId },
  });
}

/** Renueva la sesión con la cookie HttpOnly. Mismo lock que AuthService: nunca rotan a la vez. */
async function accessToken() {
  const refresh = async () => {
    for (let tries = 0; tries < 2; tries += 1) {
      const response = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-Piston-Client': 'web', 'X-Request-Id': uuid() },
      });
      const body = await response.json().catch(() => null);
      if (response.ok) return body.data.access_token;
      if (!(body && body.code === 'refresh_race')) return null;
    }
    return null;
  };
  const locks = self.navigator && self.navigator.locks;
  return locks ? locks.request('piston-refresh', refresh) : refresh();
}

function kindOf(code) {
  switch (code) {
    case 'forbidden': return 'forbidden';
    case 'conflict': return 'conflict';
    case 'unknown_table': return 'client_bug';
    default: return 'validation';
  }
}

function attempt(kind, httpStatus, code, message, requestId, durationMs, fieldErrors) {
  return {
    at: new Date().toISOString(), kind, http_status: httpStatus, code: code || null, message,
    request_id: requestId, field_errors: fieldErrors || null, duration_ms: durationMs, retry_after_s: null,
  };
}

function log(runId, entry, outcome, requestId, failure) {
  return {
    id: uuid(), run_id: runId, at: new Date().toISOString(), table_name: entry.table_name, row_id: entry.row_id,
    op: entry.op, label: LABEL[entry.table_name] || entry.table_name, outcome, request_id: requestId, attempt: failure,
  };
}

function uuid() {
  return self.crypto.randomUUID();
}
