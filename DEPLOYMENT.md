# Deployment Guide

This app can run locally, in Docker, and on hosted Node platforms.

## 1. Prepare the app

1. Copy `.env.example` to `.env`.
2. Fill in:
   - `JWT_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
3. Keep SQLite on a persistent path in production.

## 2. Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## 3. Run with Docker

```bash
docker build -t uss-app .
docker run -p 3000:3000 --env-file .env -v "$(pwd)/data:/usr/src/app/data" uss-app
```

## 4. Deploy on Render

Recommended if you want a simple dashboard deployment.

1. Push this project to GitHub.
2. In Render, create a new Web Service from the repo.
3. Choose `Docker` runtime.
4. Add environment variables from `.env.example`.
5. Attach a persistent disk and mount it at `/usr/src/app/data`.
6. Add `RENDER_DISK_PATH=/usr/src/app/data`.
7. Set the health check path to `/api/health`.

## 5. Deploy on Railway

Recommended if you want fast GitHub-based deploys and easy environment management.

1. Push this project to GitHub.
2. Create a new Railway project from the repo.
3. Add environment variables from `.env.example`.
4. Create a volume and mount it at `/data`.
5. Add `RAILWAY_VOLUME_MOUNT_PATH=/data`.
6. Redeploy and verify `/api/health`.

## 6. Deploy on Fly.io

Good if you want more infrastructure control.

1. Install `flyctl`.
2. Run `fly launch`.
3. Create a volume mounted at `/data`.
4. Set `SQLITE_DB_DIR=/data`.
5. Run `fly deploy`.

## 7. Google Sign-In for production

After you know your final domain:

1. Open the Google Cloud Console.
2. Edit your Web application OAuth client.
3. Add your deployed domain to Authorized JavaScript origins.
4. Keep `http://localhost` and `http://localhost:3000` for local development.

Example production origin:

```text
https://your-app-domain.com
```

## 8. Important production note

SQLite is okay for an early version and single-instance deployment, but if you want:

- many concurrent users
- multiple app instances
- stronger reliability

move the production database to Postgres next.
