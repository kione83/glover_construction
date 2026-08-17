const INCHES_PER_METER = 39.37007874015748;
const MILLIMETERS_PER_METER = 1000;
const METERS_PER_FOOT = 0.3048;
const QUARTER_INCHES_PER_INCH = 4;

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
