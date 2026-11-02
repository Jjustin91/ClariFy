FROM php:8.2-cli-alpine

# Install system dependencies and PostgreSQL driver
RUN apk add --no-cache libpq-dev bash git \
    && docker-php-ext-install pdo pdo_pgsql

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www

# Copy application files
COPY . .

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader --no-interaction

# Set storage and cache permissions
RUN chown -R www-data:www-data storage bootstrap/cache

EXPOSE 8080

# Cache configs, run migrations, and start Laravel on Render's dynamic port
CMD sh -c "php artisan config:cache && php artisan route:cache && php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=${PORT:-8080}"