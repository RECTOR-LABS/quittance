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
    <div className="rounded-xl border border-edge bg-panel/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">{holder.label}</div>
          <div className="font-mono text-xs text-muted">
            {holder.weightPct}% · <TxLink kind="account" hash={holder.publicKeyHex} label={`${holder.accountHash.slice(0, 10)}…`} />
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg">{motesToCspr(liveMotes ?? receivedMotes)} CSPR</div>
          <div className="text-[11px] text-muted">{liveMotes ? 'live balance' : 'live read unavailable — ledger value'}</div>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">
        received {motesToCspr(receivedMotes)} CSPR in the happy cycle
        {distributeTx && (
          <>
            {' · '}
            <TxLink kind="deploy" hash={distributeTx} />
          </>
        )}
      </div>
    </div>
  );
}
