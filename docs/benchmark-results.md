# Telemetry Ingestion Benchmark Results

Tested Date: Wed, 05 Aug 2026 10:37:58 GMT
Target URL: `http://localhost:3000/telemetry`

## Phase 1: Sustained Load (Target: 500 req/sec)
* **Goal**: Measure stable ingestion of 500 messages per second.
* **Duration**: 10 seconds
* **Successful Requests**: 5000
* **Failed Requests**: 0
* **Actual Throughput**: **500.00 req/sec**

## Phase 2: Burst Load (Target: 5,000 requests)
* **Goal**: Process a burst of 5,000 telemetry messages as fast as possible.
* **Total Sent**: 5000
* **Successful Requests**: 5000
* **Failed Requests**: 0
* **Time Taken**: 5.51 seconds
* **Actual Burst Throughput**: **907.44 req/sec**

---
*Note: This benchmark focuses entirely on the HTTP `/telemetry` route accepting payloads and inserting them into the `telemetry_inbox` queue (PENDING state), which satisfies Step 33's criteria.*
