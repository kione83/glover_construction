import { describe, expect, it } from "vitest";

import {
  formatDecimalInches,
  formatMetersAsDecimalQuarterInches,
  metersToFeet,
  metersToInches,
  metersToMillimeters,
  roundInchesToQuarter,
} from "./measurementUnits";

function inchesToMeters(inches: number): number {
  return inches / 39.37007874015748;
}

describe("measurementUnits", () => {
  it("converts meters to inches, feet, and millimeters", () => {
    expect(metersToInches(1)).toBeCloseTo(39.37007874015748, 10);
    expect(metersToFeet(0.9144)).toBeCloseTo(3, 10);
    expect(metersToMillimeters(1.25)).toBeCloseTo(1250, 10);
  });

  it("rounds inches to the nearest quarter inch", () => {
    expect(roundInchesToQuarter(1.124)).toBeCloseTo(1, 10);
    expect(roundInchesToQuarter(1.126)).toBeCloseTo(1.25, 10);
    expect(roundInchesToQuarter(23.374)).toBeCloseTo(23.25, 10);
    expect(roundInchesToQuarter(23.376)).toBeCloseTo(23.5, 10);
  });

  it("formats decimal inches with two decimal places", () => {
    expect(formatDecimalInches(23)).toBe('23.00"');
    expect(formatDecimalInches(23.25)).toBe('23.25"');
    expect(formatDecimalInches(23.5)).toBe('23.50"');
    expect(formatDecimalInches(23.75)).toBe('23.75"');
    expect(formatDecimalInches(24)).toBe('24.00"');
  });

  it("formats measurements as decimal quarter inches only", () => {
    expect(formatMetersAsDecimalQuarterInches(inchesToMeters(23.26))).toBe('23.25"');
    expect(formatMetersAsDecimalQuarterInches(inchesToMeters(23.50))).toBe('23.50"');
    expect(formatMetersAsDecimalQuarterInches(inchesToMeters(23.76))).toBe('23.75"');
    expect(formatMetersAsDecimalQuarterInches(inchesToMeters(11.876))).toBe('12.00"');
  });
});
