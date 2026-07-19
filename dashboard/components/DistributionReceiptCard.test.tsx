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
  reputationSnapshot: [
    { signer: 'verifier-a', cyclesSeen: 1, cyclesVoted: 1, cyclesAgreed: 1 },
    { signer: 'verifier-b', cyclesSeen: 1, cyclesVoted: 1, cyclesAgreed: 0 },
  ],
  brief: 'Cycle happy on 3 signed verdicts (3 yes / 0 no): the contract verified each Ed25519 signature on-chain, the quorum was met, and funds were released pro-rata to holders.',
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

  it('renders the reputation-at-settlement snapshot per verifier (SPEC-6)', () => {
    render(<DistributionReceiptCard receipt={receipt} />);
    expect(screen.getByText(/reputation at settlement/i)).toBeInTheDocument();
    // The block's explanatory copy uniquely identifies it.
    expect(screen.getByText(/track record each verifier brought/i)).toBeInTheDocument();
  });

  it('omits the reputation block when the snapshot is empty', () => {
    render(<DistributionReceiptCard receipt={{ ...receipt, reputationSnapshot: [] }} />);
    expect(screen.queryByText(/reputation at settlement/i)).toBeNull();
  });

  it('renders the AI verification brief when present (SPEC-5)', () => {
    render(<DistributionReceiptCard receipt={receipt} />);
    expect(screen.getByText(/AI verification brief/i)).toBeInTheDocument();
    expect(screen.getByText(/the brief reasons, the chain decides/i)).toBeInTheDocument();
    expect(screen.getByText(receipt.brief as string)).toBeInTheDocument();
  });

  it('omits the brief block when no brief is present', () => {
    render(<DistributionReceiptCard receipt={{ ...receipt, brief: undefined }} />);
    expect(screen.queryByText(/AI verification brief/i)).toBeNull();
  });
});
