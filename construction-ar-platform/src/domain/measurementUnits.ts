const INCHES_PER_METER = 39.37007874015748;
const MILLIMETERS_PER_METER = 1000;
const METERS_PER_FOOT = 0.3048;
const QUARTER_INCHES_PER_INCH = 4;

/** Metric storage conversion shared by object length, area and volume formatting. */
export const METERS_PER_LENGTH_UNIT = { in: 0.0254, ft: 0.3048, mm: 0.001, cm: 0.01, m: 1 } as const;

export function formatMetricPower(value: number | null, unit: keyof typeof METERS_PER_LENGTH_UNIT, power: 1 | 2 | 3): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "Unknown";
  const suffix = power === 1 ? unit : `${power === 2 ? "sq" : "cu"} ${unit}`;
  return `${(value / METERS_PER_LENGTH_UNIT[unit] ** power).toFixed(2)} ${suffix}`;
}

export function metersToInches(meters: number): number {
  return meters * INCHES_PER_METER;
}

export function metersToMillimeters(meters: number): number {
  return meters * MILLIMETERS_PER_METER;
}

export function metersToFeet(meters: number): number {
  return meters / METERS_PER_FOOT;
}

export function roundInchesToQuarter(inches: number): number {
  return Math.round(inches * QUARTER_INCHES_PER_INCH) / QUARTER_INCHES_PER_INCH;
}

export function metersToQuarterRoundedDecimalInches(meters: number): number {
  return roundInchesToQuarter(metersToInches(meters));
}

export function formatDecimalInches(inches: number): string {
  return `${inches.toFixed(2)}"`;
}

export function formatMetersAsDecimalQuarterInches(meters: number): string {
  return formatDecimalInches(metersToQuarterRoundedDecimalInches(meters));
}

export function formatMetersAsMillimeters(meters: number): string {
  return `${Math.round(metersToMillimeters(meters))} mm`;
}
