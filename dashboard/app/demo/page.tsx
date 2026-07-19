import Link from 'next/link';
import { getAsset, getCycles, distributionReceiptForCycle, verifierRegistryFromCommitted } from '@/lib/data';
import { TryTheFraudDemo } from '@/components/TryTheFraudDemo';

export const metadata = {
  title: 'Quittance — demo',
  description:
    'Watch verification-gated servicing release on a real 2-of-3 quorum and refuse a fraudulent one — both proven on Casper.',
};

export default function DemoPage() {
  const asset = getAsset();
  const cycles = getCycles();
  const happy = cycles.find((c) => c.cycleId === 'happy')!;
  const fraud = cycles.find((c) => c.cycleId === 'fraud')!;
  const happyReceipt = distributionReceiptForCycle(happy, asset, cycles);
  const reputation = verifierRegistryFromCommitted(asset, cycles);

  return (
    <div className="space-y-8">
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">Demo · interactive + ~2 min video</div>
        <h1 className="mt-2 max-w-2xl font-sans text-2xl font-semibold leading-snug sm:text-3xl">
          Watch the agent refuse to release funds on a single dishonest &ldquo;yes.&rdquo;
        </h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em] text-muted">verify, not attest</p>
      </section>

      <TryTheFraudDemo asset={asset} fraud={fraud} happy={happy} happyReceipt={happyReceipt} reputation={reputation} />

      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">The recorded walkthrough</div>
        <h2 className="mt-1 font-sans text-lg font-semibold">Both cycles, proven live on casper-test</h2>
        <video
        className="aspect-video w-full rounded-xl border border-edge bg-black"
        controls
        preload="metadata"
        poster="/demo-poster.png"
        playsInline
      >
        <source src="/quittance-demo.mp4" type="video/mp4" />
        Your browser can&rsquo;t play embedded video.{' '}
        <a className="text-accent underline" href="/quittance-demo.mp4">
          Download the MP4
        </a>
        .
      </video>

      <p className="max-w-2xl font-mono text-xs leading-relaxed text-muted">
        <span className="text-yes">Happy cycle:</span> a 2-of-3 quorum confirms the cashflow → the vault
        distributes 7 / 3 CSPR on-chain.{' '}
        <span className="text-no">Fraud cycle:</span> one verifier lies &ldquo;yes,&rdquo; the quorum fails → the
        agent halts, pays nothing, and holder balances stay untouched. Both proven live on casper-test.
      </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/"
          className="rounded-lg border border-edge bg-panel/40 p-4 transition-colors hover:border-muted"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Issuer</div>
          <div className="mt-1 font-mono text-sm">Asset &amp; cycle history</div>
        </Link>
        <Link
          href="/holder"
          className="rounded-lg border border-edge bg-panel/40 p-4 transition-colors hover:border-muted"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Holder</div>
          <div className="mt-1 font-mono text-sm">Live on-chain balances</div>
        </Link>
        <a
          href="https://github.com/RECTOR-LABS/quittance"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-edge bg-panel/40 p-4 transition-colors hover:border-muted"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Source</div>
          <div className="mt-1 font-mono text-sm">github.com/RECTOR-LABS</div>
        </a>
      </section>
    </div>
  );
}
