import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TryTheFraudDemo } from './TryTheFraudDemo';
import { getAsset, getCycles, distributionReceiptForCycle, verifierRegistryFromCommitted } from '@/lib/data';

// Build props from the real committed-ledger data (the same data the /demo page
// passes) — tests the real integration, not a synthetic fixture.
const asset = getAsset();
const cycles = getCycles();
const happy = cycles.find((c) => c.cycleId === 'happy2')!;
const fraud = cycles.find((c) => c.cycleId === 'fraud')!;
const happyReceipt = distributionReceiptForCycle(happy, asset, cycles);
const reputation = verifierRegistryFromCommitted(asset, cycles);

const props = { asset, fraud, happy, happyReceipt, reputation };

describe('TryTheFraudDemo (SPEC-3)', () => {
  // T5 (always-visible honest copy) + T1 (initial scenario step).
  it('renders the scenario step first with the honest framing copy', () => {
    render(<TryTheFraudDemo {...props} />);
    // Honest copy is always visible in the intro.
    expect(screen.getByText(/not a simulation of a different system/i)).toBeInTheDocument();
    // The attack button is present on the scenario step.
    expect(
      screen.getByRole('button', { name: /compromise a verifier/i }),
    ).toBeInTheDocument();
    // Step indicator marks "scenario" active.
    expect(screen.getByText('1. scenario')).toBeInTheDocument();
  });

  // T2. the attack button advances → refusal (quorum NOT MET).
  it('advances to the refusal when the attack button is clicked', () => {
    render(<TryTheFraudDemo {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /compromise a verifier/i }));
    // The refusal step shows the quorum gate withheld (1 yes / 2 needed).
    expect(screen.getByText(/quorum not met/i)).toBeInTheDocument();
    expect(screen.getByText(/1\/2/i)).toBeInTheDocument();
  });

  // T3. the refusal panel surfaces all four SPEC properties.
  it('surfaces the four consequences of the halt in the refusal step', () => {
    render(<TryTheFraudDemo {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /compromise a verifier/i }));
    expect(screen.getByText(/no receipt written/i)).toBeInTheDocument();
    expect(screen.getByText(/no payout/i)).toBeInTheDocument();
    expect(screen.getByText(/reputation unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/no ai brief/i)).toBeInTheDocument();
  });

  // T4. the contrast step shows the happy cycle's receipt + reputation.
  it('shows the happy-cycle receipt + reputation in the contrast step', () => {
    render(<TryTheFraudDemo {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /compromise a verifier/i }));
    fireEvent.click(screen.getByRole('button', { name: /see the honest contrast/i }));
    // The contrast step shows the quorum met (released).
    expect(screen.getByText(/the chain releases/i)).toBeInTheDocument();
    // The on-chain receipt card renders (SPEC-1).
    expect(screen.getAllByText(/on-chain receipt/i).length).toBeGreaterThan(0);
    // Verifier reputation renders (SPEC-6).
    expect(screen.getByText(/verifier reputation/i)).toBeInTheDocument();
  });

  // T1 (continued). the why step is reachable + offers a restart.
  it('reaches the why step and can restart', () => {
    render(<TryTheFraudDemo {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /compromise a verifier/i }));
    fireEvent.click(screen.getByRole('button', { name: /see the honest contrast/i }));
    fireEvent.click(screen.getByRole('button', { name: /why this matters/i }));
    expect(screen.getByText(/the thesis/i)).toBeInTheDocument();
    expect(screen.getByText(/verify, not attest/i)).toBeInTheDocument();
    // Restart returns to the scenario step.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(
      screen.getByRole('button', { name: /compromise a verifier/i }),
    ).toBeInTheDocument();
  });
});