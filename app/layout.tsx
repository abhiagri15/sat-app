import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'SAT Practice Test',
  description: 'A timed, replayable SAT-style practice test with instant scoring and explanations.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning silences false positives from browser
          extensions (Grammarly, Dark Reader, password managers) that inject
          data-* attributes into <body> after SSR but before React hydrates.
          Scoped to <body> only — does NOT affect hydration checks elsewhere. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
