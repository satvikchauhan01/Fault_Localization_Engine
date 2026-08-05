import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_URL = process.env.TELEMETRY_URL || 'http://localhost:3000/telemetry';

// Generate a valid telemetry payload
function generatePayload(seq) {
  return {
    device_id: 'device-loadtest',
    pole_id: 'pole-loadtest',
    event: 'heartbeat',
    energized: true,
    device_ts: new Date().toISOString(),
    seq,
    battery_mv: 3700,
    rssi: -70,
    fw: '1.3.0',
    server_received_at: new Date().toISOString()
  };
}

async function sendBatch(batchSize, seqStart) {
  const promises = [];
  for (let i = 0; i < batchSize; i++) {
    const p = fetch(TARGET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generatePayload(seqStart + i)),
      // Node 18+ undici fetch options to maximize throughput
      keepalive: true
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    });
    promises.push(p);
  }
  return Promise.allSettled(promises);
}

async function runSustainedTest(targetRps = 500, durationSeconds = 10) {
  console.log(`\n=== Phase 1: Sustained Load Test (${targetRps} req/sec for ${durationSeconds}s) ===`);
  const startTime = Date.now();
  let totalSuccess = 0;
  let totalFail = 0;
  let seq = 0;

  for (let s = 0; s < durationSeconds; s++) {
    const secStart = Date.now();
    const results = await sendBatch(targetRps, seq);
    seq += targetRps;

    const success = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.filter(r => r.status === 'rejected').length;
    totalSuccess += success;
    totalFail += fail;

    const elapsed = Date.now() - secStart;
    console.log(`  Second ${s + 1}: ${success} ok, ${fail} failed (took ${elapsed}ms)`);
    
    // If we finished the batch in less than a second, wait out the rest of the second
    if (elapsed < 1000) {
      await new Promise(r => setTimeout(r, 1000 - elapsed));
    }
  }

  const durationStr = ((Date.now() - startTime) / 1000).toFixed(2);
  const actualRps = (totalSuccess / durationSeconds).toFixed(2);
  console.log(`-> Sustained Summary: ${totalSuccess} successful in ${durationStr}s (~${actualRps} req/sec). Failed: ${totalFail}`);
  return { type: 'sustained', targetRps, durationSeconds, totalSuccess, totalFail, actualRps };
}

async function runBurstTest(burstTotal = 5000, batchSize = 500) {
  console.log(`\n=== Phase 2: Burst Test (${burstTotal} total requests) ===`);
  const startTime = Date.now();
  let totalSuccess = 0;
  let totalFail = 0;
  let seq = 100000;

  // We send them as fast as possible in batches to avoid overwhelming OS sockets entirely
  for (let i = 0; i < burstTotal; i += batchSize) {
    const size = Math.min(batchSize, burstTotal - i);
    const results = await sendBatch(size, seq);
    seq += size;
    totalSuccess += results.filter(r => r.status === 'fulfilled').length;
    totalFail += results.filter(r => r.status === 'rejected').length;
  }

  const elapsedMs = Date.now() - startTime;
  const elapsedSec = (elapsedMs / 1000).toFixed(2);
  const actualRps = (totalSuccess / (elapsedMs / 1000)).toFixed(2);

  console.log(`-> Burst Summary: ${totalSuccess} successful in ${elapsedSec}s (~${actualRps} req/sec). Failed: ${totalFail}`);
  return { type: 'burst', burstTotal, totalSuccess, totalFail, elapsedSec, actualRps };
}

async function main() {
  console.log(`Starting telemetry ingestion load test against ${TARGET_URL}...`);
  try {
    // Ping to ensure service is up
    await fetch('http://localhost:3000/health').then(r => r.json());
  } catch (e) {
    console.error(`Backend not reachable: ${e.message}`);
    process.exit(1);
  }

  const results = [];
  results.push(await runSustainedTest(500, 10)); // 500 rps for 10s
  
  console.log(`\nCooling down for 3 seconds...`);
  await new Promise(r => setTimeout(r, 3000));
  
  results.push(await runBurstTest(5000, 500)); // 5000 total burst

  // Write results to docs
  const docsDir = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  
  const resultsFile = path.join(docsDir, 'benchmark-results.md');
  const markdown = `# Telemetry Ingestion Benchmark Results

Tested Date: ${new Date().toUTCString()}
Target URL: \`${TARGET_URL}\`

## Phase 1: Sustained Load (Target: 500 req/sec)
* **Goal**: Measure stable ingestion of 500 messages per second.
* **Duration**: ${results[0].durationSeconds} seconds
* **Successful Requests**: ${results[0].totalSuccess}
* **Failed Requests**: ${results[0].totalFail}
* **Actual Throughput**: **${results[0].actualRps} req/sec**

## Phase 2: Burst Load (Target: 5,000 requests)
* **Goal**: Process a burst of 5,000 telemetry messages as fast as possible.
* **Total Sent**: ${results[1].burstTotal}
* **Successful Requests**: ${results[1].totalSuccess}
* **Failed Requests**: ${results[1].totalFail}
* **Time Taken**: ${results[1].elapsedSec} seconds
* **Actual Burst Throughput**: **${results[1].actualRps} req/sec**

---
*Note: This benchmark focuses entirely on the HTTP \`/telemetry\` route accepting payloads and inserting them into the \`telemetry_inbox\` queue (PENDING state), which satisfies Step 33's criteria.*
`;

  fs.writeFileSync(resultsFile, markdown, 'utf8');
  console.log(`\nResults written to ${resultsFile}`);
}

main().catch(console.error);
