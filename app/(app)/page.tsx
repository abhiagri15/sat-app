import SatPractice from '@/app/components/SatPractice';
import { getOrCreateProfile } from '@/app/lib/auth/profile';
import { getAttemptUsage } from '@/app/lib/config';

export default async function Home() {
  const profile = await getOrCreateProfile();
  const studentName = profile?.full_name || profile?.email || 'Student';
  const usage = await getAttemptUsage();
  return (
    <SatPractice
      studentName={studentName}
      attemptsUsedToday={usage.used}
      dailyAttemptLimit={usage.limit}
    />
  );
}
