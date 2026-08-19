import { createReportGate } from '@uno/shared';
import { gaAddError, track, type GaSeverity } from './analytics';

// One gate per page load: a looping bug reports each unique error once and
// at most 10 errors per session (see shared/src/reportGate.ts).
const allow = createReportGate(10);

// GameAnalytics caps error messages at 8192 chars — enough for a stack trace.
const GA_MESSAGE_LIMIT = 8192;

/** Report an unexpected client-side error to both analytics services.
 *  Deduped by kind+message and capped per session; always leaves a
 *  console.warn trail so local debugging works even with analytics off. */
export function reportError(kind: string, err: unknown, severity: GaSeverity = 'error'): void {
  try {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[error-report] ${kind}:`, err);
    if (!allow(`${kind}:${msg}`.slice(0, 200))) return;
    track('client_error', { kind });
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
    gaAddError(severity, `${kind}: ${msg}${stack}`.slice(0, GA_MESSAGE_LIMIT));
  } catch {
    // Error reporting must never break the game.
  }
}

/** Catch everything nobody else caught: uncaught exceptions and unhandled
 *  promise rejections. Before this, a crashed render was a silent blank
 *  screen with no trace anywhere. */
export function initErrorReporting(): void {
  window.addEventListener('error', (e) => {
    reportError('window_onerror', e.error ?? e.message, 'critical');
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportError('unhandled_rejection', e.reason, 'error');
  });
}
