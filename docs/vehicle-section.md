# Sección del vehículo (issue #10)

Hoja de ruta para llevar el vehículo fuera de Ajustes: una sección propia que
se abre desde el apodo en el garage, con cambio rápido de vehículo y vistas
para datos, póliza, documentos, recordatorios y fotos.

La issue es grande, así que se entrega por fases. **Cada fase es una rama
nueva desde `main` (`feature/<nombre>`) y un PR propio.** Este documento es
el contexto completo para arrancar cualquier fase sin leer las anteriores:
basta con leer la sección de esa fase y la de [Decisiones](#decisiones).

| Fase | Issue | Rama | Entrega |
|------|-------|------|---------|
| 1 | #23 | `feature/vehicle-sheet` | Hoja del vehículo, cambio rápido y Datos del vehículo |
| 2 | #24 | `feature/vehicle-insurance` | Póliza de seguro con aviso de vencimiento |
| 3 | #25 | `feature/vehicle-documents` | Otros documentos (verificación, tenencia, tarjeta, licencia…) |
| 4 | #26 | `feature/vehicle-reminders` | Recordatorios recurrentes y bitácora |
| 5 | #27 | `feature/vehicle-alerts` | Notificaciones locales del sistema |
| 6 | #28 | `feature/vehicle-gallery` | Galería de fotos con álbumes |

---

## Decisiones

- **Vehículo en gestión = `is_primary`.** Cambiar de vehículo desde el garage
  llama a `VehicleService.setPrimary(id)`. Se sincroniza entre dispositivos y
  todo lo que ya lee `VehicleContext.vehicle` (garage, combustible, servicios,
  gastos y todos los formularios de captura) sigue el cambio sin tocarse.
  Cualquier registro nuevo o modificado va al vehículo en gestión.
- **Agregar vehículos sigue en Ajustes.** La hoja solo cambia entre los que
  existen.
- **Captura manual de documentos.** Sin OCR ni IA: se sube el PDF o la foto y
  se llenan los campos importantes (vencimiento, teléfonos, número…).
- **Avisos = badge persistente + notificación local.** El badge de atención
  no se quita hasta que se resuelve (ej. la póliza se marca como renovada). La
  notificación del sistema sale una sola vez, con la Notification API, al
  abrir la app o en el periodic sync del service worker. Sin Web Push.
- **Un solo origen de alertas: `VehicleAlerts`**
  (`app/src/app/core/data/vehicle-alerts.service.ts`). Cada fase que agrega
  algo vencible registra su fuente ahí; badges y notificaciones solo leen de
  ese servicio.

## Base existente

Lo que ya está y conviene reusar en todas las fases:

- **Datos locales**: Dexie en `app/src/app/core/db/piston-db.ts` (versión 4 al
  arrancar la fase 1). Escrituras siempre por `OfflineStore`
  (`create/update/remove/transaction`, lecturas vivas con
  `liveSignal/liveFrom`), que encola el sync.
- **Sync**: `server/app/Sync/SyncRegistry.php` ya sincroniza `documents`,
  `reminders` y `attachments`. Agregar una columna implica: migración Laravel,
  campo en el `SyncTable` del registro, tipo en `core/models/domain.ts`,
  versión nueva de Dexie si cambia un índice y `docs/schema.dbml`.
- **Modelos**:
  - `VehicleDocument` (`domain.ts`): `type` (`insurance`, `emissions_check`,
    `ownership_tax`, `circulation_card`, `driver_license`, `warranty`,
    `other`), `title`, `issuer`, `reference`, `coverage`, `issued_at`,
    `expires_at`, `cost`, `notes`.
  - `Reminder`: `kind` (`service`/`document`/`custom`), `source_id`, `title`,
    `due_date`, `due_odometer_km`, `notify_days_before`, `notify_km_before`,
    `status` (`pending`/`notified`/`done`/`dismissed`), `last_notified_at`.
    **No tiene recurrencia todavía.**
  - `Attachment` con `owner_type` (`vehicle`, `document`, …) y blobs locales
    que suben después: `core/data/attachment.service.ts`
    (`prepare/attach/attachPrepared/localUrl/listFor/remove`).
- **Archivos**: inputs nativos como en
  `features/capture/fuel-capture.component.html` (foto con
  `capture="environment"`, o imágenes y PDF), límite `LIMITS.attachmentBytes`.
- **UI**: clases globales en `app/src/styles.scss` (`pst-card`, `pst-list`,
  `pst-row`, `pst-badge--good/warn/bad/brand`, `pst-stat-grid`, `pst-btn`,
  `pst-note`, `pst-empty`), iconos en `shared/icon/icon.component.ts`, hoja
  inferior en `shared/sheet` (fase 1).
- **Pruebas**: `./piston ng test` (vitest + fake-indexeddb, specs junto al
  código). Typecheck con `./piston build`.

---

## Fase 1 · `feature/vehicle-sheet`

**Objetivo**: el apodo del garage abre la hoja del vehículo; desde ahí se
cambia de vehículo y se entra a sus vistas. Primera vista: Datos del vehículo.

### Alcance
- **Hoja inferior genérica** `shared/sheet/sheet.component.ts`: sobre
  `<dialog>` nativo (capa superior, foco atrapado y Esc gratis), con asa,
  cierre al tocar fuera, con Esc o arrastrando hacia abajo, y respeto de
  `safe-area` y `prefers-reduced-motion`.
- **Garage**: el apodo pasa a ser un botón con chevron que abre
  `features/vehicle/vehicle-sheet`. Lleva el badge de atención de
  `VehicleAlerts` cuando haya algo pendiente.
- **Hoja del vehículo**:
  - Con más de un vehículo activo: lista para cambiar (marca el actual) que
    llama a `setPrimary`.
  - Con uno solo: solo se muestra el actual y un enlace a Ajustes para agregar
    más.
  - Debajo, las vistas disponibles. Las de fases futuras no aparecen hasta que
    existan.
- **Datos del vehículo** (`/vehicle`): ficha completa del vehículo en gestión
  y métricas rápidas: rendimiento promedio, gasto mensual promedio, costo por
  km, total gastado, km recorridos y cargas. Botón para editar.
- **Edición** (`/vehicle/edit/:id`): reusa `VehicleFormComponent`; el regreso
  vuelve a `/vehicle` en lugar de a Ajustes.
- `features/vehicle/vehicle-stats.ts`: cálculos puros con spec.
- `core/data/vehicle-alerts.service.ts`: servicio con la forma final
  (`alerts`, `forVehicle(id)`, `count`) pero sin fuentes todavía.

### Criterios de aceptación
- Tocar el apodo abre la hoja; se cierra con el fondo, Esc o arrastre.
- Con dos vehículos, cambiar en la hoja actualiza garage, combustible,
  servicios y gastos, y una carga nueva queda con el `vehicle_id` elegido.
- Datos del vehículo muestra la ficha y las métricas; editar y guardar
  regresa a Datos.

### Fuera de alcance
- Agregar vehículos desde la hoja. Documentos, recordatorios, fotos.

---

## Fase 2 · `feature/vehicle-insurance`

**Objetivo**: guardar la póliza de seguro y avisar un mes antes de que venza.

### Alcance
- **Vista** `/vehicle/insurance` (entrada nueva en la hoja):
  - Póliza vigente: aseguradora (`issuer`), número (`reference`), inciso
    (`policy_item`), número de asegurado (`insured_number`, opcional: no todas
    lo dan), cobertura, inicio
    (`issued_at`), vencimiento (`expires_at`), costo y notas.
  - Teléfonos de siniestro y asistencia como enlaces `tel:`.
  - Archivos adjuntos (PDF, foto de cámara o de galería,
    `owner_type: 'document'`), cada uno con título y notas (ej. "¿Cómo reportar
    un siniestro?" con la imagen de la aseguradora), con vista previa offline.
  - Historial de pólizas anteriores.
- **Formulario** de alta y edición (`/vehicle/insurance/new`,
  `/vehicle/insurance/:id`). Pensarlo genérico por `type` para que la fase 3
  lo reuse.
- **Renovar**: "Marcar como renovada" crea la póliza nueva con su vigencia;
  la anterior queda en historial y deja de alertar. Al renovar se eligen los
  archivos de la anterior que se conservan (se copian a la nueva). Los del
  historial se liberan del dispositivo en cuanto subieron y se ven desde el
  servidor bajo demanda.
- **Línea de tiempo** de vigencias: fechas, aseguradora, número, costo y qué
  cambió contra la anterior, con sus archivos.
- **Esquema**: columnas en `documents` para teléfonos (`contact_phone`,
  `assistance_phone`), `insured_number`, `policy_item` y `renewed_by_id` (la que la
  reemplaza); en `attachments`, `title` y `notes`. Migración
  Laravel, `SyncRegistry`, `domain.ts`, `schema.dbml`.
- **Descarga de adjuntos entre dispositivos**: `GET /api/attachments/{id}/file`
  (solo el dueño, solo si ya subió). El sync baja en cada ciclo los archivos de
  documentos que falten (`AttachmentDownloads`), para que la póliza esté en el
  teléfono antes de necesitarla sin señal. El resto de adjuntos se baja al
  abrirlo. Los blobs de adjuntos borrados en otro dispositivo se liberan.
- `core/data/document-status.ts`: `ok | expiring | expired` con umbral de 30
  días, puro y con spec.
- `VehicleAlerts`: fuente de documentos vigentes (`renewed_by_id` nulo) en
  `expiring` o `expired`. El badge aparece en el apodo del garage, en la hoja
  y en la fila de la vista.

### Criterios de aceptación
- Póliza que vence en 30 días o menos: badge `warn`. Vencida: badge `bad`. El
  badge se queda hasta renovarla.
- El PDF o la foto se ven sin conexión y suben solos.
- Un PDF adjuntado en un dispositivo se ve sin conexión en otro después de
  sincronizar.

---

## Fase 3 · `feature/vehicle-documents`

**Objetivo**: digitalizar el resto de documentos con vigencia y costo.

### Alcance
- **Vista** `/vehicle/documents`: agrupada por tipo: verificación
  (`emissions_check`), tenencia o refrendo (`ownership_tax`), tarjeta de
  circulación (`circulation_card`), licencia (`driver_license`), garantía y
  otro.
- Reusa el formulario, adjuntos, renovación y `document-status` de la fase 2.
- Todos alimentan `VehicleAlerts` igual que la póliza.
- Verificación: sugerir el periodo con `plate_last_digit` y
  `emissions_sticker` si hay un calendario sencillo; si no, captura manual.
  Se usa el calendario semestral de CDMX/Edomex
  (`features/vehicle/emissions-calendar.ts`): el engomado manda y sin él se
  deduce de la placa; propone el vencimiento y siempre se puede editar.
- Vigencia propuesta al renovar (`document-kinds.ts`): verificación 6 meses,
  tenencia 12, tarjeta de circulación 36, licencia 36, garantía 12, otro 12.

### Criterios de aceptación
- Cada tipo se puede agregar, editar, renovar y borrar, con adjuntos.
- Los vencimientos generan badge igual que la póliza.

---

## Fase 4 · `feature/vehicle-reminders`

**Objetivo**: recordatorios configurables, estándar y personalizados, con
bitácora.

### Alcance
- **Esquema** en `reminders`: `repeat_every` (int), `repeat_unit`
  (`day|week|month|year`), `repeat_km` (int, opcional), `repeat_anchor`
  (`done|due`), `notes`, y para la bitácora `done_at` y `done_odometer_km`.
  Migración, `SyncRegistry`, `domain.ts` y `schema.dbml`. Sin versión nueva
  de Dexie: no se indexa nada nuevo.
- **Bitácora = cadena en `reminders`**, como la renovación de documentos:
  marcar hecho cierra la fila (`done`, con fecha, km y notas) y crea la
  siguiente con la misma configuración. Descartar la cierra como
  `dismissed` y el siguiente sigue el calendario original.
- **Ancla**: `done` cuenta el periodo desde que se hizo (aceite cada 2
  meses); `due`, desde el vencimiento anterior, saltando los periodos ya
  pasados (refrendo cada 15 de marzo). Los km cuentan desde el odómetro con
  que se hizo. Lógica pura en `core/data/reminder-schedule.ts`.
- **Vista** `/vehicle/reminders`: próximos, vencidos y bitácora de hechos.
- **Plantillas**: refrendo anual, verificación semestral, revisar aceite cada
  2 meses, anticongelante cada mes, presión de llantas, etc. Todas editables.
- **Personalizados**: por periodo (cada N días/semanas/meses/años o km) o por
  fecha exacta que se repite.
- **Marcar como hecho**: guarda la entrada en la bitácora y calcula la
  siguiente fecha o km con funciones puras con spec.
- Vencidos y próximos (`notify_days_before`/`notify_km_before`) entran a
  `VehicleAlerts`.

### Criterios de aceptación
- Un recordatorio cada 2 meses, marcado hecho hoy, vence en 2 meses.
- Un recordatorio vencido muestra badge hasta marcarse hecho o descartarse.

---

## Fase 5 · `feature/vehicle-alerts`

**Objetivo**: que lo importante avise aunque no se abra la sección.

### Alcance
- **Permiso** de notificaciones en Ajustes, con explicación y estado.
- **Disparo**: al abrir la app (`core/notifications/notification.service.ts`,
  y cada que cambian los avisos con ella abierta) y en el periodic sync del
  service worker (`app/public/piston-sw-alerts.js`). Comparten el Web Lock
  `piston-notify`.
- **Una vez por aviso y dispositivo**, al entrar en su ventana y otra al
  vencer: `VehicleAlert.key` lleva fila, tono y vencimiento, y lo ya
  notificado queda en la tabla local `notified_alerts` (Dexie v5). No se usa
  `last_notified_at` ni `status: 'notified'`: el permiso es por dispositivo y
  cada uno lleva su cuenta. Más de 3 nuevos a la vez salen en un resumen.
- **Granular**: interruptor general y uno por categoría (póliza, documentos,
  recordatorios) en `notification_prefs`, local al dispositivo. Cada
  documento o recordatorio puede apagar la suya con `notify_enabled`
  (columna sincronizada); el badge sale igual.
- El badge sigue visible hasta que se resuelve, aunque ya se haya notificado.
- **Conteo global**: badge en la pestaña Garage y en el icono de la app
  (Badging API) con el total de alertas de todos los vehículos activos, no
  solo el de gestión.
- Tocar la notificación abre la vista correspondiente con `?vehicle=<id>`,
  que cambia al vehículo del aviso y se limpia de la URL.
- El worker no importa TS: `piston-sw-alerts.js` copia la lógica de avisos y
  `notification-parity.spec.ts` corre ambas con los mismos datos.

### Criterios de aceptación
- Una póliza que entra en ventana de 30 días notifica una vez y conserva el
  badge.
- Sin permiso, todo funciona igual con solo badges.

---

## Fase 6 · `feature/vehicle-gallery`

**Objetivo**: fotos del vehículo agrupadas para ver su evolución o desgaste.

### Alcance
- **Esquema**: tabla `vehicle_albums` (`vehicle_id`, `name`, `description`,
  `cover_attachment_id`, `sort_order`) con sync completo (trigger de `rev`,
  `SyncRegistry`, `TABLE_ORDER` antes de `attachments`, Dexie v6), y `album`
  como nuevo `AttachmentOwner` (el CHECK de `owner_type` se recrea). Las fotos
  sin álbum usan `owner_type: 'vehicle'`. `cover_attachment_id` no es FK: el
  adjunto cuelga del álbum y cerraría un ciclo; nula o borrada = la foto más
  reciente.
- **`taken_at`** en `attachments`: cuándo se tomó la foto. Se lee del EXIF
  (`DateTimeOriginal`, luego `DateTimeDigitized` y `DateTime`) y, sin EXIF, de
  la fecha del archivo. Se corrige en el visor. Ordena la galería: una foto
  vieja subida hoy queda en su lugar.
- **Fotos reducidas** antes de guardarse (`core/data/photo-prep.ts`): lado
  largo 2560 px, JPEG 0.85, con `width`/`height`. El EXIF se lee antes de
  reencodar. Si el navegador no puede pintarla (ej. HEIC fuera de Safari) se
  guarda la original.
- **Vistas**: `/vehicle/gallery` (tarjetas de álbum con portada, conteo y
  periodo, y "Sin álbum") y `/vehicle/gallery/:id` (`loose` = sin álbum):
  rejilla de 3 por mes, de la más vieja a la más nueva, subida múltiple o con
  cámara, visor a pantalla completa (flechas, teclado o deslizar) con fecha,
  título, notas, portada y borrar.
- Crear, renombrar y borrar álbumes. **Borrar un álbum no borra fotos**:
  pasan a "Sin álbum". Seleccionar varias para moverlas (solo cambia el dueño
  del adjunto, el archivo no se toca) o borrarlas.
- **Otros dispositivos**: las fotos no son `EAGER_OWNERS`; se bajan al
  mostrarse en la galería y quedan guardadas (`features/vehicle/photo-urls.ts`).
- Un vehículo con álbumes o fotos sueltas cuenta como historial y no se puede
  borrar (se archiva).
- Lógica en `core/data/album.service.ts` con spec.

### Criterios de aceptación
- Las fotos se ven sin conexión y suben solas.
- Un álbum muestra sus fotos en orden de fecha.
