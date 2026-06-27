import { Check, X } from 'lucide-react';
import type { Verdict, Receipt } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function VerdictCard({ verdict, receipt }: { verdict: Verdict; receipt?: Receipt }) {
  const yes = verdict.verdict === 'yes';
  return (
    <div className={`rounded-lg border p-3 ${yes ? 'border-yes/30' : 'border-no/30'} bg-panel`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm">{verdict.source}</span>
        <span className={`inline-flex items-center gap-1 text-sm font-semibold ${yes ? 'text-yes' : 'text-no'}`}>
          {yes ? <Check size={14} /> : <X size={14} />}
          {verdict.verdict}
        </span>
      </div>
      <div className="mt-1 font-mono text-xs text-muted">observed {motesToCspr(verdict.observedAmount)} CSPR</div>
      <div className="mt-1 font-mono text-[11px] text-muted">signed by {verdict.signer.slice(0, 8)}…</div>
      {receipt &&
        (receipt.linkable ? (
          <div className="mt-2 text-xs">
            paid: <TxLink kind="deploy" hash={receipt.deployHash} />
          </div>
        ) : (
          <div className="mt-2 font-mono text-[11px] text-muted">paid: {receipt.deployHash.slice(0, 8)}…</div>
        ))}
    </div>
  );
}
