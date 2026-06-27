import { describe, it, expect } from 'vitest';
import { motesToCspr, truncateHash, deployUrl, accountUrl, contractUrl } from './format';

describe('format', () => {
  it('converts motes to CSPR with trimming', () => {
    expect(motesToCspr('7000000000')).toBe('7');
    expect(motesToCspr('1000000000000')).toBe('1,000');
    expect(motesToCspr('0')).toBe('0');
    expect(motesToCspr(3000000000n)).toBe('3');
  });
  it('truncates hashes', () => {
    expect(truncateHash('a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d')).toBe('a02b1c7d…6d6a7d');
  });
  it('builds cspr.live urls', () => {
    expect(deployUrl('abc')).toBe('https://testnet.cspr.live/deploy/abc');
    expect(accountUrl('01ea')).toBe('https://testnet.cspr.live/account/01ea');
    expect(contractUrl('fb52')).toBe('https://testnet.cspr.live/contract-package/fb52');
  });
});
