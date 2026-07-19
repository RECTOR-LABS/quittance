'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AssetConfig, Cycle, DistributionReceipt, VerifierReputation } from '@/lib/types';
import { QuorumGate } from './QuorumGate';
import { VerdictCard } from './VerdictCard';
import { DistributionReceiptCard } from './DistributionReceiptCard';
import { VerifierReputationCard } from './VerifierReputationCard';
import {
  ArrowRight,
  ShieldX,
  FileX,
  Coins,
  Award,
  Sparkles,
  RefreshCw,
  Github,
} from 'lucide-react';

/**
 * The interactive "try the fraud" demo (SPEC-3). A guided, client-side
 * walkthrough of the real on-chain logic over the testnet-proven cycle:
 *
 *   scenario → attack (compromise a verifier) → refusal → contrast → why
 *
 * The judge drives the attack and watches the chain refuse — surfacing SPEC-4
 * (on-chain signature gate), SPEC-1 (no receipt on halt), SPEC-6 (halted cycles
 * don't score), and SPEC-5 (no brief on halt) — then sees the happy contrast.
 *
 * Honest framing: this visualizes the deployed + tested system over the real
 * committed verdict data, not a simulation of a different system. A live
 * on-chain read is a documented post-deploy enhancement.
 */
type Step = 'scenario' | 'refusal' | 'contrast' | 'why';

export interface TryTheFraudDemoProps {
  asset: AssetConfig;
  fraud: Cycle;
  happy: Cycle;
  happyReceipt: DistributionReceipt;
  reputation: VerifierReputation[];
}

export function TryTheFraudDemo({ asset, fraud, happy, happyReceipt, reputation }: TryTheFraudDemoProps) {
  const [step, setStep] = useState<Step>('scenario');
  const [attacked, setAttacked] = useState(false);

  const fraudYes = fraud.verdicts.filter((v) => v.verdict === 'yes').length;

  return (
    <div className="rounded-xl border border-edge bg-panel/30 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <ShieldX className="h-4 w-4 text-no" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Interactive · try the fraud
        </span>
      </div>
      <h2 className="mt-2 max-w-2xl font-sans text-xl font-semibold leading-snug sm:text-2xl">
        Feed a fake &ldquo;paid&rdquo; claim. Watch the chain refuse.
      </h2>
      <p className="mt-1 max-w-2xl font-sans text-sm text-muted">
        A guided walkthrough of the real on-chain logic over the testnet-proven cycle — not a simulation
        of a different system. The contract verifies each signature on-chain; verifiers carry reputation;
        the AI explains. The chain decides.
      </p>

      {/* Step indicator */}
      <ol className="mt-4 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
        {(['scenario', 'refusal', 'contrast', 'why'] as Step[]).map((s, i) => (
          <li
            key={s}
            className={`rounded border px-2 py-0.5 ${
              step === s ? 'border-accent text-accent' : 'border-edge text-muted'
            }`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <div className="mt-4">
        {step === 'scenario' && (
          <ScenarioStep
            asset={asset}
            attacked={attacked}
            onAttack={() => {
              setAttacked(true);
              setStep('refusal');
            }}
          />
        )}
        {step === 'refusal' && (
          <RefusalStep
            fraud={fraud}
            fraudYes={fraudYes}
            onContinue={() => setStep('contrast')}
          />
        )}
        {step === 'contrast' && (
          <ContrastStep
            happy={happy}
            happyReceipt={happyReceipt}
            reputation={reputation}
            onContinue={() => setStep('why')}
          />
        )}
        {step === 'why' && <WhyStep onRestart={() => { setAttacked(false); setStep('scenario'); }} />}
      </div>
    </div>
  );
}

// --- step 1: the scenario ---------------------------------------------------

function ScenarioStep({
  asset,
  attacked,
  onAttack,
}: {
  asset: AssetConfig;
  attacked: boolean;
  onAttack: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-edge bg-ink/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">The asset</div>
          <div className="mt-1 font-mono text-sm">Tokenized invoice {asset.assetId}</div>
          <div className="mt-1 font-sans text-xs text-muted">{asset.narrative}</div>
        </div>
        <div className="rounded-md border border-edge bg-ink/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Investors</div>
          <div className="mt-1 space-y-0.5">
            {asset.holders.map((h) => (
              <div key={h.label} className="font-mono text-xs">
                {h.label} <span className="text-muted">{h.weightPct}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-edge bg-ink/40 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Verifiers</div>
          <div className="mt-1 space-y-0.5">
            {asset.verifiers.map((v) => (
              <div key={v.label} className="font-mono text-xs">
                {v.label} <span className="text-muted">· x402-paid</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="font-sans text-sm text-muted">
        A servicing cycle is due. The agent pays three independent verifiers over{' '}
        <a href="https://x402.org" className="text-accent underline" target="_blank" rel="noopener noreferrer">x402</a>{' '}
        to answer: <i>&ldquo;did the cashflow arrive?&rdquo;</i> The contract will release funds only on a
        {' '}{asset.quorumRequired}-of-{asset.verifiers.length} quorum of signed yes-verdicts — verified on-chain.
      </p>
      <button
        type="button"
        onClick={onAttack}
        disabled={attacked}
        className="inline-flex items-center gap-2 rounded-md border border-no/50 bg-no/[0.08] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.15em] text-no transition-colors hover:bg-no/[0.16] disabled:opacity-40"
      >
        <ShieldX className="h-4 w-4" aria-hidden />
        Compromise a verifier — submit a fake &ldquo;paid&rdquo; claim
      </button>
      <p className="font-sans text-xs text-muted">
        You bribe one verifier to sign &ldquo;yes&rdquo; even though the cashflow never arrived. The other two
        honestly report &ldquo;no.&rdquo;
      </p>
    </div>
  );
}

// --- step 2: the refusal ----------------------------------------------------

function RefusalStep({
  fraud,
  fraudYes,
  onContinue,
}: {
  fraud: Cycle;
  fraudYes: number;
  onContinue: () => void;
}) {
  const required = fraud.quorum.required;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {fraud.verdicts.map((v) => (
          <VerdictCard key={v.source} verdict={v} />
        ))}
      </div>
      <QuorumGate yesCount={fraudYes} required={required} met={false} />
      <div className="rounded-md border border-no/40 bg-no/[0.05] p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-no">
          The chain refuses · funds withheld
        </div>
        <p className="mt-1 font-sans text-sm text-muted">
          The contract verified each signature on-chain (SPEC-4), counted the valid yes-votes, and found
          {' '}{fraudYes}/{required} — below quorum. It reverted <code className="font-mono">QuorumNotMet</code>{' '}
          and released nothing.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          <RefusalConsequence icon={FileX} label="No receipt written" spec="SPEC-1" />
          <RefusalConsequence icon={Coins} label="No payout · holders unchanged" spec="SPEC-4" />
          <RefusalConsequence icon={Award} label="Reputation unchanged (halted cycles don't score)" spec="SPEC-6" />
          <RefusalConsequence icon={Sparkles} label="No AI brief (no settlement to anchor to)" spec="SPEC-5" />
        </ul>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="inline-flex items-center gap-2 rounded-md border border-yes/50 bg-yes/[0.08] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.15em] text-yes transition-colors hover:bg-yes/[0.16]"
      >
        See the honest contrast <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function RefusalConsequence({
  icon: Icon,
  label,
  spec,
}: {
  icon: typeof FileX;
  label: string;
  spec: string;
}) {
  return (
    <li className="flex items-center gap-2 rounded border border-edge bg-ink/40 px-3 py-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-no" aria-hidden />
      <span className="font-sans text-xs text-foreground">{label}</span>
      <span className="ml-auto font-mono text-[10px] text-muted">{spec}</span>
    </li>
  );
}

// --- step 3: the contrast ---------------------------------------------------

function ContrastStep({
  happy,
  happyReceipt,
  reputation,
  onContinue,
}: {
  happy: Cycle;
  happyReceipt: DistributionReceipt;
  reputation: VerifierReputation[];
  onContinue: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {happy.verdicts.map((v) => (
          <VerdictCard key={v.source} verdict={v} />
        ))}
      </div>
      <QuorumGate yesCount={happy.quorum.yesCount} required={happy.quorum.required} met />
      <div className="rounded-md border border-yes/40 bg-yes/[0.05] p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-yes">
          The chain releases · funds move
        </div>
        <p className="mt-1 font-sans text-sm text-muted">
          When all three verifiers honestly sign &ldquo;yes,&rdquo; the contract verifies each signature
          on-chain, the quorum is met, and funds are released pro-rata — with a full verifiable record:
        </p>
        <div className="mt-3">
          <DistributionReceiptCard receipt={happyReceipt} />
        </div>
        <div className="mt-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            Verifier reputation (settled cycles only)
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {reputation.map((r) => (
              <VerifierReputationCard key={r.signer} reputation={r} />
            ))}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onContinue}
        className="inline-flex items-center gap-2 rounded-md border border-accent/50 bg-accent/[0.08] px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.15em] text-accent transition-colors hover:bg-accent/[0.16]"
      >
        Why this matters <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

// --- step 4: the why --------------------------------------------------------

function WhyStep({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-edge bg-ink/40 p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">The thesis</div>
        <p className="mt-2 font-sans text-sm leading-relaxed text-foreground">
          You cannot bribe one verifier to unlock the money. The contract verifies the quorum{' '}
          <b>on-chain</b> (SPEC-4) — a forged signature, a replayed verdict, or the servicer key alone are
          all rejected by the chain itself. Verifiers carry <b>on-chain reputation</b> (SPEC-6), so a
          consistently-wrong verifier is visible, not hidden. The AI <b>explains</b> the verified record
          (SPEC-5) — it reasons, the chain decides.
        </p>
        <p className="mt-2 font-sans text-sm text-muted">
          <b>Verify, not attest.</b> The strongest on-chain verification in the finalist field — and a
          unique reputation moat no competitor matches.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md border border-edge bg-panel/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:border-muted"
        >
          Explore the issuer view <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <a
          href="https://github.com/RECTOR-LABS/quittance"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-edge bg-panel/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:border-muted"
        >
          <Github className="h-3.5 w-3.5" aria-hidden /> Read the source
        </a>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-2 rounded-md border border-edge bg-panel/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.15em] transition-colors hover:border-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
        </button>
      </div>
    </div>
  );
}