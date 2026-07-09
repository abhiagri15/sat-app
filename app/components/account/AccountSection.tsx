'use client';

// Account management UI rendered at the bottom of /dashboard: a data export
// button and a two-step "Delete my account" flow.
//
// Deletion is a client FSM: the first click reveals a confirm panel that
// explains permanence and requires typing DELETE before the danger button
// submits the `deleteAccount` server action. On success the action redirects
// (to /login); on failure it returns an error shape we surface inline.
import { useState, useTransition } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { deleteAccount } from '@/app/lib/account/actions';

const CONFIRM_WORD = 'DELETE';

export function AccountSection() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount();
      // A success path redirects and never returns; only failures land here.
      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <section className="mt-12 border-t border-slate-200 pt-8">
      <h2 className="text-sm font-semibold text-slate-500">Account</h2>

      <div className="mt-4 space-y-6">
        {/* Data export */}
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-medium text-slate-900">Download my data</h3>
          <p className="mt-1 text-sm text-slate-600">
            Export your profile, test attempts, practice sessions, and study
            plan as a JSON file.
          </p>
          <a
            href="/api/account/export"
            className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Download my data
          </a>
        </div>

        {/* Account deletion */}
        <div className="rounded-lg border border-red-200 bg-red-50/40 p-4">
          <h3 className="text-sm font-medium text-slate-900">Delete my account</h3>
          <p className="mt-1 text-sm text-slate-600">
            Permanently delete your account and all of your test and practice
            history.
          </p>

          {!confirming ? (
            <Button
              type="button"
              variant="destructive"
              className="mt-3"
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              Delete my account
            </Button>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-700">
                This <span className="font-semibold">cannot be undone</span>.
                Your account, test attempts, practice sessions, study plan, and
                coaching history will be permanently deleted. To confirm, type{' '}
                <span className="font-mono font-semibold">{CONFIRM_WORD}</span>{' '}
                below.
              </p>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={CONFIRM_WORD}
                aria-label={`Type ${CONFIRM_WORD} to confirm`}
                autoComplete="off"
                disabled={isPending}
              />
              {error && (
                <p className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={typed !== CONFIRM_WORD || isPending}
                  onClick={onDelete}
                >
                  {isPending ? 'Deleting…' : 'Permanently delete'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    setConfirming(false);
                    setTyped('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
