declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, unknown>) => void };
  }
}

const env = import.meta.env;
const UMAMI_ID = env.VITE_UMAMI_WEBSITE_ID;
const UMAMI_SRC = env.VITE_UMAMI_SRC ?? 'https://cloud.umami.is/script.js';
const GA_KEY = env.VITE_GA_GAME_KEY;
const GA_SECRET = env.VITE_GA_SECRET_KEY;

// Set once the SDK chunk loads; the dynamic import keeps ~50 KB of
// GameAnalytics out of the game bundle when no keys are configured.
let ga: (typeof import('gameanalytics'))['default'] | null = null;

/** Boot whichever external analytics are configured at build time.
 *  Umami (open-source, cookie-less) counts visits/uniques/pageviews on its
 *  own; GameAnalytics tracks sessions itself and receives the design events
 *  sent through track(). With neither configured everything is a no-op. */
export function initAnalytics(): void {
  try {
    if (UMAMI_ID) {
      const s = document.createElement('script');
      s.defer = true;
      s.src = UMAMI_SRC;
      s.dataset.websiteId = UMAMI_ID;
      document.head.appendChild(s);
    }
    if (GA_KEY && GA_SECRET) {
      void import('gameanalytics')
        .then((m) => {
          m.default.initialize(GA_KEY, GA_SECRET);
          ga = m.default;
        })
        .catch(() => undefined);
    }
  } catch {
    // Analytics must never break the game.
  }
}

/** Fan one game event out to every configured service. */
export function track(name: string, data?: Record<string, string | number | boolean>): void {
  try {
    window.umami?.track(name, data);
    ga?.addDesignEvent(`game:${name}`);
  } catch {
    // Analytics must never break the game.
  }
}
