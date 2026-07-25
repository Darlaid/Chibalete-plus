"""Motor de backup granular de Chibalete+ (CHP-BACKUP-01B).

Python 3.12, exclusivamente stdlib. Sin dependencias del node_modules de la
aplicacion. Ver ../../BACKUP_01B_DESIGN.md para el diseno vinculante.

Prohibiciones estructurales de esta unidad (CHP-BACKUP-01B, previo a 01C):
  - cero `restic forget` (ni siquiera --dry-run en 01B-1)
  - cero `restic prune`
  - cero eliminacion de snapshots
  - cero retencion destructiva
"""

RUNNER_VERSION = "1.0.0"
MANIFEST_SCHEMA_VERSION = 1
