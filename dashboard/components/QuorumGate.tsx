import { ShieldCheck, ShieldX } from 'lucide-react';

export function QuorumGate({ yesCount, required, met }: { yesCount: number; required: number; met: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${met ? 'border-yes/40 bg-yes/10' : 'border-no/40 bg-no/10'}`}>
      {met ? <ShieldCheck className="text-yes" /> : <ShieldX className="text-no" />}
      <div>
        <div className={`font-semibold ${met ? 'text-yes' : 'text-no'}`}>{met ? 'QUORUM MET' : 'QUORUM NOT MET'}</div>
        <div className="font-mono text-xs text-muted">{yesCount} verified yes · quorum needs {required}</div>
      </div>
    </div>
  );
}
