# 🗄️ ARCHIVADO — Kit de Emergencia (PM2-first, primera instalación)

> 🔴 **AVISO IMPORTANTE — DOCUMENTO ARCHIVADO**
>
> Este kit describe el setup **inicial PM2-first** que se usó para
> instalar Chibalete+ desde cero en un VPS recién formateado, **antes**
> del hardening Docker.
>
> **NO representa producción actual.** Producción corre como Docker
> Compose con containers `chibalete_edge`, `chibalete_front`,
> `chibalete_api_1`, `chibalete_api_2`. PM2 ya **NO gobierna producción**.
>
> **Si el VPS necesita reinstalación desde cero:** este kit ya no aplica
> tal cual. Se requiere un nuevo runbook que prepare Docker + Docker
> Compose y restaure desde backup. Hasta entonces, **NO seguir las
> instrucciones aquí** sobre VPS de producción activa.
>
> **Si llegaste aquí buscando deploy regular:** detente. Lee
> [`deployment_guide.md`](./deployment_guide.md), que es la **fuente
> canónica operacional vigente**.
>
> **Contexto histórico:**
> - Fecha aproximada: instalación inicial (PM2 + nginx host).
> - Reemplazado por: stack Docker en `/opt/chibaleteplus/` con bind mounts.
> - Sprint que cerró la transición: 022 Fase 2B.
>
> ---
> *El contenido original sigue debajo, sin modificaciones, para auditoría
> y trazabilidad histórica.*

---

# Guía Paso a Paso para Despliegue en VPS Nuevo (Modo Fácil)

Este documento te guiará para configurar tu servidor VPS desde cero (recién formateado) y subir tu aplicación.

## Paso 1: Subir Archivos con FileZilla

Ya que lograste conectar con FileZilla:

1.  **Panel Izquierdo (Tu PC):** Navega hasta la carpeta de tu proyecto: `d:\001 - app - Chibalete+`.
2.  **Panel Derecho (Servidor):** Asegúrate de estar en la carpeta `/root/` (o simplemente `/`).
3.  **Arrastra y Suelta:** Busca estos dos archivos en la izquierda y arrástralos a la derecha:
    *   `setup_vps.sh`
    *   `deploy_vps.zip`

*Espera a que termine la transferencia (Transferencia completada).*

---

## Paso 2: Conectarse al Servidor

Ahora entraremos al servidor para "armar" todo.

```powershell
ssh root@72.60.158.97
```

*Ingresa la contraseña cuando te la pida.*

---

## Paso 3: Instalar y Verificar

Una vez que veas una pantalla negra con texto (la terminal del servidor Linux):

**1. Ejecuta el instalador automático:**
Copia y pega esto:
```bash
bash setup_vps.sh
```
*Esto instalará Node.js, Nginx, abrirá el firewall y configurará todo. Espera a que termine.*

**2. Descomprimir e Iniciar la App:**
Copia y pega este bloque completo:
```bash
# Mover el zip a su lugar y descomprimir
mv /root/deploy_vps.zip /var/www/chibalete/
cd /var/www/chibalete
unzip -o deploy_vps.zip

# Instalar librerías e iniciar
npm install --production
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Paso 4: ¡Listo!
Abre tu navegador y entra a: http://72.60.158.97
Tu aplicación debería estar funcionando.

---

## Solución de Problemas (Troubleshooting)

### Error: "Connection timed out" (al conectar por SSH)
Si la terminal te dice que "el tiempo de espera se agotó", el servidor no está respondiendo.
1.  **Reinicia el Servidor**: Ve al panel de control de tu hosting y busca el botón "Reboot" o "Restart".
2.  **Verifica el Firewall del Hosting**: Asegúrate de que no haya un "Security Group" bloqueando el puerto 22.
3.  **Consola de Emergencia**: Si nada funciona, busca el botón "Web Console" o "VNC" en tu hosting. Ahí podrás entrar directamente sin usar SSH.
4.  **Bloqueo de IP**: Si fallaste la contraseña muchas veces, el servidor pudo bloquear tu IP. Intenta reiniciar tu módem de internet para obtener una nueva IP.
