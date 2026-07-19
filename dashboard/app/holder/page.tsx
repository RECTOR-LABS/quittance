import { getAsset, getCycles, distributionReceiptForCycle } from '@/lib/data';
import { liveBalanceMotes } from '@/lib/chain';
import { HolderRow } from '@/components/HolderRow';
import { DistributionReceiptCard } from '@/components/DistributionReceiptCard';

export const dynamic = 'force-dynamic';

export default async function HolderPage() {
  const asset = getAsset();
  const cycles = getCycles();
  const happy = cycles.find((c) => c.cycleId === 'happy2')!;
  const rows = await Promise.all(
    asset.holders.map(async (h) => ({
      holder: h,
      received: happy.payouts?.find((p) => p.holderLabel === h.label)?.motes ?? '0',
      live: await liveBalanceMotes(h.publicKeyHex),
    })),
  );
  return (
    <div className="space-y-6">
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">Holder receipts</div>
        <h1 className="mt-2 max-w-2xl font-sans text-2xl font-semibold leading-snug">
          Balances are live from chain — and unchanged after the fraud cycle halted.
        </h1>
        <p className="mt-2 font-sans text-sm text-muted">The refusal, seen from the holder&apos;s side: no quorum, no payout.</p>
      </section>
      <div className="grid gap-3">
        {rows.map((r) => (
          <HolderRow key={r.holder.label} holder={r.holder} receivedMotes={r.received} liveMotes={r.live} distributeTx={happy.distributeTx} />
        ))}
      </div>
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">Distribution receipt</div>
        <p className="mb-3 mt-1 font-sans text-sm text-muted">
          The happy cycle&apos;s payout, recorded on chain — queryable via{' '}
          <code className="font-mono">get_receipt</code>.
        </p>
        <DistributionReceiptCard receipt={distributionReceiptForCycle(happy, asset, cycles)} />
      </section>
    </div>
  );
}
