'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/app/lib/supabase/client';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/app/lib/auth/schemas';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent } from '@/app/components/ui/card';

export default function ForgotPasswordPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordValues) {
    setFormError(null);
    const supabase = createClient();
    // Route the reset link through /auth/callback so the PKCE `code` is
    // exchanged for a session before the user reaches the reset form.
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    if (error) {
      setFormError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-1 text-lg font-semibold">Reset your password</h2>
        {sent ? (
          <p className="text-sm text-slate-600">
            If an account exists for that email, a password-reset link is on its way.
            Check your inbox.
          </p>
        ) : (
          <>
            <p className="mb-5 text-sm text-slate-500">
              Enter your email and we&apos;ll send you a reset link.
            </p>
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" {...register('email')} />
                {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
              </div>
              {formError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          </>
        )}
        <p className="mt-5 text-center text-sm text-slate-500">
          <Link href="/login" className="text-blue-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
