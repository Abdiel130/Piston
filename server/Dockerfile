FROM php:8.5-cli

# Set working directory
WORKDIR /var/www/html

# Install system dependencies and required PHP extensions
# (Note: PDO, OPcache, mbstring, curl, and json are already compiled into PHP 8.5)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libpq-dev \
    libzip-dev \
    zip \
    unzip \
    && docker-php-ext-install pdo_pgsql pgsql bcmath zip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Composer from official image
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Install PHP dependencies first (capa cacheable)
COPY composer.json composer.lock ./
RUN composer install --no-interaction --prefer-dist --no-scripts --no-autoloader

# Copy application files
COPY . /var/www/html

RUN composer dump-autoload --optimize

# Adjust permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache 2>/dev/null || true

# Expose Artisan serve port
EXPOSE 8000

ENTRYPOINT ["/var/www/html/docker-entrypoint.sh"]

# Start command
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
