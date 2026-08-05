# KSPDB Fault Localization Engine

This repository contains the completed **Fault Localization Engine**, simulating real-time telemetry processing and outage localization across a synthetic grid of ~4,000 poles and transformers.

## 🚀 Quickstart (Local Desktop)

**Prerequisites:** Docker and Docker Compose installed.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/satvikchauhan01/Fault_Localization_Engine.git
   cd Fault_Localization_Engine
   ```

2. **Start the environment (One Command):**
   ```bash
   docker-compose up --build -d
   ```
   *Note: Startup performs database initialization and seeds ~4,000 synthetic devices. The initial telemetry generation processes a large batch of heartbeats, which can take 1-2 minutes to stabilize. We have optimized the ingestion queue so that critical `power_lost` faults prioritize ahead of background heartbeats!*

3. **Open the Dashboard:**
   Navigate to `http://localhost:80` in your browser.

4. **Verify the System:**
   - Open the map view. You should see 5 colored Feeders and ~4,000 poles.
   - Click the "Fault Simulator" button in the bottom left.
   - Inject a `SPAN` fault on any target equipment.
   - Close the simulator and wait 5-10 seconds. An active incident should appear on the right panel, proving the worker successfully ingested the telemetry and localized the boundary!

## 🌍 Cloud Deployment (Railway)

We have configured the repository to run entirely in the cloud via [Railway.app](https://railway.app/).
For complete cloud deployment instructions, see [04-DEPLOYMENT.md](./04-DEPLOYMENT.md).

## 📄 Documentation

- [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) - System design and database schema.
- [02-DECISIONS.md](./02-DECISIONS.md) - Trade-offs and technical decisions.
- [03-AI-WORKFLOW.md](./03-AI-WORKFLOW.md) - AI verification strategies and troubleshooting logs.
- [04-DEPLOYMENT.md](./04-DEPLOYMENT.md) - In-depth cloud hosting guide.

## 🛠 Project Reset

If your database ever gets out of sync during testing or development, you can completely wipe and cleanly reseed the environment by destroying the docker volumes:

```bash
docker-compose down -v
docker-compose up --build -d
```
