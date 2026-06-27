import { ExternalLink } from 'lucide-react';
import { truncateHash, deployUrl, accountUrl, contractUrl } from '@/lib/format';

const URL_FOR = { deploy: deployUrl, account: accountUrl, contract: contractUrl } as const;

export function TxLink({ kind, hash, label }: { kind: 'deploy' | 'account' | 'contract'; hash: string; label?: string }) {
  return (
    <a
      href={URL_FOR[kind](hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-sky-400 hover:underline"
    >
      {label ?? truncateHash(hash)} <ExternalLink size={11} />
    </a>
  );
}
