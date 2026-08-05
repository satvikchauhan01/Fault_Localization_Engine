# DEPLOYMENT.md

This document serves as a quickstart deployment reference and troubleshooting guide. 

## Cloud Deployment (Railway)

This repository is built as a multi-service Docker Compose architecture. The easiest way to host this permanently in the cloud is via [Railway.app](https://railway.app/), which natively parses the `docker-compose.yml` file.

1. **Link your GitHub:** Sign into Railway and click **New Project** -> **Deploy from GitHub repo**.
2. **Select this repository.** Railway will automatically detect the database, worker, backend, and frontend.
3. **Important Build Context Fix:** By default, Railway's auto-builder might try to use Nixpacks instead of our Monorepo Dockerfiles. 
   - Click on the `kspdb-backend` service, go to **Settings -> Build**. Change the **Root Directory** to `/` and verify the **Dockerfile Path** is `apps/backend/Dockerfile`.
   - Do the exact same thing for `kspdb-worker`.
   - For `kspdb-frontend`, set the **Root Directory** to `/` and the **Dockerfile Path** to `apps/frontend/Dockerfile`.
4. **Generate the Public URL:** 
   - Click the `kspdb-frontend` service.
   - Go to **Settings -> Networking**.
   - Click **Generate Domain**. This creates your live, shareable URL. NGINX will automatically reverse-proxy `/api` requests to your backend via the private network!

## Environment Variables (.env)

If deploying manually or running locally without Docker Compose, copy `.env.example` to `.env`:

```env
# Example .env configuration
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kspdb_fault_localization?schema=public"
PORT="3000"
NODE_ENV="production"
TELEMETRY_BASE_URL="http://localhost:3000"
HEARTBEAT_EMITTER_STARTUP="1"
FORCE_RESEED="0"

# Optional LLM Incident Explanations
ANTHROPIC_API_KEY="sk-ant-api03-..." 
```

## Troubleshooting & Common Symptoms

| Symptom | Root Cause | Fix |
|---|---|---|
| **Build fails on Railway with `/apps/backend/docker-entrypoint.sh: not found`** | Railway set the Build Root context incorrectly for the monorepo. | Go to Service Settings -> Build. Change **Root Directory** to `/`. Ensure **Dockerfile Path** is properly specified. *(Note: Our Dockerfiles now use internal `RUN cp` to mitigate this, but fixing the root is still best practice).* |
| **I injected a fault but it took 4 minutes to appear in the UI.** | The ingestion worker is chewing through a massive batch of 3,600 initial heartbeats. | *Fixed in prod:* We rewrote the `ingestion-worker.js` SQL query to prioritize `power_lost` messages. Faults now bypass the queue and appear instantly, even on heavy startups! |
| **`sim_true_topology` does not exist during Fault Injection.** | A `docker-compose up` was run without `--build`, so the container used a stale cached image missing the latest migration. | Run `docker-compose down -v` followed by `docker-compose up --build -d` to force a clean database wipe and full rebuild. |
| **Railway Deploy logs show `No start command detected`** | You changed the Root Directory to `/` but forgot to set the Dockerfile Path, causing Railway to fallback to Nixpacks. | Explicitly set the **Dockerfile Path** in Railway's Build settings. |
