/** Gate for client-side error reporting: dedupes repeated errors and caps
 *  the total per session, so a looping bug cannot flood the analytics
 *  quota (GameAnalytics allows ~500 events per user per day). */
export function createReportGate(limit = 10): (key: string) => boolean {
  const seen = new Set<string>();
  let sent = 0;
  return (key: string): boolean => {
    if (seen.has(key) || sent >= limit) return false;
    seen.add(key);
    sent += 1;
    return true;
  };
}
