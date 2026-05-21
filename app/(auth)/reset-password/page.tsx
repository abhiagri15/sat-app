'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/app/lib/supabase/client';
import { resetPasswordSchema, type ResetPasswordValues } from '@/app/lib/auth/schemas';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent } from '@/app/components/ui/card';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // null = still checking; true = a recovery session is present; false = none.
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) });

  // The recovery session is established by /auth/callback before the user
  // lands here. If it is missing (link expired, or direct navigation), show a
  // clear message instead of a form that would fail on submit.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionReady(!!session);
    });
  }, []);

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setFormError(error.message);
      return;
    }
    router.push('/login');
    router.refresh();
  }

  if (sessionReady === false) {
    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-1 text-lg font-semibold">Reset link invalid</h2>
          <p className="mb-5 text-sm text-slate-500">
            This password-reset link is missing or has expired. Request a new one to continue.
          </p>
          <Link href="/forgot-password" className="text-sm text-blue-600 hover:underline">
            Request a new reset link
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-1 text-lg font-semibold">Set a new password</h2>
        <p className="mb-5 text-sm text-slate-500">Choose a new password for your account.</p>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register('password')}
            />
            {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-red-600">{errors.confirmPassword.message}</p>
            )}
          </div>
          {formError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Update password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
