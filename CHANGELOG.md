# Changelog

Todos los cambios notables en este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/lang/es/).
## [Unreleased]

## [1.2.0] - 2026-09-20

El proyecto pasa de maqueta a aplicación que funciona. El stack arranca solo
desde un clon limpio, y detrás de la interfaz ya hay una base de datos local
real con un motor de sincronización que sobrevive a quedarse sin señal.

### Added
- **Arranque reproducible**: levantar el proyecto vuelve a ser un solo comando.
  El backend se prepara solo al iniciar —dependencias, clave de cifrado,
  permisos, espera a que la base de datos esté lista y migraciones— en lugar de
  exigir una lista de pasos manuales que nadie recuerda completos.
- **CLI de desarrollo `./piston`**: un único punto de entrada para trabajar
  dentro de los contenedores. Artisan, npm, psql, logs, salud del stack y
  reconstrucciones, sin tener que escribir invocaciones de Docker a mano.
  `./artisan` y `./npm` quedan como atajos directos.
- **Capa de datos offline-first funcional**: la aplicación ya guarda de verdad.
  Las claves primarias se generan en el dispositivo y son ordenables por tiempo,
  cada escritura queda registrada para enviarse después, y los borrados se
  propagan en vez de desaparecer sin avisar al resto de dispositivos.
- **Motor de sincronización**: envía los cambios locales antes de traer los del
  servidor, respeta el orden de dependencias entre entidades, colapsa las
  ediciones repetidas de un mismo registro en un solo envío y reintenta con
  espera creciente cuando no hay red. Si dos dispositivos tocan lo mismo, gana
  la edición más reciente; si el cambio local aún no se ha enviado, gana el
  local. Un servidor caído retrasa la cola, nunca la descarta.
- **Adjuntos diferidos**: las fotos se guardan y se ven al instante en el
  dispositivo y suben por su propia cola, para que un archivo pesado no bloquee
  la sincronización de los datos.
- **Catálogo inicial**: al primer arranque la aplicación se siembra con los
  tipos de servicio y las categorías de gasto de uso común, para no empezar
  frente a formularios vacíos.
- **Instalable como aplicación**: Piston se puede instalar en el teléfono y
  abrir sin conexión, con iconografía propia en todos los tamaños que el
  sistema operativo pide y accesos directos a Combustible y Servicios.
- **Documentación de montaje y arquitectura**: el README explica el arranque
  completo —incluida la generación de claves, que antes faltaba—, los errores
  típicos y su solución, y las decisiones de diseño del modo sin conexión con
  el porqué de cada una.

### Changed
- **Ajustes deja de ser maqueta**: la sección de sincronización muestra el
  estado real —conexión, cambios pendientes, fotos por subir, último sync— y
  permite forzar una sincronización o reintentar lo fallido.
- **La dirección de la API deja de estar escrita en el código**: se resuelve por
  entorno, de modo que en producción la aplicación habla con su propio origen y
  en desarrollo con el puerto local.
- **Los recursos gráficos se organizan por tipo y tamaño**, pensando en que el
  set crezca, y se generan desde una definición única y reproducible.

### Removed
- **El andamiaje del preview**: los servicios y modelos de ejemplo que quedaban
  del arranque inicial, sustituidos por la capa de datos definitiva.

## [1.1.0] - 2026-09-20

Definición del alcance funcional de la aplicación y construcción de sus dos
cimientos: el modelo de datos y el lenguaje visual. El preview inicial queda
sustituido por una base real sobre la que construir.

### Added
- **Modelo de datos definitivo**: se diseñó y documentó el esquema completo de
  la aplicación, cubriendo vehículos, combustible, mantenimiento, refacciones,
  gastos, documentos, viajes y adjuntos. Queda publicado en formato visual para
  poder discutirlo antes de escribir código sobre él.
- **Arquitectura de sincronización offline-first**: las claves primarias se
  generan en el dispositivo, los borrados se propagan en lugar de desaparecer y
  la sincronización viaja por diferencias en vez de descargarlo todo. Es lo que
  permite crear registros sin conexión y que sobrevivan intactos al reconectar.
- **Base de datos operativa**: todo el esquema queda implementado en PostgreSQL
  y listo para migrar.
- **Identidad visual propia**: se definió el lenguaje de diseño de Piston
  —color, tipografía, espaciado, profundidad y movimiento— como un sistema
  coherente en lugar de estilos sueltos por pantalla.
- **Dynamic Island**: elemento central de la interfaz. Muestra el estado vivo
  del vehículo y se transforma según la sección en la que estés, con el
  comportamiento y las animaciones de iOS.
- **Iconografía propia**: set de iconos dibujado para la aplicación, con un
  trazo y una rejilla consistentes en toda la interfaz.
- **Navegación móvil**: la aplicación se reorganizó en cinco secciones —Garage,
  Combustible, Servicios, Gastos y Ajustes— accesibles desde una barra de
  pestañas fija. Las pantallas son maqueta: definen estructura y estética, sin
  lógica ni persistencia detrás.
- **Alcance documentado**: el README recoge las características acordadas y, de
  forma explícita, las que quedan fuera por ahora.

### Changed
- **Identidad de usuario y preferencias**: las cuentas pasan a identificarse por
  UUID, y las unidades, moneda e idioma dejan de estar fijados en la aplicación
  para vivir con cada usuario.

### Removed
- **Toda dependencia de red en el arranque**: se eliminaron las fuentes remotas
  y los emojis que hacían de iconografía. En una aplicación offline-first, un
  recurso externo es un recurso que falta justo cuando no hay señal.
- **El preview del demo** y los restos del andamiaje inicial que ya no
  correspondían a la dirección del proyecto.

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
