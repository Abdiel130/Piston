# Sesiones y autenticación

Cómo se identifica un usuario en Piston, cómo se mantiene la sesión sin pedir
contraseña en cada acción, y qué pasa cuando no hay red. Todas las respuestas
que se muestran aquí usan el sobre estándar descrito en [api.md](api.md).

## Índice

1. [Principio rector](#principio-rector)
2. [Las tres piezas](#las-tres-piezas)
3. [Cuentas](#cuentas)
4. [Endpoints](#endpoints)
5. [Ciclo de vida de una sesión](#ciclo-de-vida-de-una-sesión)
6. [Rotación y detección de robo](#rotación-y-detección-de-robo)
7. [Defensas del navegador](#defensas-del-navegador)
8. [El cliente](#el-cliente)
9. [Sesión expirada y cola de sincronización](#sesión-expirada-y-cola-de-sincronización)
10. [Cerrar sesión](#cerrar-sesión)
11. [Ventana de sincronización](#ventana-de-sincronización)
12. [Wizard de bienvenida](#wizard-de-bienvenida)
13. [Configuración](#configuración)
14. [Operación](#operación)
15. [Mapa de archivos](#mapa-de-archivos)
16. [Decisiones descartadas](#decisiones-descartadas)

---

## Principio rector

> **Los tokens protegen el servidor, no los datos locales.**

Piston es offline-first: lo que el usuario capturó ya está en IndexedDB, en su
dispositivo. Exigir un token para leerlo sin red no añade seguridad (quien
tiene el teléfono desbloqueado ya tiene los datos) y sí añade fricción: una
app de bitácora que se niega a abrir en una gasolinera sin señal no sirve.

De ahí salen todas las reglas:

- La app **abre sin red y sin token**, con la identidad guardada localmente.
- Un token vencido **pausa el sync, nunca bloquea la app ni borra datos**.
- Lo único que requiere red es el primer login y la sincronización.

No hay biometría ni PIN local: en una PWA no hay un almacén seguro con el que
atarlos (no existe Keystore), y cifrar IndexedDB con una clave que vive en el
mismo navegador sería teatro de seguridad.

## Las tres piezas

| Pieza | Dónde vive | Dura | Qué permite |
|---|---|---|---|
| **Identidad local** (tabla `session` de Dexie) | IndexedDB | Hasta cerrar sesión | Que la app abra y sepa de quién son los datos. **No es un secreto** y no da acceso a nada en el servidor. |
| **Access token** (Sanctum) | **Solo en memoria** del cliente | 15 min | Autorizar cada llamada a la API (`Authorization: Bearer …`). |
| **Refresh token** (propio, opaco) | Cookie `piston_refresh` `HttpOnly` | 60 días, deslizante | Conseguir access tokens nuevos. El JavaScript **nunca** lo ve. |

Es el modelo de dos tokens habitual en apps nativas (access corto + refresh
largo), con una diferencia: en Android el refresh iría al Keystore; en el
navegador, el único lugar donde un XSS no puede leerlo es una cookie
`HttpOnly`.

El access token no se guarda en `localStorage` ni en IndexedDB a propósito:
un XSS no puede robar lo que no está escrito en ningún lado. El precio es que
al recargar la página no hay access token; el cliente pide uno con el refresh
la primera vez que lo necesita.

## Cuentas

**No hay registro público.** Las cuentas se crean en el servidor:

```bash
./artisan piston:user:create                  # asistente interactivo
./artisan piston:user:create ana@correo.com --name="Ana" --password="…"   # para scripts
```

La contraseña inicial se considera temporal: el primer paso del wizard invita
a cambiarla. Tampoco hay recuperación por correo todavía; la reemplaza
`piston:user:password` (ver [Operación](#operación)).

El correo se normaliza a minúsculas y sin espacios en todos los puntos de
entrada (login, comandos), así que `ANA@Correo.com ` y `ana@correo.com` son la
misma cuenta.

## Endpoints

Todas las rutas de `/api/auth/*` exigen el header `X-Piston-Client` (ver
[Defensas](#defensas-del-navegador)) y son las **únicas** que reciben la
cookie del refresh (`Path=/api/auth`).

| Método y ruta | Auth | Límite | Qué hace |
|---|---|---|---|
| `POST /api/auth/login` | — | 5/min por correo + IP | Valida credenciales, abre una familia de refresh, devuelve access token y pone la cookie. |
| `POST /api/auth/refresh` | cookie | 30/min por IP | Rota el refresh y devuelve un access token nuevo. |
| `POST /api/auth/logout` | Bearer | — | Revoca la familia (refresh y sus access tokens) y borra la cookie. |
| `GET /api/me` | Bearer | — | Perfil + estado del wizard. |
| `PATCH /api/me` | Bearer | — | Nombre, `locale`, `currency`, `distance_unit` (`km`/`mi`), `volume_unit` (`L`/`gal`). |
| `PUT /api/me/password` | Bearer | 5/min | Cambia la contraseña; **cierra las otras sesiones**, conserva la actual. |
| `PUT /api/me/onboarding` | Bearer | — | Guarda paso y borrador del wizard (last-write-wins). |
| `POST /api/me/onboarding/complete` | Bearer | — | Cierra el wizard. Definitivo. |

### Login y refresh

```http
POST /api/auth/login
X-Piston-Client: web
Content-Type: application/json

{ "email": "ana@correo.com", "password": "…", "device_name": "Piston · Android" }
```

```json
{
  "success": true,
  "code": "ok",
  "message": "Listo.",
  "data": {
    "access_token": "12|Xk…",
    "token_type": "Bearer",
    "expires_in": 900,
    "expires_at": "2026-09-28T10:15:00.000Z",
    "user": {
      "id": "01a0…",
      "name": "Ana",
      "email": "ana@correo.com",
      "locale": "es-MX",
      "currency": "MXN",
      "distance_unit": "km",
      "volume_unit": "L",
      "onboarding": { "step": "account", "draft": null, "updated_at": null, "completed_at": null }
    }
  },
  "meta": { "request_id": "01a0…", "timestamp": "2026-09-28T10:00:00.000Z" }
}
```

```http
Set-Cookie: piston_refresh=<64 caracteres>; expires=…; path=/api/auth; httponly; samesite=strict[; secure]
```

`refresh` responde exactamente lo mismo, con una cookie nueva.

### Códigos que el cliente debe distinguir

| `code` | HTTP | Significa | Qué hace el cliente |
|---|---|---|---|
| `invalid_credentials` | 422 | Correo o contraseña incorrectos (mismo mensaje en ambos casos, para no revelar qué correos existen). | Muestra `errors.email[0]`. |
| `unauthenticated` | 401 | Access token ausente, vencido o revocado. | Refresca una vez y reintenta. |
| `refresh_invalid` | 401 | No hay cookie, expiró, se cerró la sesión o se detectó reuso. El motivo concreto no se revela. | Pasa a estado `expired`. **No borra nada.** |
| `refresh_race` | 409 | El refresh se acaba de rotar (otra pestaña). | Reintenta una vez: el navegador ya tiene la cookie nueva. |
| `client_header_missing` | 403 | Falta `X-Piston-Client`. | Es un bug del cliente. |
| `too_many_requests` | 429 | Límite alcanzado. `meta.retry_after` dice cuántos segundos esperar. | Lo muestra. |

## Ciclo de vida de una sesión

```
 login ──► familia F abierta ──► refresh ──► refresh ──► … ──► logout / revoke / 60 días sin uso
             │                     │           │
             └ access #1 (15 min)  └ access #2 └ access #3
```

- **Familia**: todo lo que nace de un login. Cada dispositivo tiene la suya;
  cerrar sesión en el teléfono no afecta a la laptop.
- **Deslizante**: cada refresh reinicia los 60 días. Quien abre la app al
  menos una vez cada dos meses no vuelve a escribir su contraseña.
- **Revocar una familia** marca sus refresh como revocados y **borra en el
  acto sus access tokens** (`personal_access_tokens.refresh_family_id`), sin
  esperar a que venzan solos.

### Qué cierra qué

| Acción | Sesión actual | Otras sesiones |
|---|---|---|
| `POST /api/auth/logout` | Cerrada | Intactas |
| `PUT /api/me/password` | **Sigue viva** | Cerradas |
| `piston:user:password` | Cerrada | Cerradas |
| `piston:user:revoke` | Cerrada | Cerradas |
| Reuso de un refresh rotado | Toda **esa familia** cerrada | Intactas |

## Rotación y detección de robo

Cada refresh **revoca el token usado** (`revoked_at` + `replaced_at`) y emite
otro de la misma familia. En la base solo se guarda el **hash SHA-256**; el
valor en claro existe únicamente en la cookie.

Cuando llega un refresh que ya estaba revocado, `TokenIssuer::rotate` decide:

| Situación | Interpretación | Respuesta |
|---|---|---|
| Revocado por logout (`replaced_at` nulo) | Sesión cerrada | `refresh_invalid` |
| Rotado hace ≤ 10 s | Carrera entre dos pestañas | `refresh_race` (409), la familia sigue viva |
| Rotado hace > 10 s | **Alguien guardó una copia** | Se revoca **toda la familia** y `refresh_invalid` |

El tercer caso es el que da valor a la rotación: si un atacante copia la
cookie y la usa, el siguiente refresh del dueño legítimo (o del atacante,
quien llegue segundo) presenta un token ya rotado, y ambos quedan fuera. El
dueño vuelve a iniciar sesión; el atacante no puede.

> **Detalle de implementación que importa:** la revocación por reuso se
> ejecuta **después** de cerrar la transacción. Si se hiciera dentro, la
> excepción que responde `refresh_invalid` desharía también la revocación.
> Hay un test para esto (`RefreshTest::test_reuse_after_grace_window_revokes_the_whole_family`).

## Defensas del navegador

**Cookie del refresh**

- `HttpOnly`: el JavaScript no puede leerla; un XSS no se la lleva.
- `SameSite=Strict`: el navegador no la manda en peticiones iniciadas desde
  otro sitio.
- `Path=/api/auth`: no viaja al resto de la API, así que ningún otro endpoint
  puede confundirse y aceptarla como credencial.
- `Secure`: obligatoria en producción (se fuerza por código; ver
  [Configuración](#configuración)).

**CSRF.** La cookie es la única credencial ambiental, y solo abre
`/api/auth/*`. Esas rutas exigen el header `X-Piston-Client`: un formulario de
otro sitio no puede poner headers propios, y un `fetch` que lo intente dispara
un preflight de CORS que solo aceptan los orígenes de `config/cors.php`.
Junto con `SameSite=Strict` son dos capas independientes.

**Enumeración de cuentas.** Login responde igual para "no existe" y
"contraseña incorrecta".

**Fuerza bruta.** Login y cambio de contraseña: 5 intentos por minuto por
correo + IP. Por correo solo, un atacante podría bloquear a propósito la
cuenta de otro; por IP sola, rotar correos no le costaría nada.

## El cliente

Archivos en `app/src/app/core/auth/`.

### Estados (`AuthService.state`)

| Estado | Significa | La app | El sync |
|---|---|---|---|
| `unknown` | Aún no se lee IndexedDB (solo al arrancar) | — | — |
| `anonymous` | El dispositivo no tiene dueño | Solo `/login` | Parado |
| `authenticated` | Hay dueño y su sesión vive (puede no haber access token en memoria todavía) | Funciona | Corre |
| `expired` | El servidor rechazó el refresh | **Funciona**, con un aviso | Pausado |

### Obtener un token

`accessTokenFor()` devuelve el access token en memoria si le queda más de un
minuto; si no, llama a `refresh()`. Nunca lanza: sin red o con la sesión
vencida devuelve `null`, la petición sale sin token y el 401 hace el resto.

`refresh()` es **single-flight en dos niveles**:

1. Dentro de la pestaña, llamadas simultáneas comparten la misma promesa.
2. Entre pestañas, se serializa con un **Web Lock** (`navigator.locks`,
   nombre `piston-refresh`). Sin él, dos pestañas mandarían el mismo refresh y
   la segunda parecería un robo. Con él, la segunda espera y sale con la
   cookie ya rotada.

Si el navegador no tiene Web Locks, la ventana de gracia de 10 s del servidor
cubre la carrera.

### Interceptor (`auth.interceptor.ts`)

- Añade `X-Piston-Client` a toda petición a la API.
- En `/api/auth/*` activa `withCredentials` (lo que hace viajar la cookie) y
  **no** pone Bearer.
- En el resto pone el Bearer; ante un 401 refresca **una sola vez** y
  reintenta. Si el refresh también falla, el 401 sube (sin bucles).

### Guardas de ruta (`guards.ts`)

Ninguna espera a la red: leen signals e IndexedDB.

| Guarda | Deja pasar si… | Si no, a… |
|---|---|---|
| `authGuard` | hay sesión (`authenticated` o `expired`) | `/login` |
| `guestGuard` | no hay sesión viva (`anonymous` o `expired`) | `/` |
| `onboardingGuard` | el wizard no está terminado | `/` |
| `onboardedGuard` | el wizard está terminado | `/welcome` |

### Cambio de cuenta

`login()` compara el `user_id` que devuelve el servidor con la sesión local:

- **Misma cuenta**: continúa (es el caso de volver a entrar tras `expired`).
- **Otra cuenta y el dispositivo tiene datos** (vehículos o cola): rechaza con
  `AccountMismatchError` y cierra en el servidor la sesión que se le acababa de
  abrir a la otra cuenta. Mezclar datos de dos personas no se permite.
- **Otra cuenta sin datos**: limpia lo local y continúa.

Con la sesión expirada, la pantalla de login fija el correo en el de la
cuenta dueña del dispositivo.

## Sesión expirada y cola de sincronización

Un 401 del servidor **no es un rechazo de la fila ni un fallo transitorio**:
la mutación es válida y el servidor está bien, solo falta volver a firmar. Por
eso `ApiService` lo convierte en `AuthRequiredError`, distinto de
`PermanentApiError` y `RetriableApiError`, y `SyncService`:

- no cuenta el intento (`attempts` no sube),
- no marca la mutación como `failed`,
- deja el estado del sync en `unauthorized`,
- y no vuelve a intentar hasta que haya sesión.

Tras el nuevo login, la cola sale tal cual estaba.

> Antes de esto, un 401 se trataba como error definitivo: al vencer la
> sesión, el sync habría marcado como fallido **todo** el outbox.

## Cerrar sesión

Cerrar sesión **borra la base local** (un usuario por dispositivo). Por eso
solo se permite cuando el servidor ya tiene todo. `SyncService.logoutBlocker`
dice por qué no, en este orden:

| Bloqueo | Motivo |
|---|---|
| `expired` | Hay que volver a iniciar sesión para enviar lo pendiente. |
| `offline` | Hace falta red para confirmar que todo se envió. |
| `syncing` | Hay un ciclo en curso. |
| `failed` | Hay mutaciones que el servidor rechazó; perderlas sería perder datos. |
| `pending` | Hay cambios en la cola. |
| `uploads` | Hay fotos sin subir. |

El flujo en Ajustes: `sync()`, volver a comprobar (otra pestaña pudo encolar
algo), `POST /api/auth/logout`, vaciar todas las tablas de Dexie y navegar a
`/login`.

**Salida de emergencia.** Si la cuenta no se puede recuperar (se olvidó la
contraseña y no hay acceso al servidor), Ajustes ofrece "Descartar datos y
salir", que exige escribir `BORRAR`. Es la única forma de perder datos no
enviados, y es explícita.

## Ventana de sincronización

`shared/sync-gate/` aparece **después de cada login** (también tras
`expired`). Sube lo pendiente, baja lo de otros dispositivos y solo entonces
decide adónde ir: el wizard pudo haberse terminado en otro teléfono.

Nunca atrapa al usuario: si el servidor no responde, ofrece reintentar o
continuar sin sincronizar, y el motor seguirá intentando en segundo plano.

Al terminar siembra el catálogo (tipos de servicio y categorías de gasto)
**solo si el pull no trajo nada**. Sembrar antes duplicaría en un segundo
dispositivo el catálogo que ya existe en el servidor.

## Wizard de bienvenida

`/welcome`, cinco pasos: `account`, `vehicle`, `tank`, `purchase`,
`review` (y `done` al terminar).

**Persistencia en dos niveles.** Cada cambio se escribe al instante en la
tabla `onboarding` de Dexie y se sube con debounce a `PUT /api/me/onboarding`.
Así se puede cerrar la app a medias (el caso pensado: salir al coche a contar
las rayitas del medidor) y volver al mismo paso, incluso desde otro
dispositivo.

**Conflictos.** Gana el `updated_at` del cliente más reciente, con dos
excepciones: si el servidor ya dice `done`, el wizard queda cerrado aunque lo
local sea más nuevo; y si lo local no tiene cambios sin subir, se adopta lo
del servidor. El servidor ignora escrituras más viejas que la que tiene y
responde su estado vigente para que el cliente lo adopte.

**Qué nunca entra al borrador**: la contraseña. El borrador se guarda en
claro en el servidor. El cambio de contraseña del primer paso va directo a
`PUT /api/me/password` y necesita red.

**Sin filas a medias.** Ninguna fila de dominio se crea hasta el último paso,
donde una sola transacción crea el vehículo (`is_primary`), su primera lectura
de odómetro y marca el wizard como `done`. Un vehículo a medias en el outbox
viajaría al servidor y aparecería en otros dispositivos.

## Configuración

`server/config/piston.php`, sobrescribible por `.env`:

| Variable | Por defecto | Notas |
|---|---|---|
| `AUTH_ACCESS_TTL` | `15` | Minutos del access token. |
| `AUTH_REFRESH_TTL_DAYS` | `60` | Días del refresh, deslizante. |
| `AUTH_REUSE_GRACE_SECONDS` | `10` | Ventana de "carrera, no robo". |
| `AUTH_COOKIE_SECURE` | `false` | Solo aplica fuera de producción. Con `APP_ENV=production` la cookie es **siempre** `Secure`, diga lo que diga esta variable. |

Por qué `Secure` es configurable en desarrollo: al probar desde el teléfono
por la red local (`http://192.168.x.x`) el navegador no guarda cookies
`Secure` en HTTP, y sin cookie no hay refresh.

En desarrollo el front (`:4300`) y la API (`:8088`) están en distinto puerto
pero **mismo sitio** (mismo host), así que `SameSite=Strict` deja pasar la
cookie. En producción comparten origen.

**Probar desde el celular.** La app calcula la URL de la API en tiempo de
ejecución (`http://<host con el que abriste la app>:8088`), así que funciona
igual con `localhost` que con la IP de la PC. Del lado del backend, con
`APP_ENV=local`, CORS acepta cualquier origen de red privada (`10.x`,
`172.16–31.x`, `192.168.x`) en el puerto 4300 (`allowed_origins_patterns` en
`config/cors.php`). En producción ese patrón queda vacío.

Una página servida por `http://192.168.x.x` **no** es un contexto seguro para
el navegador, así que ahí no existen `navigator.locks` ni `crypto.subtle`. El
refresh lo tolera (sin Web Locks cae en la ventana de gracia del servidor);
para probar adjuntos desde el celular hará falta HTTPS en desarrollo.

## Operación

| Comando | Qué hace |
|---|---|
| `./artisan piston:user:create [email] [--name=] [--password=]` | Crea una cuenta. Sin argumentos abre un asistente (valida al escribir, pide la contraseña dos veces y confirma al final). |
| `./artisan piston:user:password [email] [--password=]` | Cambia la contraseña y cierra **todas** las sesiones. Sin correo, abre un buscador de cuentas. |
| `./artisan piston:user:revoke [email]` | Cierra todas las sesiones, p. ej. por un teléfono perdido. Sin correo, buscador + confirmación. |
| `./artisan piston:auth:prune [--days=7]` | Borra refresh tokens expirados o revocados hace más de N días. |

El scheduler (`routes/console.php`) corre a diario `sanctum:prune-expired
--hours=24` y `piston:auth:prune`. Los refresh revocados se conservan 7 días
porque son los que permiten detectar un reuso.

**Teléfono perdido.** `piston:user:revoke` corta el acceso al servidor en el
acto. Los datos que ya estaban en ese dispositivo no se pueden borrar a
distancia: es la contraparte de que la app funcione sin red.

## Mapa de archivos

**Backend** (`server/`)

| Archivo | Responsabilidad |
|---|---|
| `app/Services/Auth/TokenIssuer.php` | Emitir, rotar y revocar pares. Toda la política de sesiones. |
| `app/Services/Auth/{IssuedTokens,InvalidRefreshToken,RefreshTokenRace}.php` | Resultado y errores del servicio (sin nada de HTTP). |
| `app/Models/RefreshToken.php` | Eslabón de una familia; solo guarda el hash. |
| `app/Http/Cookies/RefreshCookie.php` | Único lugar que conoce la forma de la cookie. |
| `app/Http/Controllers/Auth/*` | Login, refresh, logout. |
| `app/Http/Controllers/{Me,Onboarding}Controller.php` | Perfil, contraseña y wizard. |
| `app/Http/Resources/{Session,User}Resource.php` | Forma de `data` en las respuestas. |
| `app/Http/Middleware/EnsurePistonClient.php` | Defensa CSRF de `/api/auth/*`. |
| `app/Console/Commands/*User*.php`, `PruneRefreshTokens.php` | Operación. |
| `config/piston.php` | TTL, gracia, cookie. |
| `tests/Feature/Auth/*` | Login, refresh, logout, perfil, wizard y comandos. |

**Frontend** (`app/src/app/`)

| Archivo | Responsabilidad |
|---|---|
| `core/auth/auth.service.ts` | Estado de sesión, login/refresh/logout, access token en memoria. |
| `core/auth/auth.interceptor.ts` | Bearer, header del cliente, cookie y reintento ante 401. |
| `core/auth/guards.ts` | Login, wizard y pestañas. |
| `core/auth/onboarding.service.ts` | Borrador del wizard: local primero, servidor después. |
| `core/auth/local-data.ts` | Vaciar y comprobar la base local. |
| `core/sync/sync.service.ts` | Pausa por 401, `progress`, `logoutBlocker`. |
| `shared/sync-gate/` | Ventana de sincronización post-login. |
| `features/auth/`, `features/onboarding/` | Pantallas. |
| `features/settings/` | Cuenta, cierre de sesión y salida de emergencia. |

## Decisiones descartadas

| Alternativa | Por qué no |
|---|---|
| Sesión con cookie de Sanctum (modo SPA) | Más simple, pero una sola cookie de sesión no distingue dispositivos, no rota y no detecta robo. Y ata la API a un único front. |
| Refresh token en IndexedDB | Cualquier XSS lo lee y se lo lleva con 60 días de validez. |
| Access token en `localStorage` | Mismo problema, con menos impacto; guardarlo no aporta nada porque se renueva en un segundo. |
| PIN o biometría local | En una PWA no hay almacén seguro donde anclarlos; protegerían datos que ya están en el dispositivo sin cifrar. |
| Borrar datos al expirar la sesión | Perdería cambios que el usuario ya dio por guardados, justo en el escenario (sin red durante semanas) para el que existe la app. |
| Registro público | Uso personal/familiar; las cuentas las crea quien administra el servidor. |
