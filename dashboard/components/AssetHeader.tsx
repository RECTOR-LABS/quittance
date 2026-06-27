import { FileText } from 'lucide-react';
import type { AssetConfig } from '@/lib/types';
import { motesToCspr } from '@/lib/format';
import { TxLink } from './TxLink';

export function AssetHeader({ asset }: { asset: AssetConfig }) {
  return (
    <header className="rounded-xl border border-edge bg-panel/40 p-5">
      <div className="flex items-center gap-2 text-accent">
        <FileText size={18} />
        <span className="font-semibold">{asset.reference}</span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted">{asset.narrative}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">Expected cashflow</dt>
          <dd className="font-mono">{motesToCspr(asset.expectedCashflowMotes)} CSPR</dd>
        </div>
        <div>
          <dt className="text-muted">Pool funded</dt>
          <dd className="font-mono">{motesToCspr(asset.pool.fundedMotes)} CSPR</dd>
        </div>
        <div>
          <dt className="text-muted">Quorum</dt>
          <dd className="font-mono">
            {asset.quorumRequired}-of-{asset.verifiers.length}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Vault</dt>
          <dd>
            <TxLink kind="contract" hash={asset.vault.packageHash} label="contract" />
          </dd>
        </div>
      </dl>
    </header>
  );
}
