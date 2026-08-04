import { execSync } from 'child_process';
import { loadEnv } from 'vite';
import path from 'path';

export async function setup() {
  // Load .env.test from apps/backend to get the test database URL
  const env = loadEnv('test', path.resolve(__dirname, 'apps/backend'), '');
  const testDbUrl = env.DATABASE_URL;
  
  if (!testDbUrl || !testDbUrl.includes('_test')) {
    throw new Error('Test DATABASE_URL must be configured and typically ends with _test to prevent dev data loss.');
  }

  // Ensure child processes (like Prisma) use the test database
  process.env.DATABASE_URL = testDbUrl;

  console.log('\n[vitest global setup] Syncing test database schema...');
  try {
    // db push is faster than migrate dev and safely initializes the test DB schema
    execSync('npx prisma db push --accept-data-loss --skip-generate', {
      cwd: path.resolve(__dirname, 'apps/backend'),
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testDbUrl }
    });
    console.log('[vitest global setup] Test database ready.\n');
  } catch (error) {
    console.error('[vitest global setup] Failed to sync test database:', error);
    throw error;
  }
}
