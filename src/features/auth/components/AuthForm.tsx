'use client';

import { useActionState } from 'react';
import type { ActionState } from '../actions';

type Props = {
  readonly action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  readonly submitLabel: string;
  readonly children: React.ReactNode;
};

const initialState: ActionState = { status: 'idle' };

export function AuthForm({ action, submitLabel, children }: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {children}

      {state.status === 'error' && (
        <p role="alert" className="text-incorrect text-sm">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p role="status" className="text-correct text-sm">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-brand text-brand-fg w-full rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? 'Gönderiliyor…' : submitLabel}
      </button>
    </form>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  required = true,
  hint,
}: {
  readonly label: string;
  readonly name: string;
  readonly type?: string;
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly hint?: string;
}) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="text-ink block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete ?? ''}
        aria-describedby={hintId ?? ''}
        className="border-border bg-background text-foreground mt-1 w-full rounded-md border px-3 py-2 text-sm"
      />
      {hint && (
        <p id={hintId} className="text-muted mt-1 text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
