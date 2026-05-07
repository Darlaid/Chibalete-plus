#!/usr/bin/env bash
# Read-only audit of production VPS. No state changes.
ssh root@72.60.158.97 'bash -s' <<'REMOTE'
echo "=== 1. ls -la /root/apps-spa/chibaleteplus ==="
ls -la /root/apps-spa/chibaleteplus 2>&1

echo
echo "=== 1b. ls -la /root/apps-spa ==="
ls -la /root/apps-spa 2>&1

echo
echo "=== 2. dist/build dirs (depth 3) ==="
find /root/apps-spa/chibaleteplus -maxdepth 3 -type d \( -name "dist" -o -name "build" \) 2>&1

echo
echo "=== 3. docker ps ==="
docker ps 2>&1

echo
echo "=== 3b. docker ps -a (stopped included) ==="
docker ps -a 2>&1

echo
echo "=== 4. compose files ==="
ls -la /root/apps-spa/*.y*ml /root/apps-spa/chibaleteplus/*.y*ml 2>&1

echo
echo "--- /root/apps-spa/docker-compose.yml ---"
cat /root/apps-spa/docker-compose.yml 2>&1 | head -150

echo
echo "--- /root/apps-spa/chibaleteplus/docker-compose*.yml ---"
for f in /root/apps-spa/chibaleteplus/docker-compose*.y*ml; do
  [ -f "$f" ] && echo "### $f ###" && cat "$f"
done 2>&1 | head -200

echo
echo "=== 5. nginx container vs system ==="
docker ps --format "{{.Names}}	{{.Image}}	{{.Ports}}" 2>&1 | grep -i nginx
echo "--- system nginx ---"
systemctl is-active nginx 2>&1

echo
echo "=== 6. find VisorTexto bundle in /root/apps-spa ==="
find /root/apps-spa -name "VisorTexto*.js" -type f 2>&1 | head -10
echo "--- find any dist ---"
find /root/apps-spa -type d -name "dist" 2>&1 | grep -v node_modules | head -10

echo
echo "=== 7. MessageCircle in chibaleteplus tree (capped 30) ==="
grep -RIn "MessageCircle" /root/apps-spa/chibaleteplus 2>&1 | head -30

echo
echo "=== 7b. MessageCircle in dist VisorTexto bundles ==="
find /root/apps-spa -path "*/dist/assets/VisorTexto*.js" -type f 2>&1 | while read -r b; do
  echo "-- $b --"
  if grep -q "MessageCircle" "$b" 2>/dev/null; then
    hits=$(grep -o "MessageCircle" "$b" | wc -l)
    echo "MessageCircle FOUND ($hits hits)"
  else
    echo "MessageCircle NOT FOUND"
  fi
done

echo
echo "=== 8. mounts per running container ==="
for c in $(docker ps --format "{{.Names}}"); do
  echo "--- $c ---"
  docker inspect "$c" --format 'Image: {{.Config.Image}}
WorkingDir: {{.Config.WorkingDir}}
Mounts:{{range .Mounts}}
  - {{.Type}} {{.Source}} -> {{.Destination}} (rw={{.RW}}){{end}}' 2>&1
done | head -120

echo
echo "=== 9. listening ports ==="
ss -tlnp 2>&1 | head -25

echo
echo "=== 10. DNS + curl ==="
getent hosts chibaleteplus.chibaleteeditores.com 2>&1
curl -sI -m 5 https://chibaleteplus.chibaleteeditores.com 2>&1 | head -8
REMOTE
