import { describe, it, expect } from 'vitest';
import { DOMAIN_PACKAGE_NAME } from './index.js';

describe('Domain package exports', () => {
  it('exports package name constant', () => {
    expect(DOMAIN_PACKAGE_NAME).toBe('@kspdb/domain');
  });
});
