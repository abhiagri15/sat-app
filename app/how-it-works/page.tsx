// app/how-it-works/page.tsx
//
// Public-facing explainer. Single fetch site for live pool numbers; sections
// receive stats as props (Hero, PoolComposition). All other sections are
// content-only.
//
// ISR: revalidate=3600. The page HTML is regenerated at most once an hour.
// If the RPC fails the page still renders — Hero hides the stat strip,
// PoolComposition shows a "temporarily unavailable" fallback.

import { getPublicPoolStats } from '@/app/lib/marketing/queries';
import { MarketingHeader } from './_components/MarketingHeader';
import { MarketingFooter } from './_components/MarketingFooter';
import { AnchorNav } from './_components/AnchorNav';
import { Hero } from './_components/Hero';
import { WhatYouGet } from './_components/WhatYouGet';
import { HowItWorks } from './_components/HowItWorks';
import { Parity } from './_components/Parity';
import { QuestionPipeline } from './_components/QuestionPipeline';
import { PoolComposition } from './_components/PoolComposition';
import { FaqAccordion } from './_components/FaqAccordion';
import { CtaFooter } from './_components/CtaFooter';

export const revalidate = 3600;

export const metadata = {
  title: 'How it works — SAT Practice',
  description:
    'Adaptive Digital SAT practice. Every College Board skill, fresh questions, targeted drills on your weakest skills, and personalized coaching.',
};

export default async function HowItWorksPage() {
  const stats = await getPublicPoolStats();

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <AnchorNav />
      <Hero stats={stats} />
      <WhatYouGet />
      <HowItWorks />
      <Parity />
      <QuestionPipeline />
      <PoolComposition stats={stats} />
      <FaqAccordion />
      <CtaFooter />
      <MarketingFooter />
    </div>
  );
}
