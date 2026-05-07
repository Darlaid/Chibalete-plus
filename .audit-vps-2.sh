#!/usr/bin/env bash
# Read-only audit #2 — Docker topology in production VPS.
# Goal: identify how chibalete_front, chibalete_edge, chibalete_api_{1,2}
# are wired (image, network, mounts, ports) before planning the swap.
ssh root@72.60.158.97 'bash -s' <<'REMOTE'
set +e

inspect_container() {
  local name="$1"
  echo "=== docker inspect ${name} ==="
  docker inspect "$name" --format '
Name:          {{.Name}}
Image:         {{.Config.Image}}
ImageSHA:      {{.Image}}
Created:       {{.Created}}
State:         {{.State.Status}} (StartedAt {{.State.StartedAt}})
Cmd:           {{.Config.Cmd}}
Entrypoint:    {{.Config.Entrypoint}}
WorkingDir:    {{.Config.WorkingDir}}
ExposedPorts: {{range $p,$_ := .Config.ExposedPorts}} {{$p}}{{end}}
PortBindings: {{range $p,$bs := .NetworkSettings.Ports}} {{$p}}=>{{range $bs}}{{.HostIp}}:{{.HostPort}};{{end}}{{end}}
Networks:     {{range $n,$c := .NetworkSettings.Networks}} {{$n}}(ip={{$c.IPAddress}} aliases={{$c.Aliases}});{{end}}
Mounts:{{range .Mounts}}
  - {{.Type}} {{.Source}} -> {{.Destination}} (rw={{.RW}}){{end}}
RestartPolicy: {{.HostConfig.RestartPolicy.Name}}
Labels:{{range $k,$v := .Config.Labels}}
  {{$k}}={{$v}}{{end}}
' 2>&1
  echo
}

for c in chibalete_front chibalete_edge chibalete_api_1 chibalete_api_2; do
  inspect_container "$c"
done

echo "=== docker network ls ==="
docker network ls
echo

echo "=== docker network inspect deploy_default ==="
docker network inspect deploy_default --format '
Name:    {{.Name}}
Driver:  {{.Driver}}
Subnet:  {{range .IPAM.Config}}{{.Subnet}} {{end}}
Containers:{{range $id,$c := .Containers}}
  - {{$c.Name}}  ip={{$c.IPv4Address}}{{end}}
' 2>&1
echo

echo "=== docker images | grep -i chibalete ==="
docker images --format "{{.Repository}}:{{.Tag}}  ID={{.ID}}  age={{.CreatedSince}}  size={{.Size}}" | grep -i chibalete
echo

echo "=== docker image inspect chibalete/front:2026-04-27-album-fix ==="
docker image inspect chibalete/front:2026-04-27-album-fix --format '
Id:           {{.Id}}
Created:      {{.Created}}
DockerVer:    {{.DockerVersion}}
Cmd:          {{.Config.Cmd}}
Entrypoint:   {{.Config.Entrypoint}}
WorkingDir:   {{.Config.WorkingDir}}
ExposedPorts:{{range $p,$_ := .Config.ExposedPorts}} {{$p}}{{end}}
RepoTags:     {{.RepoTags}}
RepoDigests:  {{.RepoDigests}}
Labels:{{range $k,$v := .Config.Labels}}
  {{$k}}={{$v}}{{end}}
' 2>&1
echo

echo "=== find compose + nginx configs (depth 5) under /opt and /root/apps-spa ==="
find /opt /root/apps-spa -maxdepth 5 \
  \( -name "docker-compose*.yml" -o -name "docker-compose*.yaml" -o -name "nginx*.conf" \) \
  -type f 2>/dev/null
echo

echo "=== contents of each compose file (head -200) ==="
while IFS= read -r f; do
  echo "------- $f -------"
  head -200 "$f"
  echo
done < <(find /opt /root/apps-spa -maxdepth 5 \( -name "docker-compose*.yml" -o -name "docker-compose*.yaml" \) -type f 2>/dev/null)
echo

echo "=== contents of each nginx*.conf (head -200) ==="
while IFS= read -r f; do
  echo "------- $f -------"
  head -200 "$f"
  echo
done < <(find /opt /root/apps-spa -maxdepth 5 -name "nginx*.conf" -type f 2>/dev/null)
echo

echo "=== sanity: who owns /opt and /root/apps-spa ==="
ls -la /opt 2>/dev/null | head -20
ls -la /root/apps-spa 2>/dev/null | head -20

REMOTE
