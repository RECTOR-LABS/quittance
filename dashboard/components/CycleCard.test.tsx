import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleCard } from './CycleCard';
import { getCycles } from '@/lib/data';

const cycles = getCycles();

describe('CycleCard', () => {
  it('happy cycle shows DISTRIBUTE + payouts', () => {
    render(<CycleCard cycle={cycles.find((c) => c.cycleId === 'happy')!} />);
    expect(screen.getByText(/DISTRIBUTE/i)).toBeInTheDocument();
    expect(screen.getByText('Holder A')).toBeInTheDocument();
    expect(screen.getByText(/\+7\s*CSPR/)).toBeInTheDocument();
  });
  it('fraud cycle shows HALT and no distribute', () => {
    render(<CycleCard cycle={cycles.find((c) => c.cycleId === 'fraud')!} />);
    expect(screen.getByText(/funds withheld/i)).toBeInTheDocument();
    expect(screen.queryByText('Distribute')).not.toBeInTheDocument();
  });
});
