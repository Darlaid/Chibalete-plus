# 🚨 ¡AUXILIO! NO PUEDO CONECTAR (Timeout port 22)

Si recibes el error `Connection timed out` al intentar `scp` o `ssh`, significa que **te has quedado fuera del servidor** (probablemente el firewall se activó y cerró el puerto 22, o el servidor está apagado).

**NO podrás conectarte desde tu PC hasta arreglarlo.** Debes entrar por la "Puerta de Atrás".

## Paso 1: Entrar por la Consola Web de Hostinger
1.  Ve a tu panel de control de Hostinger.
2.  Busca tu VPS.
3.  Busca un botón que diga **"Browser Terminal"**, **"VNC Console"**, o **"Emergency Console"**.
4.  Inicia sesión (usuario `root`, contraseña de tu VPS).

## Paso 2: Romper el Bloqueo (Ejecutar en la Consola Web)
Una vez dentro de esa pantalla negra en el navegador, escribe esto para abrir todo inmediatamente:

```bash
# 1. Desactivar el firewall temporalmente para probar
ufw disable

# 2. O permitir explícitamente SSH y Web
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```
*Si te pregunta "Command may disrupt existing ssh connections...", escribe `y` y dale Enter.*

## Paso 3: Probar Conexión Local
Ahora vuelve a tu PowerShell en Windows e intenta de nuevo el comando SCP:
```powershell
scp "d:\001 - app - Chibalete+\deploy_vps.zip" root@72.60.158.97:/root/
```
¡Debería funcionar ahora!
