import { getAsset, getCycles } from '@/lib/data';
import { AssetHeader } from '@/components/AssetHeader';
import { VerifierBadge } from '@/components/VerifierBadge';
import { CycleCard } from '@/components/CycleCard';

export const revalidate = 15;

export default function IssuerPage() {
  const asset = getAsset();
  const cycles = getCycles();
  return (
    <div className="space-y-8">
      <AssetHeader asset={asset} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Holders &amp; verifiers</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <h3 className="mb-2 font-semibold">Holders</h3>
            {asset.holders.map((h) => (
              <div key={h.label} className="flex justify-between font-mono text-sm">
                <span>{h.label}</span>
                <span>{h.weightPct}%</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <h3 className="mb-2 font-semibold">Verifiers</h3>
            <div className="grid gap-2">
              {asset.verifiers.map((v) => (
                <VerifierBadge key={v.label} verifier={v} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Cycle history — verify, not attest</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {cycles.map((c) => (
            <CycleCard key={c.cycleId} cycle={c} />
          ))}
        </div>
      </section>
    </div>
  );
}
