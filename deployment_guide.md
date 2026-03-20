# Guía de Despliegue Paso a Paso - Chibalete+ (Hostinger VPS)

Esta guía te llevará de la mano para poner tu aplicación en internet. No necesitas ser un experto, solo sigue los pasos con calma.

## 1. Preparación en tu Computadora (Local)

Antes de tocar el servidor, vamos a dejar todo listo en tu máquina.

1.  **Abre la terminal** en VS Code.
2.  **Construye la aplicación**: Esto convierte tu código de desarrollo en código optimizado para internet.
    ```bash
    npm run build
    ```
    *Deberías ver una carpeta llamada `dist` nueva o actualizada.*

3.  **Prepara los archivos**:
    Vamos a subir todo el proyecto **EXCEPTO** la carpeta `node_modules` y `.git`.
    Lo más fácil es comprimir los siguientes archivos y carpetas en un archivo `.zip` llamado `chibalete.zip`:
    -   `dist` (carpeta)
    -   `server` (carpeta)
    -   `package.json`
    -   `package-lock.json`
    -   `ecosystem.config.cjs`
    -   `production-server.js` (si lo usas, aunque usaremos `server/server.js`)

## 2. Preparación del Servidor (VPS)

### Opción A: Terminal de Hostinger (Fácil)
1.  **Entra a tu Panel de Hostinger**: Ve a la sección de tu VPS.
2.  **Terminal de Navegador**: Busca el botón "Browser Terminal" (suele estar arriba a la derecha o en el menú lateral).
3.  **Inicia sesión**:
    -   Usuario: `root`
    -   Contraseña: La que pusiste al crear el VPS.
    *Nota: Al escribir la contraseña en Linux NO aparecen asteriscos. Tú escribe y da Enter con fe.*

### Opción B: Usar VS Code (Recomendado)
Si la terminal del navegador te falla, usa VS Code:
1.  En VS Code, abre una **nueva terminal** (`Ctrl + ñ` o Menú Terminal > New Terminal).
2.  Escribe esto (cambia los números por la IP de tu VPS):
    ```bash
    ssh root@123.45.67.89
    ```
3.  Escribe "yes" si te pregunta "Are you sure...".
4.  Pon tu contraseña (recuerda, no se ve) y Enter.

---

### Instalar las herramientas necesarias

Una vez dentro (debe decir algo como `root@tuserver:~#`), copia y pega estos comandos:

```bash
# 1. Actualizar la lista de programas
apt update && apt upgrade -y

# 2. Instalar Node.js (el motor de la app)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs


# 3. Comprobar instalación (debería salir un número de versión)
node -v 

# 4. Instalar PM2 (para mantener la app siempre viva)
npm install -g pm2

# 5. Instalar Nginx (el servidor web que recibe a los visitantes)
apt install -y nginx
```

## 3. Subir tu App al Servidor

1.  **Usar FileZilla (Recomendado)**:
    -   Descarga e instala [FileZilla Client](https://filezilla-project.org/).
    -   **Host/Servidor**: La IP de tu VPS (ej. `123.45.67.89`).
    -   **Usuario**: `root`
    -   **Contraseña**: Tu contraseña del VPS.
    -   **Puerto**: 22.
    -   Clic en "Conexión rápida".

2.  **Copiar archivos**:
    -   En el lado DERECHO (Sitio remoto), navega a la carpeta `/var/www/`.
    -   Crea una carpeta nueva llamada `chibalete`.
    -   Entra en esa carpeta (`/var/www/chibalete`).
    -   Desde el lado IZQUIERDO (tu PC), arrastra el archivo `chibalete.zip` que creamos antes.
    *Alternativa: Arrastra las carpetas `dist`, `server` y archivos `package.json`, etc. uno por uno si no hiciste el zip.*

3.  **Descomprimir (si subiste zip)**:
    -   Vuelve a la terminal del VPS.
    -   Ve a la carpeta:
        ```bash
        cd /var/www/chibalete
        ```
    -   Instala unzip si no está: `apt install -y unzip`
    -   Descomprime: `unzip chibalete.zip`

## 4. Encender la App

En la terminal del VPS (dentro de `/var/www/chibalete`):

1.  **Instalar dependencias**:
    ```bash
    npm install --production
    ```
2.  **Iniciar la app con PM2**:
    ```bash
    pm2 start ecosystem.config.cjs
    ```
3.  **Guardar para que inicie sola si se reinicia el servidor**:
    ```bash
    pm2 save
    pm2 startup
    ```
    *(Copia y pega el comando que te diga `pm2 startup` si sale uno).*

## 5. Configurar Nginx (Para ver la web)

1.  **Crear configuración**:
    ```bash
    nano /etc/nginx/sites-available/chibalete
    ```
2.  **Pegar esto** (Usa las flechas para moverte):
    *Cambia `TU_IP_O_DOMINIO` por la IP de tu VPS (ej. 123.45.67.89) o tu dominio si tienes.*

    ```nginx
    server {
        listen 80;
        server_name TU_IP_O_DOMINIO;

        location / {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }

        # Permitir subidas grandes
        client_max_body_size 50M;
    }
    ```
3.  **Guardar y Salir**: Presiona `Ctrl + X`, luego `Y`, luego `Enter`.

4.  **Activar el sitio**:
    ```bash
    ln -s /etc/nginx/sites-available/chibalete /etc/nginx/sites-enabled/
    rm /etc/nginx/sites-enabled/default  # Borrar el sitio por defecto
    ```

5.  **Reiniciar Nginx**:
    ```bash
    systemctl restart nginx
    ```

## ¡Listo!
Ahora pon la IP de tu VPS en tu navegador. ¡Deberías ver tu app funcionando!

### Comandos Útiles para el Futuro
-   Ver logs (errores): `pm2 logs`
-   Reiniciar app: `pm2 restart chibalete-app`
-   Parar app: `pm2 stop chibalete-app`
