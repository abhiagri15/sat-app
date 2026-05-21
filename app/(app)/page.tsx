import SatPractice from '@/app/components/SatPractice';
import { getOrCreateProfile } from '@/app/lib/auth/profile';

export default async function Home() {
  const profile = await getOrCreateProfile();
  const studentName = profile?.full_name || profile?.email || 'Student';
  return <SatPractice studentName={studentName} />;
}
