/* ============================================================
   AppLockPinCard — the account's app-lock PIN, managed from Settings.

   The PIN is not a second login: the session already decided who you are.
   It is what stops a handed-over phone from opening the app's messages and
   receipts, so this card is about the app you carry, not about the web
   session. The server owns every rule (4 digits, no 1234/0000, five wrong
   attempts lock it for 15 minutes) and answers a wrong PIN with 400 — never
   401 — so the client must switch on `err.code`, not on any status code.
   ============================================================ */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, KeyRound, Loader2, Lock, ShieldOff, Smartphone } from 'lucide-react';
import clsx from 'clsx';
import { auth as authApi } from '@/api/client.js';
import { FField, Toast, iCls } from './SettingsPrimitives.jsx';

const PIN_LENGTH = 4;

function PinInput({ value, onChange, autoFocus, placeholder = '••••' }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={PIN_LENGTH}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
      className={clsx(iCls(), 'tracking-[0.4em] font-semibold')}
    />
  );
}

export default function AppLockPinCard() {
  const qc = useQueryClient();
  const [mode, setMode] = useState(null); // null | 'set' | 'change' | 'off'
  const [form, setForm] = useState({ currentPin: '', pin: '', confirm: '' });
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);

  const statusQuery = useQuery({
    queryKey: ['auth', 'pin'],
    queryFn: () => authApi.pin.status(),
    staleTime: 30_000,
  });
  const status = statusQuery.data?.data ?? null;
  const enabled = Boolean(status?.enabled);
  const lockedFor = status?.lockedForMinutes ?? 0;

  function reset(nextMode = null) {
    setMode(nextMode);
    setForm({ currentPin: '', pin: '', confirm: '' });
    setError('');
  }

  function run() {
    /* Turning the lock off has no new PIN to pick — it only asks for the
       current one, so it must not be held to the choose/confirm rules. */
    if (mode === 'off') {
      if (form.currentPin.length !== PIN_LENGTH) { setError('Enter your current PIN.'); return; }
      setError('');
      saveOff();
      return;
    }
    if (form.pin.length !== PIN_LENGTH) { setError(`Choose ${PIN_LENGTH} digits.`); return; }
    if (form.pin !== form.confirm) { setError('Those two PINs do not match.'); return; }
    if (enabled && mode !== 'set' && form.currentPin.length !== PIN_LENGTH) {
      setError('Enter your current PIN.');
      return;
    }
    setError('');
    savePin();
  }

  const { mutate: savePin, isPending: saving } = useMutation({
    mutationFn: () => authApi.pin.set(
      enabled && mode !== 'set'
        ? { pin: form.pin, currentPin: form.currentPin }
        : { pin: form.pin },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'pin'] });
      reset(null);
      setToast({ msg: enabled ? 'PIN changed.' : 'App lock is on.', type: 'success' });
    },
    onError: err => {
      /* A wrong attempt is counted server-side, so the status has to be re-read
         or the "attempts left" hint keeps claiming the old number. Same for a
         423 lock, which the banner above renders from that fresh status. */
      qc.invalidateQueries({ queryKey: ['auth', 'pin'] });
      setError(err?.message ?? 'Could not save that PIN.');
    },
  });

  const { mutate: saveOff, isPending: turningOff } = useMutation({
    mutationFn: () => authApi.pin.remove({ pin: form.currentPin }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'pin'] });
      reset(null);
      setToast({ msg: 'App lock is off.', type: 'success' });
    },
    onError: err => {
      qc.invalidateQueries({ queryKey: ['auth', 'pin'] });
      setError(err?.message ?? 'Could not turn the PIN off.');
    },
  });

  const { mutate: forgot, isPending: forgetting } = useMutation({
    mutationFn: () => authApi.pin.forgot(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'pin'] });
      reset(null);
      setToast({ msg: 'PIN removed. Set a new one whenever you like.', type: 'success' });
    },
    onError: err => {
      qc.invalidateQueries({ queryKey: ['auth', 'pin'] });
      setError(err?.message ?? 'Could not remove the PIN.');
    },
  });

  const busy = saving || turningOff || forgetting;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="h-6 flex items-center">
        <AnimatePresenceProxy toast={toast} onDismiss={() => setToast(null)} />
      </div>

      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <Smartphone size={14} className="text-slate-400" />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">App Lock PIN</h3>
        <span className={clsx(
          'ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
          enabled
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            : 'bg-slate-50 text-slate-500 ring-slate-200',
        )}>
          {enabled ? 'On' : 'Off'}
        </span>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        A {PIN_LENGTH}-digit code, asked for when the app is opened on a phone. It keeps
        message previews and receipts out of sight if the phone is handed to someone else —
        it never replaces signing in.
      </p>

      {/* The server tells us how many tries are left before the 15-minute lock,
          so a wrong tap is not a surprise — and while locked it says so instead. */}
      {enabled && lockedFor === 0 && typeof status?.attemptsRemaining === 'number' && (
        <p className={clsx(
          'text-[11px]',
          status.attemptsRemaining <= 2 ? 'font-semibold text-amber-600' : 'text-slate-400',
        )}>
          {status.attemptsRemaining} of 5 attempts left
          {status.attemptsRemaining <= 2 ? ' before the PIN pauses for 15 minutes.' : '.'}
        </p>
      )}

      {lockedFor > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded-lg">
          <Lock size={13} className="mt-0.5 shrink-0" />
          Too many wrong PINs — the lock is paused for about {lockedFor} minute{lockedFor === 1 ? '' : 's'}.
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}
        </div>
      )}

      {mode === null ? (
        <div className="flex flex-wrap items-center gap-2">
          {enabled ? (
            <>
              <button
                type="button"
                onClick={() => reset('change')}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                <KeyRound size={13} /> Change PIN
              </button>
              <button
                type="button"
                onClick={() => reset('off')}
                className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                <ShieldOff size={13} /> Turn off
              </button>
              <button
                type="button"
                onClick={() => forgot()}
                disabled={busy}
                className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 disabled:opacity-50"
              >
                Forgot your PIN?
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => reset('set')}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              <KeyRound size={13} /> Set a PIN
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {enabled && mode !== 'set' && (
            <FField label="Current PIN">
              <PinInput
                autoFocus
                value={form.currentPin}
                onChange={v => { setForm(f => ({ ...f, currentPin: v })); setError(''); }}
              />
            </FField>
          )}

          {mode !== 'off' && (
            <>
              <FField label={mode === 'change' ? 'New PIN' : 'Choose a PIN'}>
                <PinInput
                  autoFocus={!enabled || mode === 'set'}
                  value={form.pin}
                  onChange={v => { setForm(f => ({ ...f, pin: v })); setError(''); }}
                />
              </FField>
              <FField label="Confirm PIN">
                <PinInput
                  value={form.confirm}
                  onChange={v => { setForm(f => ({ ...f, confirm: v })); setError(''); }}
                />
              </FField>
            </>
          )}

          {mode === 'off' && (
            <p className="text-xs text-slate-500">
              Turning the lock off allows the app to open without a code. You can set a new
              PIN at any time.
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              {busy
                ? <Loader2 size={13} className="animate-spin" />
                : mode === 'off' ? <ShieldOff size={13} /> : <Check size={13} />}
              {busy
                ? 'Working…'
                : mode === 'off' ? 'Turn off' : mode === 'change' ? 'Save new PIN' : 'Save PIN'}
            </button>
            <button
              type="button"
              onClick={() => reset(null)}
              disabled={busy}
              className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg transition disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* The tab keeps its own <AnimatePresence> wrapper; this thin indirection
   keeps the card self-contained without importing motion here. */
function AnimatePresenceProxy({ toast, onDismiss }) {
  if (!toast) return null;
  return <Toast msg={toast.msg} type={toast.type} onDismiss={onDismiss} />;
}
