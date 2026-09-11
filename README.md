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
│
├── app/                             # FRONTEND: Angular 22 + Dexie.js
│   ├── Dockerfile                   # Imagen Node 26 dev server (Puerto 4300)
│   ├── package.json                 # Dependencias (Angular 22, Dexie.js 4)
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/
│   │   │   │   ├── models/          # Modelos TypeScript (Vehicle, Fuel, Service)
│   │   │   │   └── services/        # DexieDbService (IndexedDB), ApiService
│   │   │   └── features/dashboard/  # Preview interactivo de combustible y servicios
│   │   └── styles.scss              # Sistema de diseño automotriz oscuro
│
└── server/                          # BACKEND: Laravel 13 + Sanctum + PHP 8.5
    ├── Dockerfile                   # PHP 8.5 con extensiones pdo_pgsql, bcmath, zip
    ├── composer.json                # Dependencias (Laravel 13, Sanctum)
    ├── routes/api.php               # Rutas REST API y endpoint /health
    ├── config/cors.php              # Configuración CORS para localhost:4300
    └── app/Models/User.php          # Modelo con HasApiTokens para Sanctum
```

---

## Características Incluidas en el Preview

1. **Calculador de Combustible por "Rayitas"**:
   - Selector interactivo de nivel de tanque por segmentos/rayitas (ej. 8 rayitas).
   - Cálculo automático de litros recargados según monto pagado y precio por litro.
   - Estimación del rendimiento (km/L) y costo por kilómetro sin exigir tanque lleno.
2. **Persistencia Offline con Dexie.js**:
   - Toda la información se guarda de inmediato en el IndexedDB del navegador (`piston_local_db`).
   - Funciona sin conexión a internet y mantiene los datos listos para sincronización con Laravel.
3. **Radar de Precios de Gasolineras (Estilo Waze)**:
   - Comparativa de gasolineras locales con precios reportados y corregidos por la comunidad.
4. **Monitor de Mantenimiento Preventivo**:
   - Semáforo de salud de refacciones (aceite sintético, filtros, balatas) con alerta por kilometraje.
5. **Diagnóstico de Stack en Vivo**:
   - Tarjetas que verifican en tiempo real la conectividad con el contenedor de Laravel 13 y PostgreSQL 18.

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
- Versión actual: **1.0.0** (Ver [CHANGELOG.md](file:///home/abdiel/projects/personal/Piston/CHANGELOG.md) para más detalles).
