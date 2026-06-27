import { Check, X } from 'lucide-react';
import type { Verdict, Receipt } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function VerdictCard({ verdict, receipt }: { verdict: Verdict; receipt?: Receipt }) {
  const yes = verdict.verdict === 'yes';
  return (
    <div className={`rounded-md border bg-panel/80 p-3 ${yes ? 'border-yes/30' : 'border-no/30'}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{verdict.source}</span>
        <span className={`inline-flex items-center gap-1 font-mono text-sm font-bold uppercase ${yes ? 'text-yes' : 'text-no'}`}>
          {yes ? <Check size={14} /> : <X size={14} />}
          {verdict.verdict}
        </span>
      </div>
      <div className="mt-2 font-mono text-xs text-gray-300">
        {motesToCspr(verdict.observedAmount)} <span className="text-muted">CSPR observed</span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted">sig {verdict.signer.slice(0, 8)}…</div>
      {receipt &&
        (receipt.linkable ? (
          <div className="mt-2 font-mono text-[11px] text-muted">
            paid <TxLink kind="deploy" hash={receipt.deployHash} />
          </div>
        ) : (
          <div className="mt-2 font-mono text-[10px] text-muted">paid {receipt.deployHash.slice(0, 8)}…</div>
        ))}
    </div>
  );
}
