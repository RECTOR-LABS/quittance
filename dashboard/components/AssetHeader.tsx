import type { AssetConfig } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function AssetHeader({ asset }: { asset: AssetConfig }) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Expected cashflow', `${motesToCspr(asset.expectedCashflowMotes)} CSPR`],
    ['Pool funded', `${motesToCspr(asset.pool.fundedMotes)} CSPR`],
    ['Quorum', `${asset.quorumRequired}-of-${asset.verifiers.length}`],
  ];
  return (
    <header className="overflow-hidden rounded-lg border border-edge bg-panel/40">
      <div className="border-b border-dashed border-edge px-5 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">Tokenized receivable</div>
        <div className="mt-1 flex items-baseline justify-between">
          <div className="font-mono text-2xl font-bold tracking-tight">{asset.reference}</div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-yes">● active</span>
        </div>
      </div>
      <div className="px-5 py-4">
        <p className="max-w-2xl font-sans text-sm leading-relaxed text-muted">{asset.narrative}</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{k}</dt>
              <dd className="mt-0.5 font-mono text-sm font-bold">{v}</dd>
            </div>
          ))}
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Vault</dt>
            <dd className="mt-0.5">
              <TxLink kind="contract" hash={asset.vault.packageHash} label="on-chain" />
            </dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
