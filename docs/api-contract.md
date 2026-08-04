# Backend API Contract

This document outlines the REST endpoints available for the frontend application, consolidating both existing and newly created routes.

## 1. Incidents API
Prefix: `/api/incidents`

### GET `/api/incidents`
Lists all localization incidents along with their associated tickets.

**Response**
- `200 OK`: Array of incident objects.
```json
[
  {
    "id": "inc_...",
    "type": "SPAN",
    "upstream_live_pole_id": "pole_...",
    "downstream_dark_pole_ids": ["pole_..."],
    "affected_pole_ids": ["pole_..."],
    "historical_affected_pole_ids": ["pole_..."],
    "affected_count": 5,
    "topology_source": "AUTHORITATIVE",
    "confidence": "HIGH",
    "confidence_reasons": [...],
    "scheduled_outage_overlap": false,
    "first_detected_at": "2026-08-01T12:00:00.000Z",
    "ticket": {
      "id": "tkt_...",
      "state": "DETECTED",
      "created_at": "...",
      "updated_at": "...",
      "resolved_at": null,
      "verified_at": null,
      "still_dark_pole_ids": null
    }
  }
]
```

### GET `/api/incidents/:id`
Retrieves a specific incident by ID.

**Response**
- `200 OK`: Incident object (same schema as above, but single object).
- `404 Not Found`: `{ "error": "Incident not found" }`

---

## 2. Map & Topology API
Prefix: `/api/map`

### GET `/api/map/data`
Retrieves physical topology, nodes, and live pole states for the map visualization.

**Response**
- `200 OK`: A consolidated map data payload.
```json
{
  "feeders": [
    {
      "id": "fdr_...",
      "name": "Downtown Loop",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "transformers": [
    {
      "id": "dt_...",
      "feeder_id": "fdr_...",
      "lat": 12.345,
      "lon": 67.890,
      "capacity_kva": 100,
      "households_served": 50,
      "topology_source": "RECORDED"
    }
  ],
  "poles": [
    {
      "id": "pole_...",
      "lat": 12.345,
      "lon": 67.890,
      "dt_id": "dt_...",
      "feeder_id": "fdr_...",
      "seq_on_line": 1,
      "parent_pole_id": "pole_...",
      "device_id": "dev_...",
      "state": {
        "pole_id": "pole_...",
        "status": "LIVE",
        "last_confirmed_at": "...",
        "last_event_seq": 45,
        "evidence_summary": "...",
        "candidate_dark_since": null,
        "evidence_type": "..."
      } // Can be null if no state is recorded yet
    }
  ],
  "topology_edges": [
    {
      "id": "edge_...",
      "parent_pole_id": "pole_a",
      "child_pole_id": "pole_b",
      "source": "AUTHORITATIVE",
      "weight": 12.5,
      "ambiguous": false
    }
  ]
}
```

---

## 3. Tickets API
Prefix: `/api/tickets`

### GET `/api/tickets`
Lists incident tickets. Supports optional query parameters.

**Query Parameters**
- `state`: Filter by ticket state (e.g., `RESOLVED`, `VERIFIED`).
- `incident_id`: Filter by associated incident ID.

**Response**
- `200 OK`: Array of ticket objects.

### GET `/api/tickets/:id`
Retrieves a specific ticket by ID.

**Response**
- `200 OK`: Ticket object.
- `404 Not Found`: `{ "error": "Ticket not found" }`

### POST `/api/tickets/:id/transition`
Transitions a ticket to a new state.

**Request Body**
```json
{
  "state": "CREW_ASSIGNED"
}
```

**Response**
- `200 OK`: Updated ticket object.
- `400 Bad Request`: When state transition is illegal or invalid.
- `404 Not Found`: Ticket does not exist.

---

## 4. Simulator Controls API (Demo/Testing Only)
Prefix: `/api/simulator`

### POST `/api/simulator/inject`
Injects a fault into the physical ground-truth simulation.

**Request Body**
```json
{
  "type": "SPAN", // SPAN | DT | FEEDER
  "target": "pole_...",
  "duplicates": false,
  "reorder": false
}
```

**Response**
- `202 Accepted`: `{ "message": "Fault injected", "simulatorFault": { ... } }`

### POST `/api/simulator/repair/:faultId`
Repairs an active simulator fault, initiating restoration telemetry.

**Response**
- `202 Accepted`: `{ "message": "Fault repaired", "simulatorFault": { ... } }`
- `409 Conflict`: Fault already repaired.

### GET `/api/simulator/faults`
Lists all active (unrepaired) faults.

**Response**
- `200 OK`: Array of `SimulatorFault` objects.

---

## 5. Telemetry Ingestion (Device Facing)
Prefix: `/telemetry`

### POST `/telemetry`
Ingests a single telemetry event from an IoT device.

**Request Body**
```json
{
  "device_id": "dev_123",
  "pole_id": "pole_123",
  "event": "power_lost",
  "energized": false,
  "device_ts": 1722359400000,
  "seq": 45,
  "fw": "1.2.0"
}
```

**Response**
- `202 Accepted`: `{ "status": "accepted", "id": "inbox_uuid" }`

---

## 6. Scheduled Outages API
Prefix: `/scheduled-outages`

### GET `/scheduled-outages`
Lists all recorded scheduled outages.

**Response**
- `200 OK`: Array of scheduled outage objects.

### POST `/scheduled-outages`
Ingests new scheduled outage data from the billing/ERP system.

**Request Body**
```json
[
  {
    "id": "outage_123",
    "scope": "DT",
    "target_id": "dt_456",
    "start": "2026-08-01T10:00:00Z",
    "end": "2026-08-01T14:00:00Z",
    "reason": "Routine maintenance"
  }
]
```

**Response**
- `201 Created`: `{ "status": "created", "count": 1 }`
