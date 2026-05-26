'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/app/lib/supabase/client';
import { loginSchema, type LoginValues } from '@/app/lib/auth/schemas';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent } from '@/app/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(error.message);
      return;
    }
    router.push('/');
    router.refresh();
  }

  async function signInWithGoogle() {
    setFormError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setFormError(error.message);
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
        <p className="mb-5 text-sm text-slate-500">Welcome back. Sign in to start practicing.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register('password')}
            />
            {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
          </div>
          {formError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <Button type="button" variant="secondary" className="w-full" onClick={signInWithGoogle}>
          Continue with Google
        </Button>

        <p className="mt-5 text-center text-sm text-slate-500">
          <Link href="/forgot-password" className="text-blue-600 hover:underline">
            Forgot your password?
          </Link>
        </p>
        <p className="mt-1 text-center text-sm text-slate-500">
          No account?{' '}
          <Link href="/register" className="text-blue-600 hover:underline">
            Create one
          </Link>
        </p>
        <p className="mt-6 text-center text-xs text-slate-500">
          New here?{' '}
          <Link href="/how-it-works" className="text-blue-600 hover:underline">
            See how it works
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
