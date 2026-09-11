# Changelog

Todos los cambios notables en este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [1.0.0] - 2026-09-10

### Added
- **Infraestructura Docker Completa**:
  - Configuración multi-contenedor con `docker-compose.yml` para Frontend, Backend y Base de Datos.
  - Puertos asignados independientes para evitar colisiones con otros entornos activos:
    - Frontend Angular: `4300`
    - Backend Laravel API: `8088`
    - PostgreSQL 18: `5438`
  - Red dedicada bridge `piston-network` y volumen persistente `piston_pgdata`.

- **Backend (Laravel 13 + PHP 8.5)**:
  - Inicialización del proyecto sobre Laravel 13 (`13.10.1`) con PHP 8.5 (`8.5.10`).
  - Configuración de base de datos PostgreSQL 18 (`pdo_pgsql`, `pgsql`, `bcmath`, `zip`, `opcache`).
  - Integración de Laravel Sanctum para autenticación API REST segura.
  - Endpoint de salud y diagnóstico `/api/health` con reporte de conexión viva a base de datos y versiones.
  - Configuración de políticas CORS para consumo desde el frontend en `http://localhost:4300`.

- **Frontend (Angular 22 + Dexie.js)**:
  - Inicialización de la aplicación sobre Angular 22 (`22.1.8`) con arquitectura de Standalone Components y Signals.
  - Integración de Dexie.js v4 para soporte Offline-First con IndexedDB (`piston_local_db`).
  - Servicio `DexieDbService` con tablas locales para `vehicles`, `fuelLogs`, `maintenanceLogs` y `gasStations`.
  - Preview visual de alta fidelidad (UI oscura premium estilo automotriz):
    - **Calculador por "Rayitas" de combustible**: Algoritmo visual interactivo que calcula litros restantes, litros agregados y rendimiento real estimado (km/L) sin obligar a llenar el tanque completo (resolviendo la limitación de Drivvo).
    - **Radar de Precios de Gasolineras**: Monitor estilo Waze con precios comunitarios actualizados y ordenados por distancia y marca.
    - **Monitoreo de Servicios & Refacciones**: Tarjetas de mantenimiento preventivo con cálculo de vida útil por kilometraje restante.
    - **Diagnóstico del Stack**: Visualización en vivo del estado de los 3 contenedores y la base de datos local.

- **Doc**:
  - `README.md` exhaustivo con guía rápida de instalación, comandos docker, mapa de puertos y arquitectura.
  - Variables de entorno documentadas en `.env.example`.
