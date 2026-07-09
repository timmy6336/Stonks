import * as Notifications from 'expo-notifications';
import { getAlertsForSymbol, markAlertTriggered } from '../db/database';
import type { Alert, Quote, Signal } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

function describeAlert(alert: Alert): string {
  switch (alert.type) {
    case 'PRICE_ABOVE':
      return `crossed above $${alert.threshold?.toFixed(2)}`;
    case 'PRICE_BELOW':
      return `dropped below $${alert.threshold?.toFixed(2)}`;
    case 'SIGNAL_BUY_OR_BETTER':
      return 'signal reached BUY or better';
    case 'SIGNAL_STRONG_BUY':
      return 'signal reached STRONG BUY';
  }
}

function alertConditionMet(alert: Alert, quote: Quote, signal: Signal): boolean {
  switch (alert.type) {
    case 'PRICE_ABOVE':
      return alert.threshold != null && quote.price >= alert.threshold;
    case 'PRICE_BELOW':
      return alert.threshold != null && quote.price <= alert.threshold;
    case 'SIGNAL_BUY_OR_BETTER':
      return signal.score === 'BUY' || signal.score === 'STRONG_BUY';
    case 'SIGNAL_STRONG_BUY':
      return signal.score === 'STRONG_BUY';
  }
}

/**
 * Checks a symbol's un-triggered alerts against its latest quote/signal and fires a local
 * notification for any that now match. This only runs while the app is open (foreground or
 * just-opened) — there's no backend, so it can't push a real-time alert while the app is closed.
 */
export async function checkAlertsForSymbol(symbol: string, quote: Quote, signal: Signal): Promise<void> {
  const alerts = await getAlertsForSymbol(symbol);
  const pending = alerts.filter((a) => a.triggeredAt === null);

  for (const alert of pending) {
    if (alertConditionMet(alert, quote, signal)) {
      await markAlertTriggered(alert.id);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${symbol} alert`,
          body: `${symbol} ${describeAlert(alert)} (now $${quote.price.toFixed(2)}).`,
        },
        trigger: null,
      });
    }
  }
}
