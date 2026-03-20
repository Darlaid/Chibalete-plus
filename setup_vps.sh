#!/bin/bash

# Colores para los mensajes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Iniciando Configuración Automática del Servidor VPS ===${NC}"

# 1. Actualizar sistema
echo -e "${GREEN}1. Actualizando lista de paquetes...${NC}"
apt update -y

# 2. Instalar herramientas básicas
echo -e "${GREEN}2. Instalando unzip, curl y gnupg...${NC}"
apt install -y unzip curl gnupg

# 3. Disponer Node.js 20 (LTS)
echo -e "${GREEN}3. Instalando Node.js 20...${NC}"
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
apt update -y
apt install -y nodejs

# 4. Instalar PM2 y Nginx
echo -e "${GREEN}4. Instalando PM2 y Nginx...${NC}"
npm install -g pm2
apt install -y nginx

# 5. Configurar Firewall (UFW)
echo -e "${GREEN}5. Configurando Firewall...${NC}"
ufw allow OpenSSH
ufw allow 'Nginx Full'
# Por si acaso, explicitamente puertos 80 y 443
ufw allow 80
ufw allow 443
echo "y" | ufw enable

# 6. Preparar carpetas de la aplicación
echo -e "${GREEN}6. Preparando carpeta de la app (/var/www/chibalete)...${NC}"
mkdir -p /var/www/chibalete

# 7. Configurar Nginx
echo -e "${GREEN}7. Configurando sitio en Nginx...${NC}"
cat > /etc/nginx/sites-available/default <<EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Reiniciar Nginx para aplicar cambios
systemctl restart nginx

echo -e "${BLUE}=== Configuración del Servidor Completa ===${NC}"
echo -e "Ahora puedes proceder a desplegar la aplicación."
