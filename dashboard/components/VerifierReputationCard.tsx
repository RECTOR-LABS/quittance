import type { VerifierReputation } from '@/lib/types';
import { Activity, Award, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';

/**
 * Renders one verifier's on-chain reputation (SPEC-6 — the unique moat). The
 * track record each verifier carries: cycles seen (opportunity), cycles voted
 * (response), cycles agreed (accuracy). Derived ratios are computed off-chain
 * — no on-chain fixed-point math. Reputation is informational; it never gates
 * fund release (the quorum stays signature-based, SPEC-4).
 *
 * Honest copy: reputation tracks settled cycles only — halted cycles revert
 * before any state write, so they score nothing (the contract cannot
 * authoritatively establish ground truth without settlement). A compromised
 * verifier cannot inflate its score via a fraud cycle (the cycle halts, no
 * update, no reward).
 */
export function VerifierReputationCard({ reputation }: { reputation: VerifierReputation }) {
  const { cyclesSeen, cyclesVoted, cyclesAgreed } = reputation;
  const responseRate = cyclesSeen > 0 ? Math.round((cyclesVoted / cyclesSeen) * 100) : 0;
  const accuracy = cyclesVoted > 0 ? Math.round((cyclesAgreed / cyclesVoted) * 100) : 0;

  const LastIcon = reputation.lastVerdict === 'yes'
    ? CheckCircle2
    : reputation.lastVerdict === 'no'
      ? XCircle
      : MinusCircle;
  const lastClass = reputation.lastVerdict === 'yes'
    ? 'text-yes'
    : reputation.lastVerdict === 'no'
      ? 'text-no'
      : 'text-muted';

  return (
    <div className="rounded-md border border-edge bg-ink/40 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="h-3.5 w-3.5 text-accent" aria-hidden />
          <span className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-accent">
            {reputation.signer}
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">reputation</span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted">
        signer {reputation.pubkeyHex.slice(0, 12)}…
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1.5 font-mono text-xs">
        <div>
          <dt className="text-muted">seen</dt>
          <dd>{cyclesSeen}</dd>
        </div>
        <div>
          <dt className="text-muted">voted</dt>
          <dd>{cyclesVoted}</dd>
        </div>
        <div>
          <dt className="text-muted">agreed</dt>
          <dd className="text-yes">{cyclesAgreed}</dd>
        </div>
        <div>
          <dt className="text-muted">response</dt>
          <dd className="flex items-center gap-1">
            <Activity className="h-3 w-3 text-muted" aria-hidden />
            {responseRate}%
          </dd>
        </div>
        <div>
          <dt className="text-muted">accuracy</dt>
          <dd className="text-accent">{accuracy}%</dd>
        </div>
        <div>
          <dt className="text-muted">last vote</dt>
          <dd className={`flex items-center gap-1 ${lastClass}`}>
            <LastIcon className="h-3 w-3" aria-hidden />
            {reputation.lastVerdict ?? '—'}
          </dd>
        </div>
      </dl>
      {reputation.lastCycle && (
        <div className="mt-1 font-mono text-[10px] text-muted">
          last scored on cycle {reputation.lastCycle}
        </div>
      )}
    </div>
  );
}