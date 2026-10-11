#!/usr/bin/env bash
# =============================================================================
# up.sh — Arranque del stack Docker de Piston
#
# Uso:
#   ./up.sh                    Levanta el stack (siempre con --force-recreate)
#   ./up.sh --build            Reconstruye las imágenes antes de levantar
#   ./up.sh --no-cache         Reconstruye sin caché de Docker (implica --build)
#   ./up.sh --setup            Asistente de instalación paso a paso
#   ./up.sh --wait             Espera a que la API responda antes de terminar
#   ./up.sh --logs             Sigue los logs al terminar
#   ./up.sh [opciones] <svc>   Solo esos servicios (server, app, db)
#
# Qué hace siempre, antes de llamar a docker compose:
#   - Comprueba que Docker y Compose v2 estén disponibles y el daemon arriba.
#   - Crea .env desde .env.example si no existe.
#   - Devuelve al usuario del host los archivos de server/ y app/ que dejaron
#     los contenedores con dueño root. Un directorio root con permisos 700
#     dentro del build context hace fallar el build con:
#       error from sender: open .../storage/framework/testing/disks: permission denied
#     El chown corre dentro de un contenedor efímero: no hace falta sudo.
#
# Con --build se renuevan también los volúmenes anónimos (node_modules de
# piston-app): si no, el contenedor nuevo hereda el node_modules viejo y no ve
# los paquetes que se acaban de instalar en la imagen. Los datos de PostgreSQL
# viven en un volumen con nombre (piston_pgdata) y no se tocan.
#
# --setup recorre la instalación completa: requisitos, configuración de .env
# con formularios (puertos, URLs, credenciales de la base), build, arranque,
# espera al entrypoint de piston-server (composer, APP_KEY, migraciones) y
# creación de la primera cuenta.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
DB_VOLUME="piston_pgdata"
HELPER_IMAGE="alpine:3.20"
WAIT_TIMEOUT=600
# Caracteres que Compose interpreta dentro de .env (interpolación, comentarios, comillas)
UNSAFE_SECRET_CHARS='[[:space:]$#"\\`'"']"

BUILD=false
NO_CACHE=false
SETUP=false
WAIT=false
FOLLOW_LOGS=false
SERVICES=()

# -----------------------------------------------------------------------------
# Salida
# -----------------------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

info()  { echo "${BLUE}[piston]${RESET} $*"; }
ok()    { echo "${GREEN}[piston]${RESET} $*"; }
warn()  { echo "${YELLOW}[piston]${RESET} $*" >&2; }
fail()  { echo "${RED}[piston]${RESET} $*" >&2; exit 1; }
step()  { echo; echo "${BOLD}== $* ==${RESET}"; }

usage() {
  sed -n '3,/^# =\{10,\}$/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

# -----------------------------------------------------------------------------
# Formularios
# -----------------------------------------------------------------------------

# ask VAR "Pregunta" "valor por defecto"
ask() {
  local __var="$1" label="$2" default="${3:-}" answer
  read -r -p "  ${label}${default:+ ${DIM}[$default]${RESET}}: " answer
  printf -v "$__var" '%s' "${answer:-$default}"
}

# confirm "Pregunta" s|n  → 0 si la respuesta es sí
confirm() {
  local label="$1" default="${2:-n}" hint answer
  [[ "$default" == "s" ]] && hint="S/n" || hint="s/N"
  read -r -p "  ${label} [${hint}]: " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[sSyY] ]]
}

# ask_port VAR "Pregunta" "defecto"
ask_port() {
  local __var="$1" label="$2" default="$3" value holder
  while true; do
    ask value "$label" "$default"
    if ! [[ "$value" =~ ^[0-9]+$ ]] || (( value < 1 || value > 65535 )); then
      warn "Puerto inválido: $value"
      continue
    fi
    holder="$(port_holder "$value")"
    if [[ -n "$holder" && "$holder" != piston-* ]]; then
      warn "El puerto $value está ocupado por: $holder"
      confirm "¿Usarlo de todos modos?" n || continue
    fi
    printf -v "$__var" '%s' "$value"
    return
  done
}

# Quién ocupa un puerto del host: el contenedor que lo publica, "otro proceso"
# o nada. Los contenedores de Piston no cuentan: --force-recreate los reemplaza.
port_holder() {
  local port="$1" name
  name="$(docker ps --filter "publish=$port" --format '{{.Names}}' 2>/dev/null | head -n1)"
  if [[ -n "$name" ]]; then
    echo "$name"
  elif (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "otro proceso"
  fi
}

# ask_secret VAR "Pregunta"  → vacío = generar una contraseña aleatoria
ask_secret() {
  local __var="$1" label="$2" first second
  while true; do
    read -r -s -p "  ${label} ${DIM}[vacío = generar una]${RESET}: " first; echo
    if [[ -z "$first" ]]; then
      first="$(random_secret)"
      info "Contraseña generada; queda guardada en .env."
      printf -v "$__var" '%s' "$first"
      return
    fi
    # Compose interpola '$' y corta en '#' o espacios; las comillas romperían el .env
    if [[ "$first" =~ $UNSAFE_SECRET_CHARS ]]; then
      warn "Sin espacios ni los caracteres \$ # ' \" \\ \` (Compose los interpreta en .env)."
      continue
    fi
    if (( ${#first} < 8 )); then
      warn "Mínimo 8 caracteres."
      continue
    fi
    read -r -s -p "  Repite la contraseña: " second; echo
    if [[ "$first" != "$second" ]]; then
      warn "No coinciden."
      continue
    fi
    printf -v "$__var" '%s' "$first"
    return
  done
}

random_secret() {
  # Alfanumérica: segura dentro de .env, de un DSN y de la línea de comandos
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32 || true
}

# -----------------------------------------------------------------------------
# .env
# -----------------------------------------------------------------------------

env_get() {
  local key="$1" file="${2:-$ENV_FILE}"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -E "s/^['\"](.*)['\"]$/\1/" || true
}

# Reemplaza la clave si existe; si no, la agrega al final.
env_set() {
  local key="$1" value="$2" file="${3:-$ENV_FILE}" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

ensure_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    info "Creado .env a partir de .env.example (valores por defecto)."
  fi
}

# -----------------------------------------------------------------------------
# Comprobaciones
# -----------------------------------------------------------------------------

check_docker() {
  command -v docker >/dev/null 2>&1 \
    || fail "Docker no está instalado: https://docs.docker.com/get-docker/"
  docker compose version >/dev/null 2>&1 \
    || fail "Falta Docker Compose v2 ('docker compose', no 'docker-compose')."
  docker info >/dev/null 2>&1 \
    || fail "El daemon de Docker no responde. ¿Está abierto Docker Desktop (o 'sudo service docker start')?"
}

# Devuelve al usuario del host lo que los contenedores (root) dejaron en el
# código. Se poda node_modules y vendor: no entran al build context y son
# enormes; si quedaron de root, './piston own' los recupera.
fix_ownership() {
  local uid gid list count
  uid="$(id -u)"; gid="$(id -g)"
  (( uid == 0 )) && return 0

  list="$(find server app \
    \( -path app/node_modules -o -path server/vendor -o -path app/.angular \) -prune \
    -o \( ! -user "$uid" -o ! -readable \) -print0 2>/dev/null | tr '\0' '\n' || true)"
  [[ -z "$list" ]] && return 0

  count="$(printf '%s\n' "$list" | wc -l | tr -d ' ')"
  info "Recuperando $count archivo(s) con dueño root (dejados por un contenedor)..."
  printf '%s\n' "$list" | sed -n '1,5p' | sed "s/^/    ${DIM}/;s/$/${RESET}/"
  (( count > 5 )) && echo "    ${DIM}...${RESET}"

  printf '%s\n' "$list" | tr '\n' '\0' \
    | docker run --rm -i -v "$ROOT_DIR:/work" -w /work "$HELPER_IMAGE" \
        xargs -0 chown -R "$uid:$gid" \
    || warn "No se pudo cambiar el dueño; el build puede fallar. Prueba: sudo chown -R $uid:$gid server app"
}

# -----------------------------------------------------------------------------
# Asistente (--setup)
# -----------------------------------------------------------------------------

setup_env() {
  step "2/5 Configuración (.env)"

  local reconfigure=true
  if [[ -f "$ENV_FILE" ]]; then
    info "Ya existe un .env."
    confirm "¿Revisar y ajustar sus valores?" s || reconfigure=false
  fi
  $reconfigure || return 0

  local source="$ENV_FILE"
  [[ -f "$ENV_FILE" ]] || source="$ENV_EXAMPLE"
  get() { local v; v="$(env_get "$1" "$source")"; echo "${v:-$2}"; }

  OLD_DB_DATABASE="$(env_get DB_DATABASE)"
  OLD_DB_USERNAME="$(env_get DB_USERNAME)"
  OLD_DB_PASSWORD="$(env_get DB_PASSWORD)"

  echo
  echo "  ${BOLD}Aplicación${RESET}"
  local app_name app_env app_debug
  ask app_name "Nombre" "$(get APP_NAME Piston)"
  while true; do
    ask app_env "Entorno (local | production)" "$(get APP_ENV local)"
    [[ "$app_env" == "local" || "$app_env" == "production" ]] && break
    warn "Usa 'local' o 'production'."
  done
  local debug_default=s
  [[ "$(get APP_DEBUG true)" == "false" ]] && debug_default=n
  [[ "$app_env" == "production" ]] && debug_default=n
  if confirm "¿Modo debug (errores detallados)?" "$debug_default"; then app_debug=true; else app_debug=false; fi
  [[ "$app_env" == "production" && "$app_debug" == "true" ]] \
    && warn "Debug en producción expone trazas y configuración en las respuestas de error."

  echo
  echo "  ${BOLD}Puertos del host${RESET}"
  local app_port server_port db_port old_app_port old_server_port
  old_app_port="$(get APP_PORT 4300)"
  old_server_port="$(get SERVER_PORT 8088)"
  ask_port app_port "Frontend (Angular)" "$old_app_port"
  ask_port server_port "API (Laravel)" "$old_server_port"
  ask_port db_port "PostgreSQL" "$(get DB_PORT 5438)"
  [[ "$server_port" != "8088" ]] \
    && warn "El frontend de desarrollo apunta a :8088 (app/src/environments/environment.development.ts). Ajústalo también ahí."

  echo
  echo "  ${BOLD}URLs${RESET}"
  # Si la URL guardada era la de por defecto, se recalcula con el puerto nuevo
  local app_url frontend_url url_default
  url_default="$(get APP_URL "http://localhost:$server_port")"
  [[ "$url_default" == "http://localhost:$old_server_port" ]] && url_default="http://localhost:$server_port"
  ask app_url "URL pública de la API" "$url_default"
  url_default="$(get FRONTEND_URL "http://localhost:$app_port")"
  [[ "$url_default" == "http://localhost:$old_app_port" ]] && url_default="http://localhost:$app_port"
  ask frontend_url "URL del frontend (origen permitido por CORS)" "$url_default"

  echo
  echo "  ${BOLD}Base de datos${RESET}"
  local db_database db_username db_password current_password
  ask db_database "Nombre de la base" "$(get DB_DATABASE piston)"
  ask db_username "Usuario" "$(get DB_USERNAME piston_user)"
  current_password="$(get DB_PASSWORD '')"
  if [[ -n "$current_password" && "$current_password" != "piston_secret_password" ]] \
     && confirm "¿Conservar la contraseña actual?" s; then
    db_password="$current_password"
  else
    [[ "$current_password" == "piston_secret_password" ]] \
      && info "La contraseña actual es la de ejemplo; conviene cambiarla."
    ask_secret db_password "Contraseña"
  fi

  if [[ -f "$ENV_FILE" ]]; then
    cp "$ENV_FILE" "$ENV_FILE.backup"
    info "Copia del .env anterior en .env.backup"
  else
    cp "$ENV_EXAMPLE" "$ENV_FILE"
  fi

  env_set APP_NAME "$app_name"
  env_set APP_ENV "$app_env"
  env_set APP_DEBUG "$app_debug"
  env_set APP_PORT "$app_port"
  env_set SERVER_PORT "$server_port"
  env_set DB_PORT "$db_port"
  env_set APP_URL "$app_url"
  env_set FRONTEND_URL "$frontend_url"
  env_set DB_DATABASE "$db_database"
  env_set DB_USERNAME "$db_username"
  env_set DB_PASSWORD "$db_password"
  ok ".env guardado."

  check_db_volume
}

# PostgreSQL solo lee POSTGRES_* al inicializar un volumen vacío. Con un
# volumen existente, cambiar las credenciales en .env no cambia las de la base
# y piston-server se quedaría esperando la conexión para siempre.
check_db_volume() {
  docker volume inspect "$DB_VOLUME" >/dev/null 2>&1 || return 0
  [[ -z "${OLD_DB_DATABASE:-}${OLD_DB_USERNAME:-}${OLD_DB_PASSWORD:-}" ]] && return 0
  if [[ "$(env_get DB_DATABASE)" == "$OLD_DB_DATABASE" \
     && "$(env_get DB_USERNAME)" == "$OLD_DB_USERNAME" \
     && "$(env_get DB_PASSWORD)" == "$OLD_DB_PASSWORD" ]]; then
    return 0
  fi

  echo
  warn "Cambiaron las credenciales de la base, pero el volumen '$DB_VOLUME' ya existe."
  warn "PostgreSQL conserva las credenciales con que se creó y no aceptará las nuevas."
  echo "    1) Volver a las credenciales anteriores (recomendado si hay datos)"
  echo "    2) Borrar el volumen y crear la base desde cero"
  echo "    3) Seguir así (ya las cambié a mano dentro de PostgreSQL)"
  local choice
  while true; do
    ask choice "Opción" "1"
    case "$choice" in
      1)
        env_set DB_DATABASE "$OLD_DB_DATABASE"
        env_set DB_USERNAME "$OLD_DB_USERNAME"
        env_set DB_PASSWORD "$OLD_DB_PASSWORD"
        ok "Credenciales de la base restauradas en .env."
        return ;;
      2)
        echo
        echo "  ${RED}${BOLD}Esto borra TODOS los datos de PostgreSQL de Piston y no se puede deshacer.${RESET}"
        local typed
        ask typed "Escribe 'borrar' para confirmar" ""
        if [[ "$typed" != "borrar" ]]; then
          warn "Cancelado."
          continue
        fi
        docker compose down >/dev/null 2>&1 || true
        docker volume rm "$DB_VOLUME" >/dev/null
        ok "Volumen '$DB_VOLUME' borrado; la base se crea de nuevo al arrancar."
        return ;;
      3) return ;;
      *) warn "Elige 1, 2 o 3." ;;
    esac
  done
}

# Espera a que el entrypoint de piston-server termine (composer, APP_KEY,
# migraciones) y la API responda. /api/health solo acepta loopback, así que se
# consulta desde dentro del contenedor.
wait_for_api() {
  local server=piston-server elapsed=0 last="" line state
  info "Esperando a que $server termine de arrancar (composer, APP_KEY, migraciones)..."
  while (( elapsed < WAIT_TIMEOUT )); do
    if docker compose exec -T "$server" curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
      ok "API lista."
      return 0
    fi

    state="$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$server" 2>/dev/null || echo "missing 0")"
    if [[ "$state" == exited* || "$state" == missing* || "${state#* }" -gt 0 ]]; then
      echo
      warn "$server se detuvo o se reinicia ($state). Últimas líneas:"
      docker compose logs --tail 30 "$server" >&2 || true
      return 1
    fi

    line="$(docker compose logs --tail 1 --no-log-prefix "$server" 2>/dev/null | tr -d '\r' | cut -c1-100)"
    if [[ -n "$line" && "$line" != "$last" ]]; then
      echo "    ${DIM}$line${RESET}"
      last="$line"
    fi
    sleep 3
    elapsed=$(( elapsed + 3 ))
  done
  warn "La API no respondió en ${WAIT_TIMEOUT}s. Revisa: ./piston logs server"
  return 1
}

setup_account() {
  step "5/5 Primera cuenta"
  info "No hay registro público: las cuentas se crean desde el servidor."
  confirm "¿Crear una cuenta ahora?" s || {
    info "Cuando quieras: ./artisan piston:user:create tu@correo.com --name=\"Tu Nombre\""
    return 0
  }
  # Sin argumentos el comando abre su propio asistente (pide la contraseña sin eco)
  docker compose exec piston-server php artisan piston:user:create \
    || warn "No se creó la cuenta. Reintenta con: ./artisan piston:user:create"
}

summary() {
  local app_port server_port db_port
  app_port="$(env_get APP_PORT)"; server_port="$(env_get SERVER_PORT)"; db_port="$(env_get DB_PORT)"
  echo
  ok "${BOLD}Piston está arriba.${RESET}"
  echo "    Frontend    http://localhost:${app_port:-4300}  ${DIM}(el primer build de Angular tarda un poco)${RESET}"
  echo "    API         http://localhost:${server_port:-8088}"
  echo "    PostgreSQL  localhost:${db_port:-5438}"
  echo
  echo "    ${DIM}./piston ps · ./piston logs [server|app|db] · ./piston health${RESET}"
}

# -----------------------------------------------------------------------------
# Argumentos
# -----------------------------------------------------------------------------

while (( $# )); do
  case "$1" in
    --build|-b)     BUILD=true ;;
    --no-cache)     BUILD=true; NO_CACHE=true ;;
    --setup|-s)     SETUP=true; BUILD=true; WAIT=true ;;
    --wait|-w)      WAIT=true ;;
    --logs|-f)      FOLLOW_LOGS=true ;;
    -h|--help)      usage; exit 0 ;;
    -*)             fail "Opción desconocida: $1 (./up.sh --help)" ;;
    server|api)     SERVICES+=(piston-server) ;;
    app|front)      SERVICES+=(piston-app) ;;
    db|database)    SERVICES+=(piston-db) ;;
    *)              SERVICES+=("$1") ;;
  esac
  shift
done

if $SETUP && [[ ! -t 0 ]]; then
  fail "--setup es interactivo: ejecútalo desde una terminal."
fi

# -----------------------------------------------------------------------------
# Flujo
# -----------------------------------------------------------------------------

$SETUP && step "1/5 Requisitos"
check_docker
$SETUP && ok "Docker $(docker version --format '{{.Server.Version}}') y $(docker compose version --short | sed 's/^/Compose /')."

if $SETUP; then
  setup_env
else
  ensure_env
fi

$SETUP && step "3/5 Build y arranque"
fix_ownership

if $NO_CACHE; then
  info "Construyendo imágenes sin caché..."
  docker compose build --no-cache ${SERVICES[@]+"${SERVICES[@]}"}
fi

UP_ARGS=(up -d --force-recreate --remove-orphans)
if $BUILD && ! $NO_CACHE; then UP_ARGS+=(--build); fi
if $BUILD; then UP_ARGS+=(--renew-anon-volumes); fi

info "docker compose ${UP_ARGS[*]} ${SERVICES[*]:-}"
docker compose "${UP_ARGS[@]}" ${SERVICES[@]+"${SERVICES[@]}"}

# Esperar a la API solo tiene sentido si piston-server está entre lo levantado
if $WAIT && (( ${#SERVICES[@]} )) && [[ " ${SERVICES[*]} " != *" piston-server "* ]]; then
  WAIT=false
fi

if $WAIT; then
  $SETUP && step "4/5 Entrypoint de piston-server"
  if ! wait_for_api; then
    $SETUP && fail "La instalación no terminó. Corrige el error y vuelve a correr ./up.sh --setup"
    exit 1
  fi
fi

$SETUP && setup_account

docker compose ps
summary

if $FOLLOW_LOGS; then
  docker compose logs -f ${SERVICES[@]+"${SERVICES[@]}"}
fi
