import type { DistributionReceipt } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';
import { ShieldCheck } from 'lucide-react';

/**
 * Renders the on-chain distribution receipt (SPEC-1) — the queryable mirror of
 * the `Distributed` event, stored per `(assetId, cycleId)` and readable via the
 * contract's `get_receipt`. The verifiable record that a cycle's quorum was met
 * before funds moved. Distinct from the per-verifier x402 payment `Receipt`.
 */
export function DistributionReceiptCard({ receipt }: { receipt: DistributionReceipt }) {
  return (
    <div className="mt-3 rounded-md border border-edge bg-ink/40 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
          <span className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-accent">
            On-chain receipt
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">get_receipt()</span>
      </div>
      <p className="mt-1 font-sans text-xs text-muted">
        Queryable on chain — the quorum proof, settled.
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">total</dt>
          <dd className="text-yes">{motesToCspr(receipt.totalDistributedMotes)} CSPR</dd>
        </div>
        <div>
          <dt className="text-muted">holders</dt>
          <dd>{receipt.holderCount}</dd>
        </div>
        <div>
          <dt className="text-muted">quorum</dt>
          <dd>{receipt.quorumRequired}</dd>
        </div>
        <div>
          <dt className="text-muted">dust retained</dt>
          <dd>{motesToCspr(receipt.dustRetainedMotes)} CSPR</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">signers</dt>
          <dd className="break-words">{receipt.signers.join(', ') || '—'}</dd>
        </div>
      </dl>
      {receipt.verifyTx && (
        <div className="mt-2 font-mono text-xs text-muted">
          verify on chain <TxLink kind="deploy" hash={receipt.verifyTx} />
        </div>
      )}
    </div>
  );
}
