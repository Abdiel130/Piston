# Piston

> **Gestión Vehicular Inteligente, Control de Combustible y Mantenimientos Offline-First**

**Piston** es una aplicación moderna y personal para el seguimiento de vehículos, servicios, gastos mecánicos y recargas de combustible. Nace para solucionar las limitaciones de herramientas tradicionales como Drivvo (por ejemplo, permitir calcular el rendimiento km/L en base a la capacidad del tanque y las **"rayitas"** de combustible sin obligar a llenar el tanque completo, además de integrar monitoreo comunitario de precios en gasolineras estilo Waze).

---

## Stack Tecnológico

| Capa | Tecnología | Versión | Contenedor Docker | Puerto Host Asignado |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | Angular + Signals + PWA | **`22.x`** (`22.1.8`) | `piston-app` | **`4300`** |
| **Backend REST API** | Laravel (Sanctum) | **`13.x`** (`13.31.0`) | `piston-server` | **`8088`** |
| **Entorno PHP** | PHP CLI / FPM | **`8.5`** (`8.5.10`) | `piston-server` | *(Interno 8000)* |
| **Base de Datos** | PostgreSQL Alpine | **`18.x`** (`18.6`) | `piston-db` | **`5438`** *(Interno 5432)* |
| **Persistencia Local** | IndexedDB vía Dexie.js | **`4.x`** | *Navegador / PWA* | *Offline* |

> **Prevención de Conflictos:** Todos los puertos han sido configurados en rangos libres (`4300`, `8088`, `5438`) para no colisionar con otros entornos locales de Docker (como puertos 80, 5173, 5432 u 8080).

---

## Inicio Rápido (Quick Start)

### 1. Requisitos Previos
- [Docker](https://docs.docker.com/get-docker/) y Docker Compose v2+.
- Nada más: PHP, Composer, Node y PostgreSQL viven dentro de los contenedores.

### 2. Configurar Variables de Entorno
Copia el archivo de ejemplo. Aquí viven los puertos del host y las credenciales de PostgreSQL:
```bash
cp .env.example .env
```

> **Sobre `APP_KEY`:** no se configura a mano. La clave de cifrado de Laravel vive en `server/.env`, y el entrypoint del contenedor crea ese archivo (a partir de `server/.env.example`) y genera la clave la primera vez que arranca. Si alguna vez necesitas rotarla: `./piston key`.

> **Sobre el frontend:** no hay nada que copiar. Su configuración (`app/src/environments/`) está versionada y no contiene secretos; ver [Configuración por entorno](#configuración-por-entorno).

### 3. Levantar Todo el Stack
```bash
./piston up          # equivale a: docker compose up -d --build
```

El primer arranque tarda unos minutos porque construye las imágenes. Al iniciar, `piston-server` ejecuta automáticamente (ver [`server/docker-entrypoint.sh`](server/docker-entrypoint.sh)):

1. `composer install` si falta `vendor/` (el bind mount tapa lo instalado en el build).
2. Creación de `storage/` y `bootstrap/cache` con permisos de escritura.
3. Creación de `server/.env` y generación de `APP_KEY` si no existe.
4. Espera activa a que PostgreSQL acepte conexiones.
5. `php artisan migrate --force` — las **migraciones se aplican solas**.

Para desactivar las migraciones automáticas, añade `RUN_MIGRATIONS=false` al entorno de `piston-server` en `docker-compose.yml`.

### 4. Verificar que Todo Está Arriba
```bash
./piston ps          # los tres contenedores en estado "Up"
./piston health      # data.database = "connected" (solo responde desde el contenedor)
```

Salida esperada del health check:
```json
{"success":true,"code":"ok","message":"Listo.","data":{"status":"ok","service":"Piston API","version":"1.5.0","database":"connected"},"meta":{"request_id":"…","timestamp":"…"}}
```

### 5. Crear tu Cuenta

No hay registro público: las cuentas se crean desde el servidor.

```bash
./artisan piston:user:create tu@correo.com --name="Tu Nombre"   # pide la contraseña sin eco
```

Después abre [http://localhost:4300](http://localhost:4300), inicia sesión y
sigue el wizard de bienvenida (cuenta + primer vehículo).

| Comando | Qué hace |
|---|---|
| `./artisan piston:user:create <email> [--name=] [--password=]` | Crea una cuenta |
| `./artisan piston:user:password <email>` | Cambia la contraseña y cierra todas sus sesiones |
| `./artisan piston:user:revoke <email>` | Cierra todas las sesiones (p. ej. un teléfono perdido) |
| `./artisan piston:auth:prune` | Limpia refresh tokens viejos (también corre a diario con el scheduler) |

### 6. Si Algo Falla
```bash
./piston logs server     # logs del backend
./piston logs app        # logs del frontend
./piston rebuild         # reconstrucción limpia (--no-cache) del stack completo
```

| Síntoma | Causa y solución |
| :--- | :--- |
| `piston-server` en `Restarting (255)` | Falta `vendor/`. `./piston rebuild` o `./piston composer install`. |
| `data.database: "disconnected"` | PostgreSQL aún inicializando. Espera y repite `./piston health`. |
| Error CORS en el navegador | El origen del front debe estar en `FRONTEND_URL` (`.env`) y en `server/config/cors.php`. |
| Puerto ocupado | Cambia `APP_PORT`, `SERVER_PORT` o `DB_PORT` en `.env` y `./piston up`. |
| Archivos nuevos con dueño `root` | Los generó un contenedor. `./piston own`. |
| Quieres empezar de cero | `./piston down && docker volume rm piston_pgdata && ./piston up` (⚠️ borra la base de datos). |

---

## El CLI `./piston`

Todos los comandos se ejecutan dentro de los contenedores, así que no necesitas PHP ni Node instalados en tu máquina.

```bash
./piston help                   # lista completa de comandos
```

| Comando | Qué hace |
| :--- | :--- |
| `./piston up` / `down` / `restart [svc]` | Ciclo de vida del stack |
| `./piston rebuild` | Reconstruye imágenes sin caché |
| `./piston ps` / `logs [svc]` | Estado y logs (`svc` = `server`, `app`, `db`) |
| `./piston health` | Consulta `/api/health` desde el contenedor (la ruta solo acepta localhost) |
| `./piston artisan <cmd>` | Cualquier comando Artisan |
| `./piston composer <cmd>` | Composer en el backend |
| `./piston npm <cmd>` / `ng <cmd>` | npm o Angular CLI en el frontend |
| `./piston psql ["SQL"]` | Consola de PostgreSQL, o ejecuta una sentencia |
| `./piston sh <server\|app\|db>` | Shell interactiva en el contenedor |
| `./piston migrate` / `fresh` | Migrar / recrear el esquema (⚠️ `fresh` borra datos) |
| `./piston routes` | `route:list --path=api` |
| `./piston test` | Suite de PHPUnit (backend), contra la base `piston_test` de Postgres (el entrypoint la crea) |
| `./piston npm test` | Suite de Vitest (frontend) |
| `./piston key` | Regenera `APP_KEY` |
| `./piston own` | Devuelve al usuario del host los archivos que generó un contenedor |

Hay dos atajos para lo que más se usa:

```bash
./artisan migrate:status        # === ./piston artisan migrate:status
./npm run build                 # === ./piston npm run build
```

---

## Puntos de Acceso

- **Frontend (Angular 22)**: [http://localhost:4300](http://localhost:4300)
- **Backend Health Check**: `./piston health` (la ruta solo responde a localhost; desde el navegador da 404)
- **PWA**: instalable desde una build de producción (`./npm run build` → servir `app/dist/app/browser`). En `ng serve` el service worker está desactivado a propósito.
- **Base de Datos PostgreSQL 18**: Conexión externa en `localhost:5438` (Usuario: `piston_user`, Contraseña: `piston_secret_password`, DB: `piston`).

---

## Estructura del Proyecto

```text
Piston/
├── .env.example                     # Plantilla de variables de entorno y puertos
├── .env                             # Variables locales activas
├── .gitignore                       # Ignorados globales
├── docker-compose.yml               # Orquestación de app, server y postgres
├── piston                           # CLI de desarrollo (up, artisan, npm, psql…)
├── artisan                          # Atajo -> ./piston artisan
├── npm                              # Atajo -> ./piston npm
├── CHANGELOG.md                     # Registro de versiones (iniciando en 1.0.0)
├── README.md                        # Documentación principal
├── docs/
│   └── schema.dbml                  # Modelo de datos completo (pegar en dbdiagram.io)
│
├── app/                             # FRONTEND: Angular 22 + Dexie.js + PWA
│   ├── Dockerfile                   # Imagen Node dev server (Puerto 4300)
│   ├── package.json                 # Dependencias (Angular 22, Dexie.js 4, ngsw)
│   ├── ngsw-config.json             # Política de caché del service worker
│   ├── tools/
│   │   └── generate-icons.py        # Regenera los iconos (sin dependencias)
│   ├── public/
│   │   ├── manifest.webmanifest     # Manifiesto PWA (nombre, tema, shortcuts)
│   │   └── icons/
│   │       └── app/                 # Icono de la app: 72→512 px, incluidos maskable
│   ├── src/
│   │   ├── environments/            # apiBaseUrl por entorno (fileReplacements)
│   │   ├── test-setup.ts            # Polyfill de IndexedDB para Vitest
│   │   ├── styles.scss              # Sistema de diseño: tokens, tipografía, motion
│   │   └── app/
│   │       ├── shared/
│   │       │   ├── icon/            # Registro de iconos SVG en línea (sin red)
│   │       │   ├── island/          # Dynamic Island + servicio de actividad
│   │       │   ├── gauge/           # Medidor de rayitas por segmentos
│   │       │   └── tab-bar/         # Barra de pestañas estilo iOS
│   │       ├── features/            # Una pantalla por pestaña
│   │       │   ├── garage/          # Vehículo, nivel de tanque, salud
│   │       │   ├── fuel/            # Captura por rayitas e historial
│   │       │   ├── service/         # Semáforo, fallas en seguimiento
│   │       │   ├── expenses/        # Gasto por categoría y vencimientos
│   │       │   └── settings/        # Ajustes + estado real de sincronización
│   │       └── core/                # Capa offline-first
│   │           ├── models/          # Enums y tipos, espejo de schema.dbml
│   │           ├── db/              # Dexie, UUIDv7 y siembra de catálogos
│   │           ├── data/            # OfflineStore (escrituras) y adjuntos
│   │           ├── sync/            # Motor de sync: outbox, backoff, delta
│   │           └── api/             # Cliente HTTP de la API
│
└── server/                          # BACKEND: Laravel 13 + Sanctum + PHP 8.5
    ├── Dockerfile                   # PHP 8.5 con extensiones pdo_pgsql, bcmath, zip
    ├── docker-entrypoint.sh         # Bootstrap: composer, APP_KEY, espera a la DB, migraciones
    ├── composer.json                # Dependencias (Laravel 13, Sanctum)
    ├── routes/api.php               # Rutas REST API y endpoint /health
    ├── config/cors.php              # Configuración CORS para localhost:4300
    ├── app/Models/Concerns/         # SyncsOffline: UUID, soft delete, scope sinceRev
    └── database/migrations/         # 20 tablas de dominio + trigger de `rev`
```

---

## Características

La app es **mobile-first** y **offline-first**: toda escritura ocurre primero en IndexedDB y se sincroniza después contra Laravel.

### 🚗 Garage y vehículos
- Multi-vehículo con ficha completa: marca, modelo, año, versión, motor, transmisión, VIN, placas y color.
- Tipos de vehículo (auto, moto, pickup, camión, van) con catálogos de mantenimiento propios.
- Especificaciones técnicas que alimentan los cálculos: capacidad del tanque, número de rayitas del indicador, rendimiento de fábrica, capacidad y especificación de aceite, presiones de llantas.
- **Historial de odómetro** como serie temporal, con detección de lecturas inconsistentes.
- **Ciclo de vida de propiedad**: fecha, precio y kilometraje de compra y de venta.
- **Archivar vehículos vendidos** conservando todo su histórico, y **expediente exportable** (PDF/JSON) para entregar al comprador.
- Galería de fotos del vehículo.

### ⛽ Combustible
- **Captura flexible**: registra por monto pagado, por litros o por **rayitas**; el resto se calcula solo.
- **Rendimiento km/L sin obligarte a llenar el tanque**, estimado a partir del movimiento de la aguja.
- **Curva de calibración de rayitas por vehículo**: el indicador de combustible no es lineal, y la app aprende la curva real de tu auto con cada carga a tanque lleno. Entre más la uses, más exacta se vuelve.
- **Tanque lleno vs. carga parcial**: distingue el rendimiento exacto (full-to-full) del estimado por rayitas y los reporta por separado.
- **"Olvidé registrar una carga"**: rompe la cadena de cálculo en lugar de ensuciar tus promedios.
- Gasolinera, tipo de combustible (regular / premium / diésel) y precio por litro en cada carga.
- **Costo por kilómetro** y gasto de combustible por mes.
- **Alerta de rendimiento anómalo**: si el km/L cae respecto a tu promedio, puede ser señal de un problema mecánico.

### 🔧 Mantenimiento y servicios
- Catálogo de tipos de servicio precargado (aceite, filtros, balatas, bujías, banda, anticongelante, afinación…), ampliable con los tuyos.
- Registro de servicios con fecha, kilometraje, taller, costo de mano de obra y notas; una sola visita puede cubrir varios servicios.
- **Refacciones por servicio**: marca, número de parte, cantidad y costo unitario. Aquí vive el histórico real del auto.
- **Intervalos por vehículo** (cada X km **o** cada Y meses, lo que ocurra primero) con **semáforo** de salud verde / amarillo / rojo.
- **Recordatorios y alertas** al acercarse el kilometraje o la fecha del próximo servicio.
- **Bitácora de fallas y síntomas**: registra "suena al frenar" como incidencia abierta y lígala después al servicio que la resolvió. Guarda también los intentos que *no* la resolvieron.
- Adjuntos por servicio (factura, nota del taller).

### 💸 Gastos
- Gastos categorizados: tenencia, verificación, seguro, lavado, estacionamiento, casetas, multas, accesorios.
- **Gastos recurrentes** con periodicidad (seguro anual, tenencia anual, verificación semestral).

### 📄 Documentos y trámites
- Seguro, verificación, tenencia, tarjeta de circulación y licencia, con vigencias y costos.
- **Alertas de vencimiento** configurables (30 / 15 / 7 días antes).
- Foto o escaneo del documento, disponible **sin conexión**.
- Calendario de verificación por **engomado y terminación de placa**.

### 🛰️ Gasolineras
- Catálogo de gasolineras con marca, dirección y geolocalización.
- Registro histórico de precios por tipo de combustible, alimentado automáticamente por tus propias cargas.
- Comparativa de precios de las estaciones que ya conoces.

### 🧭 Uso
- **Bitácora de viajes**: origen, destino, kilómetros y propósito (personal / trabajo).

### 📊 Dashboard
- Rendimiento promedio, gasto del mes y próximo servicio de un vistazo.
- Tendencias de rendimiento, de precio pagado por litro y de gasto por categoría.
- Comparativa entre tus vehículos.

### 📶 Offline-first (arquitectura)
- Escritura local inmediata en IndexedDB (Dexie) y sincronización en segundo plano.
- **UUIDv7 generado en el cliente**: los registros creados sin conexión nacen con su id definitivo, sin mapeos ni reescritura de relaciones al sincronizar.
- **Outbox** de mutaciones pendientes con reintentos y backoff exponencial.
- **Sync delta** por número de revisión, sin depender de relojes que pueden ir desfasados.
- **Soft delete con tombstones**: los borrados se propagan y no "reviven" al reconectar.
- **Adjuntos diferidos**: la foto se guarda al instante y el binario sube cuando haya red.
- PWA instalable con service worker.

### Fuera de alcance por ahora
Vehículos híbridos y eléctricos · compartir un vehículo entre varias cuentas · comunidad de precios con votos y reputación · importación de precios oficiales de la CRE · plan de mantenimiento del fabricante precargado · alertas de garantía de refacciones · presupuestos mensuales · OBD-II · OCR de tickets · decodificador de VIN.

> El modelo de datos ya deja preparado el terreno para varias de estas: ver [`docs/schema.dbml`](docs/schema.dbml), que se puede pegar en [dbdiagram.io](https://dbdiagram.io) para verlo de forma visual.

---

## Arquitectura Offline-First del Frontend

Toda escritura entra primero a IndexedDB y se sincroniza después. El código vive en `app/src/app/core/`.

### Cómo se escribe un dato

```ts
import { OfflineStore } from './core';

const store = inject(OfflineStore);

// Escribe en IndexedDB y encola la mutación en la MISMA transacción.
const vehicle = await store.create<Vehicle>('vehicles', { make: 'Mazda', /* … */ });

await store.update<Vehicle>('vehicles', vehicle.id, { current_odometer_km: 48_900 });

// Borrado lógico: deja tombstone para que el borrado se propague.
await store.remove('vehicles', vehicle.id);
```

Nunca escribas directo contra `db.vehicles.add(...)`: saltarse el `OfflineStore` guarda el dato pero no lo encola, y ese cambio no sube nunca.

### Las cinco decisiones que sostienen el diseño

| Decisión | Por qué |
| :--- | :--- |
| **UUIDv7 generado en el cliente** (`core/db/uuid.ts`) | Un registro creado sin conexión necesita su id definitivo desde el primer instante. Si el servidor asignara la clave, habría que reescribir cada relación que ya apunta a ella. Además v7 ordena por tiempo, así que los ids salen cronológicos y Postgres inserta casi secuencialmente en el índice. |
| **Fila y outbox en una sola transacción** (`core/data/offline-store.service.ts`) | Si fueran dos pasos, cerrar la pestaña en medio dejaría un cambio guardado que nadie va a enviar. |
| **Sync delta por `rev`, no por timestamp** (`core/sync/sync.service.ts`) | Los relojes se desfasan, empatan dentro del mismo milisegundo y saltan con el horario de verano. Los tres hacen que un sync incremental se salte registros en silencio. `rev` sale de una secuencia global de Postgres. |
| **Push antes que pull** | Al revés, el servidor mandaría la versión vieja de una fila que este dispositivo acaba de cambiar, y la pisaría con datos anteriores. |
| **Soft delete con tombstones** | Un borrado duro haría que el registro reviva: otro dispositivo desactualizado lo volvería a subir. |

### El outbox

- Guarda el **registro completo**, no un diff: cinco ediciones offline de la misma fila se colapsan en un envío con el estado final.
- Un `insert` pendiente que luego se borra **se anula solo**: pedirle al servidor que borre algo que nunca recibió es un 404 garantizado.
- Los reintentos usan **backoff exponencial con jitter** (5 s → 10 min, ±20%) y **no tienen tope**: un fallo transitorio (sin red, 5xx, servidor caído) se reintenta para siempre. El jitter desalinea a varios dispositivos que recuperaron la red a la vez.
- Se distingue el error **reintentable** del **rechazo definitivo** del servidor (validación, permiso, duplicado). El rechazo sale de la cola activa (`failed`) para que una fila mal formada no bloquee lo que viene detrás.
- Un hijo cuyo padre fue rechazado o está en conflicto queda **`blocked`** y sale solo cuando el padre suba. El orden de envío respeta las dependencias (`vehicles` antes que `fuel_entries`): el servidor valida llaves foráneas.
- Es **reactivo, sin polling a ciegas**: sincroniza al abrir la app y ~300 ms después de cada cambio. Mientras quedan pendientes, reintenta con el backoff (ese es el único "polling", y se apaga al vaciarse la cola). Al volver a la app o recuperar la red solo va al servidor si hay pendientes o el último sync tiene más de 5 min. Una revisión de respaldo cada 10 min atrapa pendientes que ningún evento disparó, sin tocar la red si no hay nada. Un Web Lock hace que solo una pestaña sincronice a la vez.
- **Con la app cerrada**, el service worker (`public/piston-sw.js`, que envuelve al de Angular) sube el outbox al volver la red (Background Sync) y ~una vez al día (Periodic Background Sync, solo en la PWA instalada; Chrome decide la hora). Solo sube: un conflicto lo marca y espera; jalar y resolver lo hace la app al abrirse. Llama a la API en su mismo origen, salvo que la app le pase otra base al registrarlo (`serviceWorkerUrl` en `core/sync/background-sync.ts`). Sus listas de tablas y tags son copias de las de la app; `sw-parity.spec.ts` falla si se desalinean.
- Cada intento guarda su **diagnóstico** (tipo de fallo, HTTP, código, `X-Request-Id` generado por el cliente y hora exacta). El centro de sincronización (`/settings/sync`, Ajustes › Sincronización) lo muestra por cambio, con historial de 30 días.

### Conflictos

Ningún cambio se pierde sin que el usuario lo vea. Cada entrada del outbox guarda `base_rev` y `base`: el `rev` y la fila tal como estaban antes del primer cambio local. El servidor los compara con lo que tiene (concurrencia optimista; el reloj de los dispositivos no decide nada):

- **Nadie más la tocó:** se aplica.
- **Otro dispositivo cambió campos distintos:** se mezcla por campo y se aplica. El servidor devuelve la fila combinada y el Historial lo registra como "Se combinó con otro dispositivo".
- **Los dos cambiaron el mismo campo con valores distintos** (`edit_edit`), **se editó algo borrado o se borró algo editado** (`edit_delete`), o **se creó algo dentro de un padre borrado** (`create_in_deleted_parent`): la entrada queda en `conflict`. La fila local conserva la versión del usuario, no se reintenta sola, bloquea a sus dependientes y bloquea el logout.

El usuario lo decide en Ajustes › Sincronización › Conflictos (`/settings/sync/conflict/:id`): las dos versiones lado a lado, campo por campo, y lo que se combinó solo aparte. "Usar la del servidor" toma su versión solo en los campos que chocan: los cambios propios que no chocaban se conservan. Restaurar algo borrado exige `resolve: 'restore'` explícito. El contrato completo está en [docs/api.md](docs/api.md#conflictos).

Al jalar: si la fila tiene una mutación en el outbox (pendiente, rechazada, bloqueada o en conflicto), **gana lo local**. Si no, gana el servidor salvo que la copia local sea de un `rev` posterior.

### Configuración por entorno

`app/src/environments/` tiene dos archivos y **los dos están versionados**:

| Archivo | Se usa en | `apiBaseUrl` |
|---|---|---|
| `environment.ts` | `ng build` (producción) | `''` — mismo origen que la app |
| `environment.development.ts` | `ng serve` y `ng build --configuration development` | `http://<host>:8088` |

El cambio lo hace `fileReplacements` en `angular.json`: en desarrollo Angular
sustituye un archivo por el otro al compilar, así que el código importa siempre
`environment` y nunca pregunta en qué entorno está.

**No van al `.gitignore`, y no hay `.example` de ellos.** Son entrada de
compilación, no configuración de máquina: `fileReplacements` referencia la ruta
literal, de modo que si el archivo estuviera ignorado el build fallaría en cada
clon nuevo hasta que alguien recordara copiarlo a mano. Y no hay nada que
proteger: no contienen credenciales, y el host de desarrollo se deduce en
tiempo de ejecución (`globalThis.location.hostname`), para que la app funcione
igual desde `localhost` que desde el celular apuntando a la IP de tu red.

Lo único acoplado es el puerto `8088`. Si cambias `SERVER_PORT` en el `.env`
raíz, ajusta también esa línea de `environment.development.ts`.

### Sesión y autenticación

**Los tokens protegen el servidor, no los datos locales**: la app abre sin
red y sin token, y una sesión vencida pausa el sync pero nunca bloquea la app
ni borra nada. Access token de 15 min en memoria, refresh rotativo de 60 días
en una cookie `HttpOnly` con detección de robo, y cierre de sesión solo cuando
todo está en el servidor.

Todo el detalle (endpoints, estados, rotación, defensas, wizard, operación y
decisiones descartadas) está en **[docs/auth.md](docs/auth.md)**.

### Respuestas de la API

Toda respuesta JSON usa el mismo sobre
(`success` / `code` / `message` / `data` / `errors` / `meta`), con códigos de
un enum y sin exponer nada del servidor. Ver **[docs/api.md](docs/api.md)**.

### Adjuntos diferidos

La foto se guarda como Blob en IndexedDB y se ve al instante; el binario sube por su propia cola, aparte del outbox, para que 4 MB de imagen no bloqueen la sincronización de los datos.

### PWA

`ng build` genera `ngsw-worker.js` y `ngsw.json`. El service worker **solo se registra en producción** (`enabled: !isDevMode()`): en `ng serve` cachearía el bundle y el hot reload dejaría de reflejar los cambios. Para probar la instalación hay que servir `dist/app/browser` sobre HTTP, no usar el dev server.

Los iconos viven en `app/public/icons/app/` (un archivo por tamaño; ver el
[README de la carpeta](app/public/icons/README.md)) y se regeneran con
`python3 app/tools/generate-icons.py`, sin dependencias de imagen instaladas.

### Pruebas

```bash
./piston npm test        # Vitest: UUIDv7, backoff, outbox, sync y conflictos
```

Cubren el ciclo completo contra un servidor simulado: orden de tablas, backoff sin pérdida de mutaciones, tombstones que no reviven, conflictos y su resolución, y modo sin conexión.

---

## Comandos Útiles de Desarrollo

Todos tienen su equivalente directo en `docker compose` por si prefieres no usar el CLI.

### Laravel (Artisan)
```bash
./artisan route:list --path=api      # docker compose exec piston-server php artisan route:list --path=api
./artisan migrate                    # docker compose exec piston-server php artisan migrate
./artisan tinker                     # docker compose exec piston-server php artisan tinker
./piston composer require <paquete>  # docker compose exec piston-server composer require <paquete>
```

### Angular
```bash
./piston logs app                    # docker compose logs -f piston-app
./npm run build                      # docker compose exec piston-app npm run build
./npm install <paquete>              # docker compose exec piston-app npm install <paquete>
./piston npm test                    # suite de Vitest
```

> Tras instalar un paquete de npm, reinicia el frontend con `./piston restart app`: `node_modules` vive en un volumen del contenedor, no en tu disco.

> Los contenedores corren como `root`, así que lo que generan dentro (un schematic de Angular, un `make:model` de Artisan) aparece en tu disco con dueño `root`. `./piston own` te devuelve la propiedad.

### Base de Datos
```bash
./piston psql                        # consola interactiva de PostgreSQL
./piston psql "select count(*) from vehicles;"
./piston fresh                       # recrear el esquema desde cero (⚠️ borra datos)
```

### Control de Contenedores
```bash
./piston down                        # docker compose down
./piston restart                     # docker compose restart
./piston ps                          # docker compose ps
```

### Control de Versiones
Para actualizar la versión del proyecto de forma consistente en todos los archivos (`app/package.json`, `app/package-lock.json`, `server/config/piston.php` —la que anuncia `/api/health`—, `CHANGELOG.md` y `README.md`):

```bash
./up-version.sh 1.2.2          # pasando la versión como argumento
# o bien
./up-version.sh                # solicitará la versión de forma interactiva
```

> **Nota obligatoria:** Cada cambio final debe utilizar este script para asegurar que la versión esté sincronizada en todo el proyecto.

El script es **todo o nada**: si algo no cuadra no toca ningún archivo. Se niega si la versión no es mayor que la actual, si ya existe en el changelog o si `[Unreleased]` está vacío. Lo escrito en `[Unreleased]` pasa tal cual a `## [X.Y.Z] - AAAA-MM-DD` y `[Unreleased]` queda vacío para lo siguiente.

---

## 📄 Licencia y Versión
- Versión actual: **1.5.0** (Ver [CHANGELOG.md](CHANGELOG.md) para más detalles).
