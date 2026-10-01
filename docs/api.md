# Respuestas de la API

Todas las respuestas JSON de la API, de éxito o de error, las escriba un
controlador o las genere el framework (404, 405, 429, 500), usan el mismo
sobre. El cliente nunca tiene que adivinar la forma.

## El sobre

```json
{
  "success": true,
  "code": "ok",
  "message": "Listo.",
  "data": { "…": "…" },
  "meta": {
    "request_id": "01a0eafc-0e59-731d-8dc5-88daa9564186",
    "timestamp": "2026-09-28T10:00:00.000Z"
  }
}
```

| Campo | Siempre | Qué es |
|---|---|---|
| `success` | Sí | `true` si el status HTTP es < 400. Sale del código, nunca se escribe a mano. |
| `code` | Sí | Resultado **estable y legible por máquina** (ver catálogo). El cliente decide por aquí. |
| `message` | Sí | Texto para humanos, en español. Puede cambiar; no se compara contra él. |
| `data` | Sí | La carga útil. `null` en errores y en acciones sin resultado (logout). |
| `errors` | Solo en validación | `{ "campo": ["mensaje", …] }`. Mismo formato que Laravel. |
| `meta.request_id` | Sí | Id de la petición; igual al header `X-Request-Id` y a los logs. |
| `meta.timestamp` | Sí | Hora del servidor, ISO 8601 UTC con milisegundos. |
| `meta.retry_after` | Solo en 429 | Segundos a esperar. También va en el header `Retry-After`. |

Error de validación:

```json
{
  "success": false,
  "code": "validation_failed",
  "message": "The currency field must be 3 characters.",
  "data": null,
  "errors": { "currency": ["The currency field must be 3 characters."] },
  "meta": { "request_id": "…", "timestamp": "…" }
}
```

## Catálogo de códigos

Definido en `server/app/Http/Responses/ApiCode.php` y reflejado en
`app/src/app/core/models/api.ts`. Cada caso sabe su status HTTP y su mensaje
por defecto.

| `code` | HTTP | Mensaje por defecto |
|---|---|---|
| `ok` | 200 | Listo. |
| `created` | 201 | Creado. |
| `bad_request` | 400 | La petición no es válida. |
| `validation_failed` | 422 | Hay datos que corregir. |
| `invalid_credentials` | 422 | El correo o la contraseña no son correctos. |
| `unauthenticated` | 401 | Sesión no válida o expirada. |
| `refresh_invalid` | 401 | No hay sesión que renovar. |
| `client_header_missing` | 403 | Cliente no reconocido. |
| `forbidden` | 403 | No tienes permiso para esto. |
| `not_found` | 404 | No existe. |
| `method_not_allowed` | 405 | Método no permitido. |
| `refresh_race` | 409 | La sesión se acaba de renovar; reintenta. |
| `conflict` | 409 | El recurso cambió; vuelve a intentarlo. |
| `payload_too_large` | 413 | El envío es demasiado grande. |
| `too_many_requests` | 429 | Demasiadas peticiones. Espera un momento. |
| `parent_missing` | 409 | El registro del que depende todavía no existe en el servidor. |
| `parent_deleted` | 409 | El registro del que depende se borró en otro dispositivo. |
| `unknown_table` | 400 | El servidor no reconoce ese tipo de registro. |
| `server_error` | 500 | Algo falló en el servidor. |
| `service_unavailable` | 503 | El servicio no está disponible por ahora. |

Los códigos de auth (`unauthenticated`, `refresh_invalid`, `refresh_race`…)
y qué debe hacer el cliente con cada uno están en [auth.md](auth.md#códigos-que-el-cliente-debe-distinguir).

## Qué nunca sale en una respuesta

- Trazas, nombre de la clase de la excepción, archivo o línea.
- El texto de una excepción no controlada (puede traer SQL, hosts o usuarios).
- Versiones de PHP, Laravel o del motor de base de datos.

Esto se cumple **aunque `APP_DEBUG=true`**: el renderer del sobre reemplaza al
de Laravel en toda ruta `api/*`. El detalle completo queda en el log con el
mismo `request_id` que recibe el cliente, así que un error reportado se puede
rastrear sin haber expuesto nada.

## `/api/health`: solo desde el propio servidor

El middleware `LocalOnly` deja pasar la petición únicamente si:

1. `REMOTE_ADDR` es loopback (`127.0.0.0/8` o `::1`). Se lee directo del
   servidor y no de `$request->ip()`, que obedece a `TrustProxies`: si algún
   día se configura un proxy de confianza, un `X-Forwarded-For: 127.0.0.1`
   falsificado no debe colar.
2. **No** trae headers de reenvío (`X-Forwarded-For`, `X-Forwarded-Host`,
   `X-Real-IP`, `Forwarded`, `Client-IP`). Un proxy inverso en el mismo host
   se conecta desde 127.0.0.1; sin esta regla, todo el tráfico externo que
   pase por él parecería local.

A cualquier otro se le responde **404 `not_found`**, no 403: ni siquiera se
confirma que la ruta exista. La ruta pública `/up` que Laravel trae por
defecto se eliminó por la misma razón.

Consultarlo:

```bash
./piston health   # curl desde DENTRO del contenedor a 127.0.0.1:8000
```

Desde el host no sirve `curl localhost:8088/api/health`: dentro de Docker la
petición llega con la IP del bridge (`172.x`), no con la de loopback.

La respuesta tampoco dice nada que ayude a atacar si algún día se expusiera
por error: solo `status`, `service`, `version` y `database`
(`connected`/`disconnected`). Si la base no responde contesta 503 con
`code: service_unavailable` y el mismo `data`; el error real va al log.

## Request id

`AssignRequestId` (middleware global) asigna un UUIDv7 a cada petición y lo
pone en el header `X-Request-Id`, en `meta.request_id` y en el contexto de
**todos** los logs de esa petición.

Si el cliente manda su propio `X-Request-Id`, se reutiliza **solo si es un
UUID válido**. Cualquier otra cosa se descarta, para que nadie pueda inyectar
texto arbitrario (saltos de línea, entradas falsas) en los logs.

El header está en `exposed_headers` de CORS, así que el front puede leerlo.

El cliente genera un `X-Request-Id` propio en **cada** petición. Así conoce el
id aunque la respuesta nunca llegue (timeout, servidor caído) y lo muestra en
el detalle de un cambio no sincronizado. Los rechazos del sync se registran en
`storage/logs/sync-AAAA-MM-DD.log` y los 500 en `laravel.log`, ambos con ese id.

## Sincronización

Todas exigen `auth:sanctum` y `throttle:sync` (120/min por cuenta). La lógica
vive en `server/app/Sync/`; `SyncRegistry` es la única fuente de las 20 tablas,
sus columnas escribibles, reglas y dueño.

### `POST /api/sync`: push

```json
{ "mutations": [
  { "table": "fuel_entries", "id": "<uuidv7>", "op": "insert|update|delete",
    "payload": { "...fila completa...", "client_updated_at": "2026-09-28T14:03:00.123Z" },
    "base_rev": 811,
    "base": { "...la fila tal como estaba antes del primer cambio local..." },
    "resolve": "restore" }
] }
```

- `base_rev`: el `rev` de la fila cuando el cliente empezó a editarla (`0` si
  es nueva). Sin él, la mutación usa el last-write-wins anterior (ver abajo).
- `base`: la fila que vio el cliente. Con ella el servidor sabe qué campos
  cambió cada lado. `null` en una fila nueva.
- `resolve`: solo `"restore"`, y solo desde la resolución de un conflicto
  `edit_delete`. Es la única forma de resucitar un tombstone.

Responde `200` con:

```json
{ "applied":  [{ "table": "fuel_entries", "id": "…", "rev": 812, "stale": false,
                 "row": { "...la fila como quedó..." }, "merged": ["notes"] }],
  "rejected": [{ "table": "…", "id": "…", "code": "validation_failed",
                 "message": "…", "errors": { "liters": ["…"] } }],
  "server_rev": 812 }
```

- **Aislamiento.** Cada mutación corre en un SAVEPOINT; una fila rechazada no
  afecta al resto del lote.
- **Idempotente.** El insert es upsert por UUID; borrar lo inexistente es un
  no-op (`rev: 0`). Reenviar un lote tras un timeout es seguro.
- **`row`** es la fila guardada, ya con su `rev`. Si hubo mezcla, es la
  versión combinada: el cliente la guarda sin esperar al pull. `merged` lista
  los campos que se conservaron del servidor.
- **Dueño.** `user_id` lo pone el servidor. Los catálogos con `user_id` NULL
  son del sistema: se leen, no se escriben. Las tablas hijas sin `user_id`
  pertenecen al dueño del padre.
- **Rechazos** (`rejected[].code`): `validation_failed` (con `errors` por campo),
  `forbidden` (fila o FK de otra cuenta), `parent_missing` (el padre no ha
  llegado; el cliente lo reintenta cuando el padre suba), `parent_deleted`
  (ver abajo), `conflict` (con `conflict`: dos ediciones que chocan; sin él:
  duplicado por un índice único), `unknown_table`.
- **Decimales.** Un decimal con arrastre binario (`0.30000000000000004`) se
  redondea a la escala de la columna antes de validar. Uno con más decimales de
  verdad (`41.555` en una columna de 2) sigue siendo `validation_failed`.
- Más de 500 mutaciones: `413 payload_too_large` (el cliente parte el lote).
- `server_rev` es informativo. **No** es un cursor: adelantar el cursor con él
  se saltaría cambios de otros dispositivos que aún no se han jalado.

#### Conflictos

El servidor compara `base_rev` con el `rev` actual de la fila. El reloj del
dispositivo (`client_updated_at`) ya no decide nada; se guarda solo como dato.

| Situación | Resultado |
|---|---|
| Fila nueva, o `base_rev` igual al `rev` actual | Se aplica. |
| Otro dispositivo cambió campos distintos | Se mezcla por campo y se aplica (`merged`). |
| Los dos cambiaron el mismo campo al mismo valor | Se aplica; no hay nada que decidir. |
| Los dos cambiaron el mismo campo a valores distintos | `conflict`, `kind: edit_edit`. No se aplica nada de esa mutación. |
| Edito algo que otro dispositivo borró | `conflict`, `kind: edit_delete`. |
| Borro algo que otro dispositivo editó después de mi base | `conflict`, `kind: edit_delete`. |
| Creo o muevo un hijo hacia un padre con tombstone | `parent_deleted`, `kind: create_in_deleted_parent`. |
| Insert con `base_rev: 0` sobre una fila que ya existe | Se aplica: es el mismo dispositivo reenviando tras un timeout. |

La mezcla compara solo las columnas escribibles de `SyncRegistry` que trae el
payload, normalizadas por tipo (`12.5` y `"12.50"` son el mismo decimal; las
fechas se comparan a milisegundos en UTC).

```json
{ "table": "vehicles", "id": "…", "code": "conflict", "message": "…",
  "conflict": { "kind": "edit_edit", "fields": ["license_plate"],
                "server_row": { "…" }, "server_rev": 931 } }
```

- `edit_edit`: `fields` son los campos que chocan.
- `edit_delete`: `fields` son los campos que cambió quien editó.
  `server_row` es la fila del servidor (el tombstone, si se borró allá).
- `create_in_deleted_parent`: `fields` es la columna de la referencia,
  `server_row` es el **padre** borrado y `parent` es `{ table, id }`. Las
  referencias que la fila ya tenía no se revisan: editar las notas de una carga
  cuya gasolinera se borró sigue siendo válido.

Resolver desde el cliente:

- **Conservar la mía:** reenviar con `base_rev = server_rev` y
  `base = server_row`, con el payload construido sobre `server_row` más mis
  campos. Ya no choca.
- **Restaurar con mis cambios:** `op: insert`, `resolve: "restore"`,
  `base_rev` = el `rev` del tombstone. Con otro `base_rev` vuelve a ser
  conflicto.

Cada conflicto se registra en el canal `sync` como `sync.conflict` y cada
mezcla automática como `sync.merged`.

**Compatibilidad.** Una mutación sin `base_rev` (outbox de un cliente
anterior) mantiene el last-write-wins: si la fila guardada tiene un
`client_updated_at` más reciente, no se pisa (`stale: true`), y un tombstone
gana siempre.

### `GET /api/sync?since=<rev>&limit=<n>`: pull

`limit` por defecto 500, máximo 1000. Responde
`{ changes: { tabla: [filas…] }, server_rev, has_more }`.

- Las filas de las 20 tablas se mezclan por `rev` y se cortan en ese orden;
  `server_rev` es el `rev` de la última fila entregada. Con `has_more` se
  vuelve a pedir desde `server_rev`.
- Incluye tombstones (`deleted_at` no nulo).
- Números como números, fechas `YYYY-MM-DD`, timestamps en el formato de
  `toISOString()` (`…T14:03:00.123Z`).
- Un lock consultivo por cuenta (exclusivo en push, compartido en pull) evita
  que un pull entregue un `rev` alto mientras otro más bajo sigue sin confirmar.

### `GET /api/sync/{table}/{id}`

La versión del servidor de una fila (`{ table, row }`), tombstone incluido.
`404` si nunca llegó. La usa "Descartar cambio" para restaurar.

### `POST /api/attachments/{id}/file`

Multipart con `file`. Verifica el `checksum` (sha256) de la fila si lo tiene,
guarda en el disco `local` y marca `upload_status = uploaded`. Idempotente.
`404` si la fila del adjunto todavía no llegó (el cliente reintenta),
`413` si excede `SYNC_ATTACHMENT_MAX_KB` (15 MB por defecto).

## Uso en el backend

La pieza central es `App\Http\Responses\ApiResponse`: inmutable, implementa
`Responsable` (se devuelve tal cual desde un controlador) y cada `with*`
devuelve una copia.

```php
use App\Http\Responses\ApiCode;
use App\Http\Responses\ApiResponse;

// Éxito con datos (acepta JsonResource, Arrayable, JsonSerializable o arreglos).
return ApiResponse::success(new UserResource($user));

// Éxito con mensaje propio y sin datos.
return ApiResponse::success(message: 'Sesión cerrada.');

// 201.
return ApiResponse::created(new VehicleResource($vehicle));

// Error del catálogo, con su status y mensaje por defecto.
return ApiResponse::error(ApiCode::Conflict);

// Extras: meta, headers, cookies, datos en un error.
return ApiResponse::success($data)
    ->withMeta(['next_cursor' => 42])
    ->withHeaders(['Cache-Control' => 'no-store'])
    ->withCookie($cookie);
```

Para cortar un flujo desde cualquier punto (controlador, form request,
middleware), se lanza una `ApiException`; el renderer la convierte en su
respuesta:

```php
use App\Exceptions\ApiException;

throw ApiException::of(ApiCode::Conflict, 'El vehículo ya existe.');
throw ApiException::of(ApiCode::InvalidCredentials, errors: ['email' => ['…']]);
```

Lo que lance el framework se traduce solo en `ApiExceptionRenderer`:

| Excepción | `code` |
|---|---|
| `ApiException` | El suyo |
| `ValidationException` | `validation_failed` + `errors` |
| `AuthenticationException` | `unauthenticated` |
| `AuthorizationException` | `forbidden` |
| `ModelNotFoundException` | `not_found` |
| `ThrottleRequestsException` | `too_many_requests` + `meta.retry_after` + `Retry-After` |
| Otra `HttpException` | Según su status (`ApiCode::fromStatus`), con mensaje genérico |
| Cualquier otra | `server_error`, mensaje genérico, detalle solo al log |

### Cómo extenderlo

- **Un resultado nuevo**: agrega un caso a `ApiCode` con su `status()` y su
  `message()`, y el mismo valor al tipo `ApiCode` del front. Nada más cambia
  (abierto a extensión, cerrado a modificación).
- **Traducir una excepción nueva**: agrega una rama en
  `ApiExceptionRenderer::render`. O mejor: si es tuya, haz que extienda
  `ApiException`.
- **Una forma de `data` nueva**: un `JsonResource` con `$wrap = null`; el
  sobre ya se encarga de envolverlo.

### Reparto de responsabilidades

| Clase | Única responsabilidad |
|---|---|
| `ApiCode` | Catálogo: código, status HTTP y mensaje por defecto. |
| `ApiResponse` | Dar forma al sobre y convertirlo en respuesta HTTP. |
| `ApiException` | Transportar un resultado del catálogo desde donde se detecta el error. |
| `ApiExceptionRenderer` | Traducir excepciones a resultados y ocultar internals. |
| `AssignRequestId` | Dar identidad a la petición para correlacionarla. |
| `LocalOnly` | Restringir una ruta al propio servidor. |
| `*Resource` | La forma de cada entidad dentro de `data`. |

Los servicios de dominio (p. ej. `TokenIssuer`) **no conocen** nada de esto:
lanzan sus propias excepciones y es el controlador quien decide qué `ApiCode`
les corresponde.

## Uso en el frontend

- Tipos en `core/models/api.ts`: `ApiEnvelope<T>`, `ApiCode`, `ApiMeta` y el
  guard `isApiErrorBody()`.
- `ApiService` desenvuelve `data` y, en error, arma `PermanentApiError` /
  `RetriableApiError` con el `message`, el `code` y los `errors` del sobre.
  Un 401 se convierte en `AuthRequiredError`.
- Si quien respondió no es la API (un proxy con HTML, por ejemplo),
  `isApiErrorBody()` da `false` y solo se usa el status HTTP.
