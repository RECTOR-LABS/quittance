import type { Cycle } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { VerdictCard } from './VerdictCard';
import { QuorumGate } from './QuorumGate';
import { TxLink } from './TxLink';

export function CycleCard({ cycle }: { cycle: Cycle }) {
  const receiptFor = (id: string) => cycle.receipts.find((r) => r.verifierId === id);
  return (
    <section className="rounded-xl border border-edge bg-panel/40 p-4">
      <h3 className="mb-3 font-semibold capitalize">{cycle.cycleId} cycle</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {cycle.verdicts.map((v) => (
          <VerdictCard key={v.source} verdict={v} receipt={receiptFor(v.source)} />
        ))}
      </div>
      <div className="mt-3">
        <QuorumGate yesCount={cycle.quorum.yesCount} required={cycle.quorum.required} met={cycle.quorum.met} />
      </div>
      <div className="mt-3 rounded-lg border border-edge px-4 py-3">
        {cycle.status === 'distributed' ? (
          <div>
            <div className="font-semibold text-yes">DISTRIBUTE</div>
            <ul className="mt-1 font-mono text-sm">
              {cycle.payouts?.map((p) => (
                <li key={p.holderLabel}>
                  {p.holderLabel}: +{motesToCspr(p.motes)} CSPR
                </li>
              ))}
            </ul>
            {cycle.distributeTx && (
              <div className="mt-1 text-xs">
                tx: <TxLink kind="deploy" hash={cycle.distributeTx} />
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="font-semibold text-no">HALT — funds withheld</div>
            <div className="mt-1 font-mono text-sm text-muted">no distribution · holders unchanged</div>
          </div>
        )}
      </div>
    </section>
  );
}
