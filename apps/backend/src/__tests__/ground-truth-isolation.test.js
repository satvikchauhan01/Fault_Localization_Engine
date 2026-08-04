/**
 * @file ground-truth-isolation.test.js
 *
 * Automated boundary test asserting that production topology/ and localization/
 * modules NEVER import or query simulator ground-truth tables or modules.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_DIRECTORIES = [
  path.resolve(__dirname, '../topology'),
  path.resolve(__dirname, '../localization'),
];

const FORBIDDEN_PATTERNS = [
  /sim_true/i,
  /simTrueTopology/i,
  /sim_true_topology/i,
  /SimulatorFault/i,
  /simulator_faults/i,
  /from\s+['"].*\/simulator\/.*['"]/i,
  /require\(['"].*\/simulator\/.*['"]\)/i,
];

/**
 * Scans a code string for any forbidden simulator ground-truth references.
 * Comments are stripped first so JSDoc documentation (e.g. "MUST NOT query sim_true_*")
 * does not trigger false positives.
 *
 * @param {string} code Source code string
 * @returns {string[]} List of matched forbidden pattern descriptions
 */
export function scanCodeForGroundTruthViolations(code) {
  const codeWithoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const violations = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(codeWithoutComments)) {
      violations.push(`Matches forbidden pattern: ${pattern.toString()}`);
    }
  }
  return violations;
}

/**
 * Recursively collects all non-test .js files in a directory.
 *
 * @param {string} dir Directory path
 * @returns {string[]} File paths
 */
function getProductionJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getProductionJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('Step 25 — Ground-Truth Isolation Boundary', () => {
  it('production topology/ and localization/ modules have ZERO ground-truth references', () => {
    const allProductionFiles = TARGET_DIRECTORIES.flatMap(dir => getProductionJsFiles(dir));
    expect(allProductionFiles.length).toBeGreaterThan(0);

    const violationsByFile = [];

    for (const filePath of allProductionFiles) {
      const code = fs.readFileSync(filePath, 'utf8');
      const violations = scanCodeForGroundTruthViolations(code);
      if (violations.length > 0) {
        violationsByFile.push({
          file: path.relative(path.resolve(__dirname, '../../../..'), filePath),
          violations,
        });
      }
    }

    expect(violationsByFile).toEqual([]);
  });

  it('scanner correctly detects violations when ground-truth references are introduced', () => {
    const badCode1 = "import { getPolesForFault } from '../simulator/ground-truth.js';";
    const badCode2 = "await prisma.simTrueTopology.findMany();";
    const badCode3 = "await db.simulatorFault.findUnique({ where: { id } });";
    const cleanCode = "import { prisma } from '../db.js';\nawait prisma.topologyEdge.findMany();";

    expect(scanCodeForGroundTruthViolations(badCode1).length).toBeGreaterThan(0);
    expect(scanCodeForGroundTruthViolations(badCode2).length).toBeGreaterThan(0);
    expect(scanCodeForGroundTruthViolations(badCode3).length).toBeGreaterThan(0);
    expect(scanCodeForGroundTruthViolations(cleanCode)).toHaveLength(0);
  });
});
