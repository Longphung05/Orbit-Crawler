// "Reset everything to zero": a quick, two-step wipe for cleaning and testing. Local data only;
// nothing on Instagram is touched.
import { useState } from 'preact/hooks';
import { getDb } from '../db/db';
import { resetAllData } from '../db/reset';

type Step = 'idle' | 'confirm' | 'working' | 'done' | 'error';

export function ResetButton() {
  const [step, setStep] = useState<Step>('idle');

  async function erase(): Promise<void> {
    setStep('working');
    try {
      await resetAllData(getDb());
      // Open Instagram tabs should drop their badges and cached answers.
      browser.runtime.sendMessage({ type: 'orbit/graph-changed' }).catch(() => undefined);
      setStep('done');
      setTimeout(() => setStep('idle'), 3000);
    } catch (err) {
      console.warn('[orbit] reset failed', err);
      setStep('error');
    }
  }

  if (step === 'confirm' || step === 'working') {
    return (
      <div class="space-y-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">
        <p>
          Erase every account, connection, setting and log Orbit has stored on this computer? Your
          Instagram account is not touched.
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            disabled={step === 'working'}
            class="rounded bg-red-600 px-2 py-1 font-medium text-white disabled:opacity-50"
            onClick={() => void erase()}
          >
            {step === 'working' ? 'Erasing…' : 'Erase everything'}
          </button>
          <button
            type="button"
            disabled={step === 'working'}
            class="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700"
            onClick={() => setStep('idle')}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div class="space-y-1">
      <button
        type="button"
        class="w-full rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        onClick={() => setStep('confirm')}
      >
        Reset all data
      </button>
      {step === 'done' && <p class="text-xs text-emerald-700">Everything was erased.</p>}
      {step === 'error' && (
        <p class="text-xs text-red-700">Could not erase everything. Try once more.</p>
      )}
    </div>
  );
}
