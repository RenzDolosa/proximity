@echo off
cd C:\xampp\htdocs\yourproject
git pull origin main
echo Updated: %date% %time% >> update_log.txt