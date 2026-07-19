import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TxLink } from './TxLink';
import { QuorumGate } from './QuorumGate';
import { VerdictCard } from './VerdictCard';
import { VerifierReputationCard } from './VerifierReputationCard';
import type { VerifierReputation } from '@/lib/types';

describe('components', () => {
  it('TxLink builds a deploy url', () => {
    render(<TxLink kind="deploy" hash="a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d" />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://testnet.cspr.live/deploy/a02b1c7d2ed52ea82ff68740d9b5a65d9716cee8594b482a13d0c27e846d6a7d',
    );
  });
  it('QuorumGate shows MET vs NOT MET', () => {
    const { rerender } = render(<QuorumGate yesCount={3} required={2} met />);
    expect(screen.getByText(/QUORUM MET/i)).toBeInTheDocument();
    rerender(<QuorumGate yesCount={1} required={2} met={false} />);
    expect(screen.getByText(/QUORUM NOT MET/i)).toBeInTheDocument();
  });
  it('VerdictCard renders yes vs no', () => {
    render(<VerdictCard verdict={{ source: 'v1', verdict: 'yes', observedAmount: '1000000000000', signer: '21423f38', signature: 'bc38' }} />);
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('yes')).toBeInTheDocument();
  });
});

describe('VerifierReputationCard (SPEC-6)', () => {
  const rep: VerifierReputation = {
    signer: 'v1',
    pubkeyHex: '0121423f386b2700fe0cc65a5bb3bbb8dcadfa1dac6abe89b51f23b0af72c72892',
    cyclesSeen: 2,
    cyclesVoted: 2,
    cyclesAgreed: 1,
    lastVerdict: 'no',
    lastCycle: 'happy',
  };
  it('renders the raw counts + derived ratios', () => {
    render(<VerifierReputationCard reputation={rep} />);
    expect(screen.getByText('v1')).toBeInTheDocument(); // label
    // response rate = 2/2 = 100%; accuracy = 1/2 = 50% (unique strings)
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    // seen + voted both render '2' (two distinct count cells)
    expect(screen.getAllByText('2')).toHaveLength(2);
    // last vote = no
    expect(screen.getByText('no')).toBeInTheDocument();
  });

  it('renders a dash for last vote when the verifier has not voted', () => {
    render(<VerifierReputationCard reputation={{ ...rep, lastVerdict: null, lastCycle: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
