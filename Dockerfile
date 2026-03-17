FROM php:8.2-apache
COPY htdocs/ /var/www/html/
EXPOSE 80