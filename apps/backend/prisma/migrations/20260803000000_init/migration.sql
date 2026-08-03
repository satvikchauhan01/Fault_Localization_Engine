-- CreateEnum
CREATE TYPE "TopologySource" AS ENUM ('AUTHORITATIVE', 'INFERRED');

-- CreateEnum
CREATE TYPE "TelemetryEventType" AS ENUM ('heartbeat', 'power_lost', 'power_restored', 'boot');

-- CreateEnum
CREATE TYPE "PoleStatus" AS ENUM ('LIVE', 'CONFIRMED_DARK', 'STALE', 'OFFLINE_UNKNOWN', 'SENSOR_SUSPECT');

-- CreateEnum
CREATE TYPE "ScheduledOutageScope" AS ENUM ('DT', 'FEEDER', 'SPAN');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('SPAN', 'DT', 'FEEDER', 'RANGE');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TicketState" AS ENUM ('DETECTED', 'ACKNOWLEDGED', 'CREW_ASSIGNED', 'RESOLVED', 'VERIFIED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SimulatorFaultType" AS ENUM ('SPAN', 'DT', 'FEEDER');

-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "feeders" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feeders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformers" (
    "id" TEXT NOT NULL,
    "feeder_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "capacity_kva" DOUBLE PRECISION NOT NULL,
    "households_served" INTEGER NOT NULL,
    "topology_source" "TopologySource" NOT NULL,

    CONSTRAINT "transformers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poles" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "dt_id" TEXT NOT NULL,
    "feeder_id" TEXT NOT NULL,
    "seq_on_line" INTEGER,
    "parent_pole_id" TEXT,
    "device_id" TEXT,
    "ward" TEXT,
    "pincode" TEXT,

    CONSTRAINT "poles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "pole_id" TEXT,
    "fw_version" TEXT NOT NULL,
    "first_seen" TIMESTAMP(3) NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_inbox" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "pole_id" TEXT NOT NULL,
    "event" "TelemetryEventType" NOT NULL,
    "energized" BOOLEAN NOT NULL,
    "device_ts" TIMESTAMP(3) NOT NULL,
    "seq" INTEGER NOT NULL,
    "battery_mv" INTEGER,
    "rssi" INTEGER,
    "fw" TEXT NOT NULL,
    "server_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "InboxStatus" NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "telemetry_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pole_states" (
    "pole_id" TEXT NOT NULL,
    "status" "PoleStatus" NOT NULL,
    "last_confirmed_at" TIMESTAMP(3) NOT NULL,
    "last_event_seq" INTEGER NOT NULL,
    "evidence_summary" TEXT NOT NULL,

    CONSTRAINT "pole_states_pkey" PRIMARY KEY ("pole_id")
);

-- CreateTable
CREATE TABLE "topology_edges" (
    "id" TEXT NOT NULL,
    "parent_pole_id" TEXT NOT NULL,
    "child_pole_id" TEXT NOT NULL,
    "source" "TopologySource" NOT NULL,
    "weight" DOUBLE PRECISION,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "topology_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_outages" (
    "id" TEXT NOT NULL,
    "scope" "ScheduledOutageScope" NOT NULL,
    "target_id" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_outages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "upstream_live_pole_id" TEXT,
    "downstream_dark_pole_ids" JSONB NOT NULL,
    "affected_pole_ids" JSONB NOT NULL,
    "affected_count" INTEGER NOT NULL,
    "topology_source" "TopologySource" NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "confidence_reasons" JSONB NOT NULL,
    "scheduled_outage_overlap" BOOLEAN NOT NULL DEFAULT false,
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "state" "TicketState" NOT NULL DEFAULT 'DETECTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulator_faults" (
    "id" TEXT NOT NULL,
    "type" "SimulatorFaultType" NOT NULL,
    "target" TEXT NOT NULL,
    "injected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repaired_at" TIMESTAMP(3),

    CONSTRAINT "simulator_faults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_incident_id_key" ON "tickets"("incident_id");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
