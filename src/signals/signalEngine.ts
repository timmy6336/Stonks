import type { Candle, Signal, SignalScore } from '../types';
import { sma, rsi, macd, isVolumeSpike } from '../indicators/indicators';

/**
 * Rule-based, fully transparent signal: every point added/subtracted comes with
 * a human-readable reason so a user can see exactly why a symbol scored the way it did.
 */
export function computeSignal(symbol: string, candles: Candle[]): Signal {
  const reasons: string[] = [];
  let points = 0;

  if (candles.length < 60) {
    return {
      symbol,
      score: 'HOLD',
      points: 0,
      reasons: ['Not enough price history yet to compute a reliable signal (need 60+ days).'],
      computedAt: Date.now(),
    };
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = closes.length - 1;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  if (sma20[last] !== undefined && sma50[last] !== undefined) {
    const prevFast = sma20[last - 1];
    const prevSlow = sma50[last - 1];
    const bullishCross = prevFast !== undefined && prevSlow !== undefined && prevFast <= prevSlow && sma20[last]! > sma50[last]!;
    const bearishCross = prevFast !== undefined && prevSlow !== undefined && prevFast >= prevSlow && sma20[last]! < sma50[last]!;
    if (bullishCross) {
      points += 2;
      reasons.push('Golden cross: 20-day average just crossed above the 50-day average.');
    } else if (bearishCross) {
      points -= 2;
      reasons.push('Death cross: 20-day average just crossed below the 50-day average.');
    } else if (sma20[last]! > sma50[last]!) {
      points += 1;
      reasons.push('20-day average is above the 50-day average (uptrend).');
    } else {
      points -= 1;
      reasons.push('20-day average is below the 50-day average (downtrend).');
    }
  }

  const rsiValues = rsi(closes, 14);
  const latestRsi = rsiValues[last];
  if (latestRsi !== undefined) {
    if (latestRsi < 30) {
      points += 2;
      reasons.push(`RSI is ${latestRsi.toFixed(0)} (oversold), often a bounce setup.`);
    } else if (latestRsi > 70) {
      points -= 2;
      reasons.push(`RSI is ${latestRsi.toFixed(0)} (overbought), often due for a pullback.`);
    }
  }

  const macdResult = macd(closes);
  const macdLast = macdResult.macd[last];
  const signalLast = macdResult.signal[last];
  const macdPrev = macdResult.macd[last - 1];
  const signalPrev = macdResult.signal[last - 1];
  if (macdLast !== undefined && signalLast !== undefined && macdPrev !== undefined && signalPrev !== undefined) {
    const bullishCross = macdPrev <= signalPrev && macdLast > signalLast;
    const bearishCross = macdPrev >= signalPrev && macdLast < signalLast;
    if (bullishCross) {
      points += 1;
      reasons.push('MACD line just crossed above its signal line (bullish momentum).');
    } else if (bearishCross) {
      points -= 1;
      reasons.push('MACD line just crossed below its signal line (bearish momentum).');
    }
  }

  const volumeSpike = isVolumeSpike(volumes);
  if (volumeSpike) {
    const priceUp = closes[last] > closes[last - 1];
    if (priceUp) {
      points += 1;
      reasons.push('Volume spike on an up day, confirming buying interest.');
    } else {
      points -= 1;
      reasons.push('Volume spike on a down day, confirming selling pressure.');
    }
  }

  if (reasons.length === 0) {
    reasons.push('No strong signals either way right now.');
  }

  return {
    symbol,
    score: scoreFromPoints(points),
    points,
    reasons,
    computedAt: Date.now(),
  };
}

function scoreFromPoints(points: number): SignalScore {
  if (points >= 4) return 'STRONG_BUY';
  if (points >= 2) return 'BUY';
  if (points <= -4) return 'STRONG_SELL';
  if (points <= -2) return 'SELL';
  return 'HOLD';
}
