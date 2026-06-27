import { ShieldCheck, ShieldX } from 'lucide-react';

/**
 * The thesis, stamped. When the quorum is met the cashflow is RELEASED;
 * when it is not, it is WITHHELD. This is the visual hero of every cycle.
 */
export function QuorumGate({ yesCount, required, met }: { yesCount: number; required: number; met: boolean }) {
  return (
    <div
      className={`relative flex items-center gap-4 overflow-hidden rounded-md border-2 border-dashed px-4 py-3 ${
        met ? 'border-yes/45 bg-yes/[0.06]' : 'border-no/45 bg-no/[0.06]'
      }`}
    >
      {met ? <ShieldCheck size={30} className="shrink-0 text-yes" /> : <ShieldX size={30} className="shrink-0 text-no" />}
      <div className="flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">Quorum {met ? 'met' : 'not met'}</div>
        <div className={`font-mono text-lg font-bold uppercase tracking-[0.15em] ${met ? 'text-yes' : 'text-no'}`}>
          {met ? 'Released' : 'Withheld'}
        </div>
      </div>
      <div className="text-right">
        <div className={`font-mono text-2xl font-bold leading-none ${met ? 'text-yes' : 'text-no'}`}>
          {yesCount}
          <span className="text-muted/70">/{required}</span>
        </div>
        <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">yes / needed</div>
      </div>
    </div>
  );
}
