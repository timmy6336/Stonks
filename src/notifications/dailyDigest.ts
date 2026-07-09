import * as Notifications from 'expo-notifications';
import { getAppStateValue, getWatchlist, setAppStateValue } from '../db/database';
import { fetchQuote } from '../api/marketData';

const DIGEST_KEY = 'last_digest_date';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sends a once-per-calendar-day summary of watchlist movers. Only fires while the app is open
 * (there's no backend to push it while closed), and only if notification permission was already
 * granted — it never prompts, since alert creation is the flow that asks for permission.
 */
export async function maybeSendDailyDigest(): Promise<void> {
  const today = todayKey();
  if ((await getAppStateValue(DIGEST_KEY)) === today) return;

  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;

    const watchlist = await getWatchlist();
    if (watchlist.length === 0) return;

    const quotes = await Promise.all(
      watchlist.map(async (item) => {
        try {
          return await fetchQuote(item.symbol);
        } catch {
          return null;
        }
      })
    );
    const valid = quotes.filter((q): q is NonNullable<typeof q> => q !== null);
    if (valid.length === 0) return;

    const biggestMover = valid.reduce((a, b) => (Math.abs(b.changePercent) > Math.abs(a.changePercent) ? b : a));
    const gainers = valid.filter((q) => q.changePercent > 0).length;
    const losers = valid.filter((q) => q.changePercent < 0).length;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your daily stock digest',
        body: `${biggestMover.symbol} is today's big mover (${biggestMover.changePercent >= 0 ? '+' : ''}${biggestMover.changePercent.toFixed(1)}%). Watchlist: ${gainers} up, ${losers} down.`,
      },
      trigger: null,
    });
  } finally {
    await setAppStateValue(DIGEST_KEY, today);
  }
}
