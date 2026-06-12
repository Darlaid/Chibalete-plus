# ops - Chibalete+

Esta carpeta contiene scripts y checklists operativos para diagnostico, mantenimiento, deploy dry-run, deploy apply y rollback.

## Reglas

- No usar docker compose down.
- No tocar data, data-critical, uploads ni server sin autorizacion explicita.
- Todo script debe ser reversible o de solo lectura, salvo deploy apply aprobado.
- Todo diagnostico de VPS debe comenzar en modo solo lectura.
- Todo deploy debe tener health check previo, health check posterior y rollback documentado.
