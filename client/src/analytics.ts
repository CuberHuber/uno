// First-party visit beacon: one anonymous ping per page load so the server can
// count unique players. No cookies, no fingerprinting; the id never leaves this
// origin, so no consent banner is needed.
export function trackVisit(): void {
  try {
    const KEY = 'oe:vid';
    let vid = localStorage.getItem(KEY);
    if (!vid) {
      vid = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `v-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
      localStorage.setItem(KEY, vid);
    }
    const body = JSON.stringify({ type: 'visit', vid });
    const blob = new Blob([body], { type: 'application/json' });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/analytics/event', blob))) {
      void fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Analytics must never break the game.
  }
}
