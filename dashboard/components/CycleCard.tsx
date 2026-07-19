import type { Cycle, DistributionReceipt } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { VerdictCard } from './VerdictCard';
import { QuorumGate } from './QuorumGate';
import { TxLink } from './TxLink';
import { DistributionReceiptCard } from './DistributionReceiptCard';

export function CycleCard({ cycle, receipt }: { cycle: Cycle; receipt?: DistributionReceipt }) {
  const receiptFor = (id: string) => cycle.receipts.find((r) => r.verifierId === id);
  const distributed = cycle.status === 'distributed';
  return (
    <section className="overflow-hidden rounded-lg border border-edge bg-panel/40">
      <header className={`flex items-center justify-between border-b border-dashed px-4 py-2.5 ${distributed ? 'border-yes/30' : 'border-no/30'}`}>
        <span className="font-mono text-xs font-bold uppercase tracking-[0.18em]">{cycle.cycleId} cycle</span>
        <span className={`font-mono text-[10px] uppercase tracking-[0.2em] ${distributed ? 'text-yes' : 'text-no'}`}>
          {distributed ? 'settled' : 'halted'}
        </span>
      </header>
      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {cycle.verdicts.map((v) => (
            <VerdictCard key={v.source} verdict={v} receipt={receiptFor(v.source)} />
          ))}
        </div>
        <QuorumGate yesCount={cycle.quorum.yesCount} required={cycle.quorum.required} met={cycle.quorum.met} />
        <div className="rounded-md border border-edge bg-ink/40 px-4 py-3">
          {distributed ? (
            <div>
              <div className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-yes">Distribute</div>
              <ul className="mt-2 space-y-1 font-mono text-sm">
                {cycle.payouts?.map((p) => (
                  <li key={p.holderLabel} className="flex justify-between">
                    <span className="text-muted">{p.holderLabel}</span>
                    <span className="text-yes">+{motesToCspr(p.motes)} CSPR</span>
                  </li>
                ))}
              </ul>
              {cycle.distributeTx && (
                <div className="mt-2 font-mono text-xs text-muted">
                  receipt <TxLink kind="deploy" hash={cycle.distributeTx} />
                </div>
              )}
              {receipt && <DistributionReceiptCard receipt={receipt} />}
            </div>
          ) : (
            <div>
              <div className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-no">Halt — funds withheld</div>
              <div className="mt-1 font-sans text-sm text-muted">No distribution. Holders unchanged.</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
