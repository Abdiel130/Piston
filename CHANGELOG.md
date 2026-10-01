# Changelog

Todos los cambios notables en este proyecto serán documentados en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
y este proyecto se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

## [1.5.0] - 2026-09-30

La configuración deja de ser una maqueta. Desde Ajustes se agregan más
vehículos y se corrige cualquier dato del registro inicial, se elige cuál es
el principal y se archivan los que ya no se usan. Distancia, volumen y moneda
se eligen de una lista y toda la app los respeta al mostrar y al capturar,
sin tocar lo guardado, que sigue siempre en kilómetros y litros.

### Added
- **Agregar más vehículos**: en Ajustes, la lista de vehículos termina con
  *Agregar vehículo*. El alta pide lo mismo que el wizard y además permite
  elegir si el nuevo será el principal. El primero siempre lo es.
- **Ficha de cada vehículo**: tocar un vehículo abre su ficha, con cuántas
  cargas, servicios y gastos tiene, y todos sus datos editables para corregir
  lo capturado al inicio. Suma lo que el wizard no pedía: versión, motor,
  color, VIN, capacidad y especificación del aceite, presión de llantas,
  rendimiento de fábrica, notas y los datos de venta.
- **Vehículo principal, archivado y vendido**: cualquier vehículo activo se
  puede volver el principal, que es el que muestran Garage, Combustible,
  Servicios y Gastos. Al archivar o vender el principal, el puesto pasa solo
  a otro activo. Un vehículo capturado por error se puede borrar mientras no
  tenga historial; con historial se archiva para no perderlo.
- **Corrección del odómetro**: desde la ficha se puede subir el odómetro o
  bajarlo si se capturó mal. Al bajarlo se corrigen las lecturas manuales; si
  una carga o un servicio registró más kilómetros, la app lo dice en vez de
  corregirlo en silencio, porque el error está en ese registro.
- **Unidades y moneda configurables**: en Ajustes, listas para elegir
  distancia (kilómetros o millas), volumen (litros o galones) y moneda, con
  una vista previa de cómo se verán las cifras. El cambio se aplica al
  instante en toda la app, también sin conexión, y se envía a la cuenta en
  cuanto hay señal.
- **Perfil en Ajustes**: el nombre se puede editar y la contraseña se puede
  cambiar desde Ajustes, ya no solo durante el wizard.

### Changed
- **Toda la app respeta las unidades elegidas**: odómetro, cantidades,
  rendimiento, precio por volumen y costo por distancia se muestran y se
  capturan en las unidades de la cuenta, en Garage, Combustible, Servicios,
  las capturas y el wizard. Lo guardado sigue siempre en kilómetros y litros,
  así que cambiar de unidades nunca altera los datos ni lo que reciben otros
  dispositivos. La moneda no convierte montos: los registros ya guardados
  conservan la suya.
- **Más monedas**: además de MXN y USD, se puede elegir CAD, EUR, GTQ, COP,
  CLP, ARS y PEN.

## [1.4.0] - 2026-09-30

La sincronización con el servidor funciona de verdad. Lo que se captura sube
en cuanto hay señal, lo hecho en otro dispositivo llega solo, y cuando algo no
sube la app explica por qué y cómo se arregla. Si dos dispositivos cambian lo
mismo, nada se pierde en silencio: lo que no choca se combina solo y lo que sí
choca lo decide el usuario. Todas las pantallas muestran ya los datos reales
del vehículo.

### Added
- **Sincronización real con el servidor**: los cambios capturados sin conexión
  se envían en cuanto vuelve la señal, y lo registrado en otro dispositivo llega
  a este. Si un cambio no es válido, se aparta solo y no detiene a los demás.
  Reenviar lo mismo tras un corte nunca duplica nada, y los datos de una cuenta
  son inaccesibles para cualquier otra.
- **Centro de sincronización**: en Ajustes, una sola entrada muestra el estado
  ("Al día", "3 por subir", "1 con error", "2 conflictos", "Sin conexión").
  Dentro hay dos vistas: *Actual*, con lo que falta por subir agrupado en
  conflictos, con error, bloqueado, pendiente y fotos, y *Historial*, con cada sincronización de los
  últimos 30 días y qué pasó con cada cambio. El botón para sincronizar
  aparece solo cuando hay algo por subir.
- **Diagnóstico de cada cambio que no subió**: qué pasó, en palabras
  sencillas, y cómo se soluciona. Distingue falta de señal, servidor caído o
  en mantenimiento, error interno del servidor y datos rechazados, con los
  campos exactos a corregir. Incluye la fecha y hora exactas y un identificador
  de solicitud que se puede copiar para encontrar el caso en los registros del
  servidor, aunque la respuesta nunca haya llegado.
- **Reintentar o descartar un cambio**: cualquier cambio pendiente se puede
  reintentar al momento. Uno rechazado se puede descartar: lo que el servidor
  nunca recibió se borra del dispositivo, y lo que sí tenía vuelve a su
  versión. Antes de confirmar se avisa qué otros cambios dependen de él.
- **Ediciones de dos dispositivos que se combinan solas**: si en un
  dispositivo se cambia la placa de un vehículo y en otro sus notas, al
  sincronizar quedan los dos cambios, sin preguntar. El Historial lo registra
  como "Se combinó con otro dispositivo".
- **Conflictos que decide el usuario**: cuando dos dispositivos cambian el
  mismo campo con valores distintos, se edita algo que otro dispositivo borró,
  o se registra algo dentro de un registro borrado, el cambio no se descarta:
  aparece en la sección *Conflictos* del centro de sincronización. El detalle
  muestra las dos versiones lado a lado, solo en los campos que chocan, y aparte
  lo que se combinó solo. Se puede conservar la versión propia, usar la del
  otro dispositivo o elegir campo por campo; un registro borrado se puede
  restaurar con los cambios propios o aceptar su borrado. Mientras haya
  conflictos, lo que depende de ellos espera y no se puede cerrar sesión. Cada
  decisión queda en el Historial.
- **Cambios que esperan a otros**: un registro que depende de otro que no pudo
  subir (por ejemplo, una carga de un vehículo rechazado) queda en espera y
  sale solo en cuanto el otro sube, en vez de fallar.
- **Subida de pendientes con la app cerrada**: en la app instalada, lo que
  quedó en cola se envía al volver la señal aunque la app no esté abierta, y
  hay una revisión aproximadamente diaria. Lo demás se completa al abrir la
  app.
- **Captura de cargas, servicios, gastos y odómetro**: formularios sencillos
  para registrar una carga de combustible (litros, monto, precio, rayitas antes
  y después, tanque lleno), un servicio con sus conceptos del catálogo, un
  gasto por categoría y una lectura de odómetro. Se guardan al instante en el
  dispositivo y se sincronizan solos.

### Changed
- **Todas las pantallas muestran datos reales**: Garage, Combustible,
  Servicios, Gastos y Ajustes leen lo guardado en el dispositivo, con mensajes
  claros cuando todavía no hay nada. Rendimiento, costo por kilómetro y demás
  métricas muestran lo que ya tenga guardado cada registro, o un guion
  mientras no existan los cálculos. Unidades y moneda salen de la cuenta.
- **Sincronización reactiva y sin consumo innecesario**: la app sincroniza al
  abrirse y justo después de cada cambio. Solo reintenta mientras quede algo
  por subir, y deja de hacerlo en cuanto todo está en el servidor. Sin
  pendientes no hace peticiones: al volver a la app solo consulta si pasaron
  unos minutos, y una revisión de respaldo cada 10 minutos atrapa lo que se
  haya escapado.
- **Los fallos pasajeros nunca se dan por perdidos**: sin señal o con el
  servidor caído, un cambio se reintenta sin límite, espaciando los intentos.
  Solo lo que el servidor rechaza pasa a "con error".
- **El reloj del dispositivo ya no decide qué versión gana**: los choques se
  detectan por la versión del registro que tenía cada dispositivo, así que un
  teléfono con la hora atrasada ya no pierde sus cambios. Un registro borrado
  en otro dispositivo solo vuelve si el usuario elige restaurarlo, y no se
  puede registrar nada nuevo dentro de él.
- **Direcciones de la app en inglés**: las rutas pasan a `/fuel`, `/services`,
  `/expenses`, `/settings`, `/settings/sync`, `/welcome`, etc. Los textos
  siguen en español. Los enlaces guardados con las direcciones anteriores
  llevan al Garage.

### Removed
- **Las siete filas de sincronización de Ajustes** y los grupos sin datos
  reales detrás (Recordatorios, Agregar vehículo, Vehículos archivados): todo
  lo de sincronización vive ahora en el centro de sincronización.

## [1.3.0] - 2026-09-28

La aplicación ya sabe de quién es. Cada dispositivo tiene un dueño con una
sesión que dura meses sin pedir contraseña, que nunca bloquea los datos
locales aunque no haya señal, y que deja todo listo para que la
sincronización con el servidor funcione de verdad.

### Added
- **Cuentas e inicio de sesión**: la app pide iniciar sesión la primera vez y
  después funciona sin red de forma indefinida. La sesión se renueva sola en
  segundo plano; quien abre la app al menos una vez cada dos meses no vuelve a
  escribir su contraseña. No hay registro público: las cuentas las crea quien
  administra el servidor.
- **Sesiones seguras por dispositivo**: cada teléfono o computadora tiene su
  propia sesión, que se puede cerrar sin afectar a las demás. La credencial de
  larga duración nunca queda al alcance del código de la página, y si alguien
  llegara a copiarla, el sistema lo detecta y cierra esa sesión.
- **Una sesión vencida no detiene la app**: si la sesión expira, la aplicación
  sigue abriendo y guardando con normalidad; solo la sincronización espera a
  que el usuario vuelva a entrar, y nada de lo pendiente se pierde ni se da por
  fallido.
- **Cierre de sesión sin pérdida de datos**: cerrar sesión solo se permite
  cuando todo lo capturado ya está en el servidor, y la pantalla explica qué
  falta cuando no se puede. Para el caso extremo de una cuenta irrecuperable
  existe una salida explícita que exige confirmación escrita.
- **Ventana de sincronización al entrar**: después de cada inicio de sesión el
  dispositivo se pone al día con la cuenta antes de mostrar nada, con el avance
  a la vista. Si el servidor no responde, se puede seguir sin esperar.
- **Wizard de bienvenida**: la primera vez se configura la cuenta y el primer
  vehículo, incluidas las rayitas del medidor de gasolina con una vista previa
  en vivo. Todo se guarda al instante, así que se puede cerrar la app a medias
  —por ejemplo, para ir a contar las rayitas— y retomarla en el mismo paso,
  incluso desde otro dispositivo.
- **Administración de cuentas desde la terminal**: crear cuentas, cambiar
  contraseñas y cerrar todas las sesiones de alguien (por ejemplo, ante un
  teléfono perdido), con asistentes interactivos cuando no se pasan datos.
- **Documentación de sesiones y de la API**: cómo funciona la autenticación de
  punta a punta, qué decisiones se tomaron y cuáles se descartaron, y el
  contrato común de todas las respuestas del servidor.

### Changed
- **Respuestas del servidor uniformes**: toda respuesta, de éxito o de error,
  tiene la misma forma y un código estable que la app puede interpretar sin
  depender del texto. Cada respuesta lleva un identificador que permite rastrear
  un error reportado sin que el servidor revele nada de su funcionamiento
  interno.
- **Ajustes muestra la cuenta**: quién es el dueño del dispositivo, el estado de
  la sesión y el cierre de sesión con sus condiciones.
- **El catálogo inicial se siembra después de la primera sincronización**, para
  que un segundo dispositivo no duplique los tipos de servicio y las categorías
  que la cuenta ya tiene.
- **Las pruebas del backend corren contra su propia base de datos**, igual a la
  de producción, y se niegan a ejecutarse si apuntan a cualquier otra.

### Removed
- **La verificación de salud pública**: el estado del servidor solo se puede
  consultar desde el propio servidor, y ya no informa versiones ni detalles
  internos. Para cualquier otro, la ruta no existe.

### Fixed
- **Usar la app desde el celular en la red local**: al abrirla por la IP de la
  computadora, el servidor rechazaba todas sus peticiones. Ahora se aceptan en
  desarrollo, como ya prometía la documentación.

## [1.2.1] - 2026-09-29

### Added
- **Instalar la aplicación desde Ajustes**: un botón lanza la instalación
  nativa del navegador, sin depender de encontrarla escondida en su menú. En
  iPhone, donde el sistema no permite instalar desde un botón, se indica el
  camino manual; y una vez instalada, Ajustes lo refleja.
- **Actualizaciones bajo control del usuario**: la aplicación sigue abriendo al
  instante con la versión guardada en el dispositivo, pero ahora busca versiones
  nuevas en segundo plano —al abrirse, al volver al frente y periódicamente
  mientras está abierta— y avisa cuando hay una lista. El usuario decide cuándo
  aplicarla, para que la aplicación nunca se recargue a media captura. También
  se puede buscar una actualización a mano.
- **Recuperación ante una copia local dañada**: si la versión guardada en el
  dispositivo queda inservible, la aplicación se recarga sola desde el servidor
  en lugar de quedarse rota.

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
