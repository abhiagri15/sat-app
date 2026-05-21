import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            Digital SAT · Practice
          </span>
          <h1 className="mt-3 text-2xl font-semibold">SAT Practice Test</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
