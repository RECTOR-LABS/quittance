import type { DistributionReceipt } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';
import { ShieldCheck, History, Sparkles } from 'lucide-react';

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
        <div className="col-span-2">
          <dt className="text-muted">verified</dt>
          <dd className="text-yes">{receipt.signers.length} signature(s) verified on-chain (SPEC-4)</dd>
        </div>
      </dl>
      {receipt.reputationSnapshot.length > 0 && (
        <div className="mt-2 border-t border-edge pt-2">
          <div className="flex items-center gap-2">
            <History className="h-3 w-3 text-muted" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              reputation at settlement
            </span>
          </div>
          <p className="mt-0.5 font-sans text-[10px] text-muted">
            The track record each verifier brought to this cycle (pre-settlement).
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
            {receipt.reputationSnapshot.map((s) => (
              <span key={s.signer} className="text-muted">
                {s.signer}{' '}
                <span className="text-yes">{s.cyclesAgreed}</span>/{s.cyclesVoted}
              </span>
            ))}
          </div>
        </div>
      )}
      {receipt.brief && (
        <div className="mt-2 border-t border-edge pt-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-accent" aria-hidden />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              AI verification brief
            </span>
          </div>
          <p className="mt-0.5 font-sans text-[10px] text-muted">
            AI-generated explanation of the cryptographically verified record — the brief reasons, the chain decides.
          </p>
          <p className="mt-1 font-sans text-xs text-foreground">{receipt.brief}</p>
        </div>
      )}
      {receipt.verifyTx && (
        <div className="mt-2 font-mono text-xs text-muted">
          verify on chain <TxLink kind="deploy" hash={receipt.verifyTx} />
        </div>
      )}
    </div>
  );
}
