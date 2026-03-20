# Deployment Task Checklist

- [x] Create deployment package (`deploy_vps.zip`)
- [x] Create emergency deployment guide (`deployment_emergency_kit.md`)
- [/] Troubleshoot SCP upload issues
  - [x] Correct "No such file" error by using absolute paths
  - [x] Update VPS IP address to `72.60.158.97`
  - [x] Resolve "Could not resolve hostname d" error
  - [x] Fix SCP destination error (Upload to `/root` instead of `/var/www`)
- [ ] **CRITICAL**: Reinstall VPS OS (Fix `grub rescue>`)
- [ ] Retry SCP upload to new server
  - [x] Fix "Host identification changed" error (cleared `known_hosts`)
  - [x] **RESOLVED**: `Connection timed out` (User connected via FileZilla)
    - [x] **Action Required**: Use FileZilla for upload.
- [/] Fix `ERR_CONNECTION_TIMED_OUT` (SSH Port 22 Blocked)
  - [ ] **Action Required**: Check VPS Provider Web Console (Firewall/Status)
  - [ ] Configure Firewall (allow port 80/443)
  - [ ] Verify Nginx configuration
- [ ] Guide user through server-side installation (unzip + pm2)
