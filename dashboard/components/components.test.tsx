import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TxLink } from './TxLink';
import { QuorumGate } from './QuorumGate';
import { VerdictCard } from './VerdictCard';

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
