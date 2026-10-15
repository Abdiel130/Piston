/*
 * Notificaciones de avisos del vehículo con la app cerrada.
 *
 * En el periodic sync diario revisa lo mismo que `VehicleAlerts` y
 * `NotificationService` en la app, y notifica lo que no haya sonado ya en este
 * dispositivo. Es una copia en JS de:
 *
 * - `documentAlerts` / `reminderAlerts` (core/data/vehicle-alerts.service.ts)
 * - `documentStatus`, `expiryLabel` (core/data/document-status.ts)
 * - `reminderState`, `dueLabel` (core/data/reminder-schedule.ts)
 * - `dueNotifications`, `messagesFor` (core/notifications/notification-rules.ts)
 *
 * `notification-parity.spec.ts` corre esta copia contra las de TS: si cambia
 * una, el spec lo dice. También atiende el toque en cualquier notificación de
 * Piston, salga de aquí o de la app abierta.
 */
/* global Dexie */

(function () {
  const DAILY = 'piston-daily';
  const LOCK = 'piston-notify';
  const EXPIRING_DAYS = 30;
  const DEFAULT_NOTIFY_DAYS = 15;
  const DEFAULT_NOTIFY_KM = 500;
  const SUMMARY_AFTER = 3;
  const SUMMARY_TAG = 'piston-alerts';
  const CLICK_MESSAGE = 'piston-notification-click';
  const FORGET_AFTER_MS = 400 * 24 * 60 * 60 * 1000;
  const ICON = 'icons/app/192.png';
  const MILE_KM = 1.609344;
  const DEFAULT_PREFS = { key: 'current', enabled: true, insurance: true, documents: true, reminders: true };

  const DOCUMENT_LABEL = {
    insurance: 'Seguro',
    emissions_check: 'Verificación',
    ownership_tax: 'Tenencia',
    circulation_card: 'Tarjeta de circulación',
    driver_license: 'Licencia',
    warranty: 'Garantía',
    other: 'Documento',
  };

  const integer = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

  function todayIso() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function daysUntil(day, today) {
    return Math.round((Date.parse(`${day.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  }

  function distanceFormat(unit) {
    return unit === 'mi'
      ? (km) => `${integer.format(km / MILE_KM)} mi`
      : (km) => `${integer.format(km)} km`;
  }

  // ── Documentos ─────────────────────────────────────────────────────────────

  function documentStatus(expiresAt, today) {
    if (!expiresAt) return 'ok';
    const days = daysUntil(expiresAt, today);
    if (days < 0) return 'expired';
    return days <= EXPIRING_DAYS ? 'expiring' : 'ok';
  }

  function expiryLabel(expiresAt, today) {
    const days = daysUntil(expiresAt, today);
    if (days === 0) return 'Vence hoy';
    if (days === 1) return 'Vence mañana';
    if (days === -1) return 'Venció ayer';
    return days > 0 ? `Vence en ${days} días` : `Venció hace ${-days} días`;
  }

  function documentAlerts(documents, today) {
    const alerts = [];
    for (const doc of documents) {
      const status = documentStatus(doc.expires_at, today);
      if (doc.deleted_at || doc.renewed_by_id || status === 'ok') continue;
      const tone = status === 'expired' ? 'bad' : 'warn';
      const insurance = doc.type === 'insurance';
      alerts.push({
        id: `document:${doc.id}`,
        vehicle_id: doc.vehicle_id,
        tone,
        title: insurance ? 'Póliza de seguro' : (doc.title ?? DOCUMENT_LABEL[doc.type]),
        detail: expiryLabel(doc.expires_at, today),
        route: insurance ? '/vehicle/insurance' : '/vehicle/documents',
        category: insurance ? 'insurance' : 'documents',
        key: `document:${doc.id}:${tone}:${doc.expires_at}`,
        notify: doc.notify_enabled !== false,
      });
    }
    return alerts;
  }

  // ── Recordatorios ──────────────────────────────────────────────────────────

  function kmRemaining(r, odometerKm) {
    return r.due_odometer_km !== null && r.due_odometer_km !== undefined && odometerKm !== null
      ? r.due_odometer_km - odometerKm
      : null;
  }

  function reminderState(r, today, odometerKm) {
    const days = r.due_date ? daysUntil(r.due_date, today) : null;
    const kmLeft = kmRemaining(r, odometerKm);
    if ((days !== null && days < 0) || (kmLeft !== null && kmLeft < 0)) return 'overdue';
    const notifyDays = r.notify_days_before ?? DEFAULT_NOTIFY_DAYS;
    const notifyKm = r.notify_km_before ?? DEFAULT_NOTIFY_KM;
    if ((days !== null && days <= notifyDays) || (kmLeft !== null && kmLeft <= notifyKm)) return 'upcoming';
    return 'ok';
  }

  function dueLabel(r, today, odometerKm, distance) {
    const parts = [];
    if (r.due_date) {
      const days = daysUntil(r.due_date, today);
      if (days === 0) parts.push('Toca hoy');
      else if (days === 1) parts.push('Toca mañana');
      else if (days === -1) parts.push('Se pasó por 1 día');
      else parts.push(days > 0 ? `Toca en ${days} días` : `Se pasó por ${-days} días`);
    }
    const kmLeft = kmRemaining(r, odometerKm);
    if (kmLeft !== null) {
      if (kmLeft === 0) parts.push('Toca ya por km');
      else parts.push(kmLeft > 0 ? `Faltan ${distance(kmLeft)}` : `Se pasó por ${distance(-kmLeft)}`);
    } else if (r.due_odometer_km !== null && r.due_odometer_km !== undefined) {
      parts.push(`A los ${distance(r.due_odometer_km)}`);
    }
    return parts.join(' · ');
  }

  function reminderAlerts(reminders, vehicles, today, distance) {
    const odometer = new Map(vehicles.map((v) => [v.id, v.current_odometer_km]));
    const alerts = [];
    for (const r of reminders) {
      if (r.deleted_at || (r.status !== 'pending' && r.status !== 'notified')) continue;
      const km = odometer.get(r.vehicle_id) ?? null;
      const state = reminderState(r, today, km);
      if (state === 'ok') continue;
      const tone = state === 'overdue' ? 'bad' : 'warn';
      alerts.push({
        id: `reminder:${r.id}`,
        vehicle_id: r.vehicle_id,
        tone,
        title: r.title,
        detail: dueLabel(r, today, km, distance),
        route: '/vehicle/reminders',
        category: 'reminders',
        key: `reminder:${r.id}:${tone}:${r.due_date ?? ''}:${r.due_odometer_km ?? ''}`,
        notify: r.notify_enabled !== false,
      });
    }
    return alerts;
  }

  // ── Qué suena y con qué texto ──────────────────────────────────────────────

  function activeAlerts(alerts, vehicles) {
    const active = new Set(vehicles.filter((v) => !v.deleted_at && v.status === 'active').map((v) => v.id));
    return alerts.filter((alert) => active.has(alert.vehicle_id));
  }

  function dueNotifications(alerts, prefs, notified) {
    return alerts.filter(
      (alert) => prefs.enabled && prefs[alert.category] !== false && alert.notify && !notified.has(alert.key),
    );
  }

  function messagesFor(alerts, vehicleNames) {
    const several = new Set(alerts.map((a) => a.vehicle_id)).size > 1 || vehicleNames.size > 1;
    const body = (alert) => {
      const name = vehicleNames.get(alert.vehicle_id);
      return several && name ? `${name} · ${alert.detail}` : alert.detail;
    };
    if (alerts.length > SUMMARY_AFTER) {
      const shown = alerts.slice(0, SUMMARY_AFTER).map((alert) => `${alert.title}: ${body(alert)}`);
      return [{
        title: `${alerts.length} avisos de tus vehículos`,
        body: [...shown, `y ${alerts.length - SUMMARY_AFTER} más`].join('\n'),
        tag: SUMMARY_TAG,
        url: '/',
      }];
    }
    return alerts.map((alert) => ({
      title: alert.title,
      body: body(alert),
      tag: alert.id,
      url: `${alert.route}?vehicle=${encodeURIComponent(alert.vehicle_id)}`,
    }));
  }

  // ── Revisión diaria ────────────────────────────────────────────────────────

  async function notifyDue() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!(await Dexie.exists('piston'))) return;
    const db = new Dexie('piston');
    await db.open();
    try {
      // La app todavía no sube la base a la versión con notificaciones.
      const names = db.tables.map((table) => table.name);
      if (!names.includes('notified_alerts') || !names.includes('notification_prefs')) return;

      const prefs = (await db.table('notification_prefs').get('current')) || DEFAULT_PREFS;
      if (!prefs.enabled) return;

      const today = todayIso();
      const session = await db.table('session').get('current');
      const distance = distanceFormat(session && session.user && session.user.distance_unit);
      const vehicles = await db.table('vehicles').toArray();
      const documents = await db.table('documents').toArray();
      const reminders = await db.table('reminders').toArray();
      const alerts = activeAlerts(
        [...documentAlerts(documents, today), ...reminderAlerts(reminders, vehicles, today, distance)],
        vehicles,
      );

      const notified = new Set((await db.table('notified_alerts').toArray()).map((row) => row.key));
      const due = dueNotifications(alerts, prefs, notified);
      if (due.length === 0) return;

      const at = new Date().toISOString();
      await db.table('notified_alerts').bulkPut(due.map((alert) => ({ key: alert.key, at })));
      await db.table('notified_alerts').where('at').below(new Date(Date.now() - FORGET_AFTER_MS).toISOString()).delete();

      const vehicleNames = new Map(
        vehicles
          .filter((v) => !v.deleted_at && v.status === 'active')
          .map((v) => [v.id, v.nickname ?? `${v.make} ${v.model}`]),
      );
      for (const message of messagesFor(due, vehicleNames)) {
        await self.registration.showNotification(message.title, {
          body: message.body, tag: message.tag, icon: ICON, badge: ICON, data: { url: message.url },
        });
      }
    } finally {
      db.close();
    }
  }

  async function notifyWithLock() {
    const locks = self.navigator && self.navigator.locks;
    if (!locks) return notifyDue();
    // Si la app abierta está revisando, ella se encarga.
    return locks.request(LOCK, { ifAvailable: true }, (lock) => (lock ? notifyDue() : undefined));
  }

  /** Lleva a la vista del aviso: a la pestaña abierta si la hay, si no abre la app. */
  async function openFromNotification(url) {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((c) => 'focus' in c);
    if (client) {
      await client.focus();
      client.postMessage({ type: CLICK_MESSAGE, url });
      return;
    }
    await self.clients.openWindow(new URL(url.replace(/^\//, ''), self.registration.scope).href);
  }

  if (typeof self.addEventListener === 'function' && self.registration) {
    self.addEventListener('periodicsync', (event) => {
      if (event.tag === DAILY) event.waitUntil(notifyWithLock().catch(() => undefined));
    });

    self.addEventListener('notificationclick', (event) => {
      const url = event.notification.data && event.notification.data.url;
      if (typeof url !== 'string') return;
      event.notification.close();
      event.waitUntil(openFromNotification(url));
    });
  }

  // Para `notification-parity.spec.ts`.
  self.pistonAlerts = { documentAlerts, reminderAlerts, activeAlerts, dueNotifications, messagesFor, distanceFormat };
})();
