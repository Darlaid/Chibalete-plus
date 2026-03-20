CHIBALETE+ PRODUCTION RELEASE
==============================

This folder contains the production-ready build of Chibalete+.

CONTENTS:
- /dist     : Prebuilt frontend (React/Vite).
- /server   : Node.js Express backend.
- /public   : Static assets.
- /data     : Initial/Persistent JSON data files.
- package.json & lock : Runtime dependencies.
- .env.production.example : Template for environment variables.

DEPLOYMENT STEPS (VPS):
1. Upload this "chibaleteplus-release" folder to your VPS.
2. Ensure Node.js (v18+) is installed.
3. Run: npm install --only=production
4. Copy .env.production.example to .env
5. Edit .env with real secrets (API keys, ADMIN_SECRET, etc).
6. Start the server (e.g., node server/server.js or using pm2).

NOTE ON PERSISTENCE:
- The /uploads folder (if it exists on the VPS) contains user-generated content and should NOT be blindly overwritten if you are redeploying. 
- The /data folder contains the local JSON "database" files. Back these up before overwriting.

NGINX:
Ensure Nginx is configured to serve /dist (or proxy all requests to the Node.js PORT defined in .env).
