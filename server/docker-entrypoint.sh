#!/usr/bin/env bash
# Entrypoint de piston-server.
# El código vive en un bind mount (./server:/var/www/html), así que lo que se
# instala durante el build queda oculto. Por eso preparamos el entorno aquí.
set -e

cd /var/www/html

# 1. Dependencias de Composer (vendor/ está en .gitignore y lo tapa el bind mount)
if [ ! -f vendor/autoload.php ]; then
  echo "[piston] Instalando dependencias de Composer..."
  composer install --no-interaction --prefer-dist
fi

# 2. Directorios que Laravel necesita en tiempo de ejecución
mkdir -p storage/framework/{cache/data,sessions,views} storage/logs bootstrap/cache
# Solo los DIRECTORIOS: un chmod -R marcaría también los .gitignore versionados
# y cada arranque dejaría cambios de permisos en el git del host.
find storage bootstrap/cache -type d -exec chmod 777 {} + 2>/dev/null || true

# 3. Archivo .env y APP_KEY
if [ ! -f .env ]; then
  echo "[piston] Creando server/.env a partir de .env.example..."
  cp .env.example .env
fi

if ! grep -qE '^APP_KEY=base64:.+' .env; then
  echo "[piston] Generando APP_KEY..."
  php artisan key:generate --force --no-interaction
fi

# 4. Esperar a PostgreSQL antes de arrancar
echo "[piston] Esperando a la base de datos en ${DB_HOST}:${DB_PORT}..."
until php -r "new PDO('pgsql:host='.getenv('DB_HOST').';port='.getenv('DB_PORT').';dbname='.getenv('DB_DATABASE'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'));" 2>/dev/null; do
  sleep 2
done
echo "[piston] Base de datos lista."

# 5. Migraciones automáticas (desactívalo con RUN_MIGRATIONS=false)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  php artisan migrate --force --no-interaction
fi

php artisan config:clear >/dev/null 2>&1 || true

exec "$@"
