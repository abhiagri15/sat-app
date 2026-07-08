'use client';

// Client-assembled contact mailto (spec §E). The marketing page is public and
// indexable, and a Server Component's template assembly still ships the
// contiguous address in the static HTML — so the href is built AFTER
// hydration, in the browser, where harvesters scraping the served document
// never see it. Before hydration the link renders inert placeholder text.
import { useEffect, useState } from 'react';

const PARTS = ['vatekinc', 'gmail.com'] as const;

export function ContactLink({ className }: { className?: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    setHref(`mailto:${PARTS[0]}@${PARTS[1]}`);
  }, []);
  if (!href) {
    return <span className={className}>Contact the creator</span>;
  }
  return (
    <a href={href} className={className}>
      Contact the creator
    </a>
  );
}
