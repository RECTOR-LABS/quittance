import './globals.css';
import Link from 'next/link';
import { Space_Mono, IBM_Plex_Sans } from 'next/font/google';
import { ShieldCheck } from 'lucide-react';

const mono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-mono' });
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' });

export const metadata = {
  title: 'Quittance — verify, not attest',
  description: 'Verification-gated servicing for tokenized cashflows on Casper.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>
        <nav className="sticky top-0 z-10 border-b border-edge bg-ink/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-[0.18em]">
              <ShieldCheck size={16} className="text-accent" /> Quittance
            </span>
            <div className="flex items-center gap-6 font-mono text-xs uppercase tracking-[0.18em]">
              <Link href="/" className="text-muted transition-colors hover:text-gray-100">Issuer</Link>
              <Link href="/holder" className="text-muted transition-colors hover:text-gray-100">Holder</Link>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-muted/60">
          Quittance · casper-test · verify, not attest
        </footer>
      </body>
    </html>
  );
}
