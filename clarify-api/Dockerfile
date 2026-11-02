FROM php:8.2-cli-alpine

# Install PostgreSQL client libraries and system utilities
RUN apk add --no-cache libpq-dev bash git curl unzip \
    && docker-php-ext-install pdo pdo_pgsql

# Install Composer binary from official image
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www

# Copy application files
COPY . .

# Ensure storage, cache, and public directories exist
RUN mkdir -p storage/app/public \
             storage/framework/cache/data \
             storage/framework/sessions \
             storage/framework/views \
             storage/logs \
             bootstrap/cache \
             public \
    && rm -f bootstrap/cache/*.php

# Install PHP production dependencies
RUN composer install --no-dev --optimize-autoloader --no-interaction

# Set directory permissions for Laravel runtime caching
RUN chown -R www-data:www-data storage bootstrap/cache public \
    && chmod -R 775 storage bootstrap/cache public

EXPOSE 8080

# Clear old configuration cache, run migrations, and bind to Render's dynamic port
CMD sh -c "php artisan config:clear && php artisan route:clear && php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=\${PORT:-8080}"