import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DistributionReceiptCard } from './DistributionReceiptCard';
import type { DistributionReceipt } from '@/lib/types';

const receipt: DistributionReceipt = {
  assetId: 'inv-1',
  cycleId: 'happy',
  totalDistributedMotes: '7000000000', // 7 CSPR
  dustRetainedMotes: '0',
  holderCount: 2,
  quorumRequired: 2,
  signers: ['verifier-a', 'verifier-b'],
  verdictHashes: ['0xaa', '0xbb'],
  verifyTx: '6821e0f3e6b01325965562f964047782dab13d4602b7dae7bc7e67c70ac37829',
};

describe('DistributionReceiptCard', () => {
  it('renders the on-chain receipt fields', () => {
    render(<DistributionReceiptCard receipt={receipt} />);
    expect(screen.getByText(/on-chain receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/7\s*CSPR/)).toBeInTheDocument(); // total
    expect(screen.getByText(/verifier-a, verifier-b/i)).toBeInTheDocument(); // signers
  });

  it('shows the verify-on-chain link when verifyTx is present', () => {
    render(<DistributionReceiptCard receipt={receipt} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toContain(receipt.verifyTx as string);
  });

  it('omits the verify link when verifyTx is absent', () => {
    const { container } = render(
      <DistributionReceiptCard receipt={{ ...receipt, verifyTx: undefined }} />,
    );
    expect(container.querySelector('a')).toBeNull();
  });
});
