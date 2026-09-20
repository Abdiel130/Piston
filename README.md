# Piston

> **Gestión Vehicular Inteligente, Control de Combustible y Mantenimientos Offline-First**

**Piston** es una aplicación moderna y personal para el seguimiento de vehículos, servicios, gastos mecánicos y recargas de combustible. Nace para solucionar las limitaciones de herramientas tradicionales como Drivvo (por ejemplo, permitir calcular el rendimiento km/L en base a la capacidad del tanque y las **"rayitas"** de combustible sin obligar a llenar el tanque completo, además de integrar monitoreo comunitario de precios en gasolineras estilo Waze).

---

## Stack Tecnológico

| Capa | Tecnología | Versión | Contenedor Docker | Puerto Host Asignado |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | Angular + Signals + PWA | **`22.x`** (`22.1.8`) | `piston-app` | **`4300`** |
| **Backend REST API** | Laravel (Sanctum) | **`13.x`** (`13.10.1`) | `piston-server` | **`8088`** |
| **Entorno PHP** | PHP CLI / FPM | **`8.5`** (`8.5.10`) | `piston-server` | *(Interno 8000)* |
| **Base de Datos** | PostgreSQL Alpine | **`18.x`** (`18.6`) | `piston-db` | **`5438`** *(Interno 5432)* |
| **Persistencia Local** | IndexedDB vía Dexie.js | **`4.x`** | *Navegador / PWA* | *Offline* |

> **Prevención de Conflictos:** Todos los puertos han sido configurados en rangos libres (`4300`, `8088`, `5438`) para no colisionar con otros entornos locales de Docker (como puertos 80, 5173, 5432 u 8080).

---

## Inicio Rápido (Quick Start)

### 1. Requisitos Previos
- [Docker](https://docs.docker.com/get-docker/) y Docker Compose v2+.

### 2. Clonar y Configurar Variables de Entorno
Copia el archivo de ejemplo para configurar tus variables locales:
```bash
cp .env.example .env
```

### 3. Levantar Todo el Stack con Docker
Construye y arranca los contenedores en segundo plano con un solo comando:
```bash
docker compose up -d --build
```

### 4. Ejecutar Migraciones de Base de Datos
Aplica las migraciones iniciales de Laravel y Sanctum en PostgreSQL 18:
```bash
docker compose exec piston-server php artisan migrate
```

---

## Puntos de Acceso

- **Frontend (Angular 22)**: [http://localhost:4300](http://localhost:4300)
- **Backend Health Check**: [http://localhost:8088/api/health](http://localhost:8088/api/health)
- **Base de Datos PostgreSQL 18**: Conexión externa en `localhost:5438` (Usuario: `piston_user`, Contraseña: `piston_secret_password`, DB: `piston`).

---

## Estructura del Proyecto

```text
Piston/
├── .env.example                     # Plantilla de variables de entorno y puertos
├── .env                             # Variables locales activas
├── .gitignore                       # Ignorados globales
├── docker-compose.yml               # Orquestación de app, server y postgres
├── CHANGELOG.md                     # Registro de versiones (iniciando en 1.0.0)
├── README.md                        # Documentación principal
├── docs/
│   └── schema.dbml                  # Modelo de datos completo (pegar en dbdiagram.io)
│
├── app/                             # FRONTEND: Angular 22 + Dexie.js
│   ├── Dockerfile                   # Imagen Node dev server (Puerto 4300)
│   ├── package.json                 # Dependencias (Angular 22, Dexie.js 4)
│   ├── src/
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
│   │       │   └── settings/        # Ajustes y estado de sincronización
│   │       └── core/                # Dexie y cliente de API (pendiente de reescritura)
│
└── server/                          # BACKEND: Laravel 13 + Sanctum + PHP 8.5
    ├── Dockerfile                   # PHP 8.5 con extensiones pdo_pgsql, bcmath, zip
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

## Comandos Útiles de Desarrollo

### Comandos de Laravel (Artisan)
```bash
# Ver estado de rutas API
docker compose exec piston-server php artisan route:list --path=api

# Ejecutar migraciones
docker compose exec piston-server php artisan migrate

# Acceder a la consola interactiva Tinker
docker compose exec piston-server php artisan tinker
```

### Comandos de Angular
```bash
# Ver logs en tiempo real del frontend
docker compose logs -f piston-app

# Ejecutar una compilación de producción de prueba
docker compose exec piston-app npm run build
```

### Control de Contenedores
```bash
# Detener contenedores
docker compose down

# Reiniciar servicios
docker compose restart

# Ver estado de los contenedores y puertos
docker compose ps
```

---

## 📄 Licencia y Versión
- Versión actual: **1.1.0** (Ver [CHANGELOG.md](file:///home/abdiel/projects/personal/Piston/CHANGELOG.md) para más detalles).
