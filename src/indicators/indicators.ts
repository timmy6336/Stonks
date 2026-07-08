/** Simple moving average of the last `period` values; undefined until enough data exists. */
export function sma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with an SMA of the first `period` values. */
export function ema(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  const k = 2 / (period + 1);
  let prev: number | undefined;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = seed;
      prev = seed;
      continue;
    }
    const value = values[i] * k + (prev as number) * (1 - k);
    out[i] = value;
    prev = value;
  }
  return out;
}

/** Wilder's RSI over `period` (default 14). */
export function rsi(closes: number[], period = 14): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length).fill(undefined);
  if (closes.length < period + 1) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type MACDResult = {
  macd: (number | undefined)[];
  signal: (number | undefined)[];
  histogram: (number | undefined)[];
};

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: (number | undefined)[] = closes.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== undefined && s !== undefined ? f - s : undefined;
  });

  const macdValues = macdLine.filter((v): v is number => v !== undefined);
  const signalOnValid = ema(macdValues, signalPeriod);
  const firstValidIndex = macdLine.findIndex((v) => v !== undefined);
  const signalLine: (number | undefined)[] = new Array(closes.length).fill(undefined);
  if (firstValidIndex >= 0) {
    for (let i = 0; i < signalOnValid.length; i++) {
      signalLine[firstValidIndex + i] = signalOnValid[i];
    }
  }

  const histogram = macdLine.map((v, i) => {
    const s = signalLine[i];
    return v !== undefined && s !== undefined ? v - s : undefined;
  });

  return { macd: macdLine, signal: signalLine, histogram };
}

/** True if the latest volume exceeds `multiplier`x the average of the prior `period` bars. */
export function isVolumeSpike(volumes: number[], period = 20, multiplier = 2): boolean {
  if (volumes.length < period + 1) return false;
  const priorSlice = volumes.slice(-period - 1, -1);
  const avg = priorSlice.reduce((a, b) => a + b, 0) / priorSlice.length;
  const latest = volumes[volumes.length - 1];
  return avg > 0 && latest >= avg * multiplier;
}
