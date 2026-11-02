FROM php:8.2-cli-alpine

# Install PostgreSQL client libraries and system utilities
RUN apk add --no-cache libpq-dev bash git curl unzip \
    && docker-php-ext-install pdo pdo_pgsql

# Install Composer binary from official image
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www

# Copy application files
COPY . .

# Ensure all Laravel storage and cache directories exist before setting permissions
RUN mkdir -p storage/app/public \
             storage/framework/cache/data \
             storage/framework/sessions \
             storage/framework/views \
             storage/logs \
             bootstrap/cache

# Install PHP production dependencies
RUN composer install --no-dev --optimize-autoloader --no-interaction

# Set directory permissions for Laravel runtime caching
RUN chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

EXPOSE 8080

# Run migrations, optimize caches, and bind to the dynamic Render $PORT
CMD sh -c "php artisan config:cache && php artisan route:cache && php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=\${PORT:-8080}"