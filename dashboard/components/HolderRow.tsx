import type { Holder } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function HolderRow({
  holder,
  receivedMotes,
  liveMotes,
  distributeTx,
}: {
  holder: Holder;
  receivedMotes: string;
  liveMotes: string | null;
  distributeTx?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-panel/40">
      <div className="flex items-center justify-between border-b border-dashed border-edge px-4 py-2.5">
        <span className="font-mono text-sm font-bold uppercase tracking-[0.12em]">{holder.label}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{holder.weightPct}% share</span>
      </div>
      <div className="flex items-end justify-between px-4 py-3">
        <div className="space-y-1 text-xs">
          <div className="font-mono text-muted">
            acct <TxLink kind="account" hash={holder.publicKeyHex} label={`${holder.accountHash.slice(0, 10)}…`} />
          </div>
          <div className="font-mono text-muted">
            received {motesToCspr(receivedMotes)} CSPR
            {distributeTx && (
              <>
                {' · '}
                <TxLink kind="deploy" hash={distributeTx} />
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-bold leading-none">{motesToCspr(liveMotes ?? receivedMotes)}</div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
            {liveMotes ? 'CSPR · live balance' : 'CSPR · ledger value'}
          </div>
        </div>
      </div>
    </div>
  );
}
