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
