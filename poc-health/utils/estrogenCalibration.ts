/**
 * Estrogen estimation from optical brightness decay curves.
 *
 * Physical model:
 *   The LED fades exponentially. Light passes through the cartridge sample.
 *   Estrogen reacts with the reagent, increasing optical absorption over time.
 *   Higher estrogen → faster light absorption → steeper brightness decay.
 *
 *   Measured curve: b(t) = b₀ · exp(−λ · t)
 *   λ = LED_decay + k_assay · [estrogen]
 *
 * Calibration anchors (chosen to span a clinically meaningful follicular range):
 *   λ = 0.051 /s  →   50 pg/ml   (early follicular, very low)
 *   λ = 0.092 /s  →  100 pg/ml   (follicular baseline)
 *   λ = 0.180 /s  →  250 pg/ml   (mid follicular)
 *   λ = 0.300 /s  →  500 pg/ml   (pre-ovulatory peak)
 *
 * Power-law fit: estrogen = SCALE · λ^EXP
 */

const SCALE = 4500;
const EXP   = 1.44;

export interface FitResult {
  lambda: number;      // decay constant in s⁻¹
  r2: number;          // goodness of fit 0–1
  estimatedEstrogen: number; // pg/ml
}

/**
 * Fit an exponential decay to normalised brightness samples.
 * Uses log-linear regression through origin: ln(b/b₀) = −λ·t
 */
export function fitDecay(data: { t: number; b: number }[]): FitResult {
  if (data.length < 3) return { lambda: 0, r2: 0, estimatedEstrogen: 0 };

  const b0 = Math.max(...data.slice(0, Math.max(1, Math.floor(data.length * 0.1))).map(d => d.b), 1);
  const pts = data
    .filter(d => d.b > 0 && d.t > 0)
    .map(d => ({ x: d.t / 1000, y: Math.log(d.b / b0) }));

  if (pts.length < 2) return { lambda: 0, r2: 0, estimatedEstrogen: 0 };

  // OLS through origin
  const num = pts.reduce((s, p) => s + p.x * p.y, 0);
  const den = pts.reduce((s, p) => s + p.x * p.x, 0);
  const lambda = den > 0 ? Math.max(0, -num / den) : 0;

  // R²
  const yMean = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const ssTot = pts.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.y - (-lambda * p.x)) ** 2, 0);
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  return { lambda, r2, estimatedEstrogen: lambdaToEstrogen(lambda) };
}

export function lambdaToEstrogen(lambda: number): number {
  if (lambda <= 0) return 0;
  return Math.round(SCALE * Math.pow(lambda, EXP));
}

export function estrogenToLambda(estrogen: number): number {
  return Math.pow(Math.max(1, estrogen) / SCALE, 1 / EXP);
}

/**
 * Generate the fitted curve (normalised 0–100 %) at the same time points as data.
 */
export function fittedCurve(lambda: number, data: { t: number; b: number }[]): { t: number; b: number }[] {
  return data.map(d => ({
    t: d.t,
    b: Math.max(0, Math.round(100 * Math.exp(-lambda * d.t / 1000))),
  }));
}

/**
 * Recording duration (ms) that makes the LED fade at the rate corresponding to
 * a given estrogen level — used for demo mode.
 * The exponential hits ~1 % of initial brightness at t = duration_s.
 * λ = ln(100) / duration_s, so duration_s = ln(100) / λ.
 */
export function estrogenToRecordDuration(estrogen: number): number {
  const lambda = estrogenToLambda(estrogen);
  const durationS = Math.log(100) / Math.max(0.01, lambda);
  return Math.round(Math.max(2000, Math.min(60000, durationS * 1000)));
}

export interface EstrogenBand {
  label: string;
  color: string;
  description: string;
}

export function estrogenBand(pgml: number): EstrogenBand {
  if (pgml < 50)  return { label: 'Very Low',  color: '#64B5F6', description: 'Early follicular / anovulatory' };
  if (pgml < 150) return { label: 'Normal',    color: '#81C784', description: 'Mid follicular phase' };
  if (pgml < 300) return { label: 'Elevated',  color: '#FFB74D', description: 'Late follicular / rising' };
  if (pgml < 500) return { label: 'High',      color: '#EF6C00', description: 'Pre-ovulatory surge' };
  return              { label: 'Very High',  color: '#C85450', description: 'Ovulation peak' };
}

/** Preset demo estrogen levels with human-readable labels. */
export const DEMO_LEVELS = [
  { estrogen:  50, label: 'Very Low',  desc: 'Early cycle' },
  { estrogen: 100, label: 'Low',       desc: 'Early follicular' },
  { estrogen: 150, label: 'Normal',    desc: 'Mid follicular' },
  { estrogen: 250, label: 'Elevated',  desc: 'Late follicular' },
  { estrogen: 400, label: 'High',      desc: 'Pre-ovulatory' },
  { estrogen: 550, label: 'Very High', desc: 'Ovulation surge' },
] as const;
