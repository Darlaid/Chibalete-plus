$zipName = "deploy_vps.zip"
$exclude = @("node_modules", ".git", ".env*", "deploy_vps.zip")

Write-Host "Iniciando empaquetado para despliegue..."

# 1. Verificar si existe dist, si no, construir
if (-not (Test-Path "dist")) {
    Write-Host "No se encontró la carpeta 'dist'. Ejecutando build..."
    npm run build
}

# 2. Archivos a incluir
$filesToZip = @(
    "dist",
    "server",
    "package.json",
    "package-lock.json",
    "ecosystem.config.cjs"
)

# 3. Eliminar zip anterior si existe
if (Test-Path $zipName) {
    Remove-Item $zipName
}

# 4. Crear Zip (Usando Compress-Archive de PowerShell)
Write-Host "Comprimiendo archivos en $zipName..."
Compress-Archive -Path $filesToZip -DestinationPath $zipName -Force

Write-Host "¡Listo! Archivo '$zipName' creado exitosamente."
Write-Host "Tamaño: $( (Get-Item $zipName).Length / 1MB ) MB"
