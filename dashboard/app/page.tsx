import { getAsset, getCycles } from '@/lib/data';
import { AssetHeader } from '@/components/AssetHeader';
import { VerifierBadge } from '@/components/VerifierBadge';
import { CycleCard } from '@/components/CycleCard';

export const revalidate = 15;

export default function IssuerPage() {
  const asset = getAsset();
  const cycles = getCycles();
  return (
    <div className="space-y-10">
      <section>
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">Verification-gated servicing</div>
        <h1 className="mt-2 max-w-2xl font-sans text-2xl font-semibold leading-snug sm:text-3xl">
          Funds reach holders only after an independent quorum confirms the cashflow arrived.
        </h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em] text-muted">verify, not attest</p>
      </section>

      <AssetHeader asset={asset} />

      <section>
        <h2 className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted">Holders &amp; verifiers</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-edge bg-panel/40 p-4">
            <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-muted">Holders</h3>
            <div className="space-y-1.5">
              {asset.holders.map((h) => (
                <div key={h.label} className="flex justify-between font-mono text-sm">
                  <span>{h.label}</span>
                  <span className="text-muted">{h.weightPct}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-edge bg-panel/40 p-4">
            <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-muted">Verifiers</h3>
            <div className="grid gap-2">
              {asset.verifiers.map((v) => (
                <VerifierBadge key={v.label} verifier={v} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-1 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-muted">Cycle history</h2>
        <p className="mb-3 font-sans text-sm text-muted">
          Same vault, same verifiers — only the consensus differs. The contrast is the thesis.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {cycles.map((c) => (
            <CycleCard key={c.cycleId} cycle={c} />
          ))}
        </div>
      </section>
    </div>
  );
}
