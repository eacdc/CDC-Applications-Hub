@echo off
echo Finding your IP address for web testing...
echo.
echo Your IP addresses:
ipconfig | findstr "IPv4"
echo.
echo Use one of these IP addresses in lib/config/api_config.dart
echo Replace the webUrl with: http://YOUR_IP:3001/api
echo.
pause
