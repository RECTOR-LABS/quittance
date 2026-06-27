import './globals.css';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

export const metadata = {
  title: 'Quittance — verify, not attest',
  description: 'Verification-gated servicing for tokenized cashflows on Casper.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="border-b border-edge bg-panel/60">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
            <span className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={18} className="text-accent" /> Quittance
            </span>
            <Link href="/" className="text-sm text-muted hover:text-gray-100">Issuer</Link>
            <Link href="/holder" className="text-sm text-muted hover:text-gray-100">Holder</Link>
          </div>
        </nav>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
