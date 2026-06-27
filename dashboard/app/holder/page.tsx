import { getAsset, getCycles } from '@/lib/data';
import { liveBalanceMotes } from '@/lib/chain';
import { HolderRow } from '@/components/HolderRow';

export const dynamic = 'force-dynamic';

export default async function HolderPage() {
  const asset = getAsset();
  const happy = getCycles().find((c) => c.cycleId === 'happy')!;
  const rows = await Promise.all(
    asset.holders.map(async (h) => ({
      holder: h,
      received: happy.payouts?.find((p) => p.holderLabel === h.label)?.motes ?? '0',
      live: await liveBalanceMotes(h.publicKeyHex),
    })),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Holder receipts</h1>
      <p className="text-sm text-muted">
        After the fraud cycle halted, these balances are unchanged — the refusal, from the holder&apos;s side.
      </p>
      <div className="grid gap-3">
        {rows.map((r) => (
          <HolderRow key={r.holder.label} holder={r.holder} receivedMotes={r.received} liveMotes={r.live} distributeTx={happy.distributeTx} />
        ))}
      </div>
    </div>
  );
}
