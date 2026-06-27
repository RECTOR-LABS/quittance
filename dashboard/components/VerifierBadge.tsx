import type { Verifier } from '@/lib/types';

export function VerifierBadge({ verifier }: { verifier: Verifier }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2">
      <div className="font-mono text-sm">{verifier.label}</div>
      <div className="mt-1 font-mono text-xs text-muted">
        signer {verifier.publicKeyHex.slice(0, 10)}…
      </div>
    </div>
  );
}
