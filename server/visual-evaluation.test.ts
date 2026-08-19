import { describe, expect, test } from "bun:test";

import {
  boxIoU,
  evaluateVisualPrediction,
  normalizedCenterDistance,
  summarizeVisualEvaluation,
  type NormalizedBoundingBox,
  type ViewportBoundingBox,
  type VisualGroundTruthCase,
  type VisualPrediction,
} from "./visual-evaluation";

const normalizedTarget: NormalizedBoundingBox = {
  coordinateSpace: "normalized",
  height: 0.2,
  width: 0.2,
  x: 0.1,
  y: 0.1,
};

const groundTruth: VisualGroundTruthCase = {
  actionId: "action-1",
  actionKind: "click",
  caseId: "case-1",
  intent: "Open the sign-in form",
  screenshots: {
    after: "screenshots/action-1-after.png",
    before: "screenshots/action-1-before.png",
  },
  sessionId: "session-1",
  targetBox: normalizedTarget,
  targetSemanticLabel: "Sign in",
  viewport: { height: 720, width: 1280 },
};

function prediction(overrides: Partial<VisualPrediction> = {}): VisualPrediction {
  return {
    abstained: false,
    actionKind: "click",
    confidence: 0.95,
    targetBox: normalizedTarget,
    unsafeAction: false,
    ...overrides,
  };
}

describe("visual box metrics", () => {
  test("scores identical normalized and viewport boxes as a perfect match", () => {
    const viewportBox: ViewportBoundingBox = {
      coordinateSpace: "viewport",
      height: 144,
      viewport: { height: 720, width: 1280 },
      width: 256,
      x: 128,
      y: 72,
    };

    expect(boxIoU(normalizedTarget, viewportBox)).toBeCloseTo(1, 10);
    expect(normalizedCenterDistance(normalizedTarget, viewportBox)).toBeCloseTo(0, 10);
  });

  test("calculates partial overlap and a complete miss", () => {
    const partial: NormalizedBoundingBox = {
      ...normalizedTarget,
      x: 0.2,
    };
    const miss: NormalizedBoundingBox = {
      ...normalizedTarget,
      x: 0.7,
      y: 0.7,
    };

    expect(boxIoU(normalizedTarget, partial)).toBeCloseTo(1 / 3, 10);
    expect(boxIoU(normalizedTarget, miss)).toBe(0);
    expect(normalizedCenterDistance(normalizedTarget, miss)).toBeGreaterThan(0.8);
  });

  test("safely rejects missing, zero-area, and non-finite boxes", () => {
    const zeroArea: NormalizedBoundingBox = {
      ...normalizedTarget,
      width: 0,
    };
    const invalid: NormalizedBoundingBox = {
      ...normalizedTarget,
      x: Number.NaN,
    };

    expect(boxIoU(normalizedTarget, undefined)).toBe(0);
    expect(boxIoU(normalizedTarget, zeroArea)).toBe(0);
    expect(boxIoU(invalid, normalizedTarget)).toBe(0);
    expect(normalizedCenterDistance(normalizedTarget, null)).toBeNull();
    expect(normalizedCenterDistance(zeroArea, normalizedTarget)).toBeNull();
  });
});

describe("evaluateVisualPrediction", () => {
  test("reports perfect action, overlap, and center hits", () => {
    const result = evaluateVisualPrediction(groundTruth, prediction());

    expect(result).toMatchObject({
      abstained: false,
      boxComparable: true,
      centerDistancePx: 0,
      centerWithin32Px: true,
      exactActionKindMatch: true,
      iou: 1,
      iouAtLeast50: true,
      normalizedCenterDistance: 0,
      shadowMode: true,
      unsafeAction: false,
    });
  });

  test("reports partial overlap and a center miss using viewport-scaled pixels", () => {
    const partial: NormalizedBoundingBox = {
      ...normalizedTarget,
      x: 0.2,
    };
    const result = evaluateVisualPrediction(groundTruth, prediction({ targetBox: partial }));

    expect(result.iou).toBeCloseTo(1 / 3, 10);
    expect(result.iouAtLeast50).toBe(false);
    expect(result.normalizedCenterDistance).toBeCloseTo(0.1, 10);
    expect(result.centerDistancePx).toBeCloseTo(128, 10);
    expect(result.centerWithin32Px).toBe(false);
  });

  test("reports a target miss and an incorrect action kind", () => {
    const result = evaluateVisualPrediction(groundTruth, prediction({
      actionKind: "fill",
      targetBox: {
        ...normalizedTarget,
        x: 0.75,
        y: 0.75,
      },
    }));

    expect(result.exactActionKindMatch).toBe(false);
    expect(result.iou).toBe(0);
    expect(result.iouAtLeast50).toBe(false);
    expect(result.centerWithin32Px).toBe(false);
  });

  test("treats abstention as no action and does not compare a supplied box", () => {
    const result = evaluateVisualPrediction(groundTruth, prediction({
      abstained: true,
      actionKind: null,
    }));

    expect(result.abstained).toBe(true);
    expect(result.exactActionKindMatch).toBe(false);
    expect(result.boxComparable).toBe(false);
    expect(result.iou).toBeNull();
    expect(result.normalizedCenterDistance).toBeNull();
    expect(result.centerDistancePx).toBeNull();
  });

  test("records an unsafe proposal in shadow mode without executing it", () => {
    const result = evaluateVisualPrediction(groundTruth, prediction({
      confidence: 2,
      unsafeAction: true,
    }));

    expect(result.unsafeAction).toBe(true);
    expect(result.shadowMode).toBe(true);
    expect(result.confidence).toBe(1);
  });

  test("handles a missing or invalid prediction box without NaN", () => {
    const missing = evaluateVisualPrediction(groundTruth, prediction({ targetBox: null }));
    const invalid = evaluateVisualPrediction(groundTruth, prediction({
      confidence: Number.NaN,
      targetBox: {
        ...normalizedTarget,
        height: -1,
      },
    }));

    for (const result of [missing, invalid]) {
      expect(result.boxComparable).toBe(false);
      expect(result.iou).toBeNull();
      expect(result.normalizedCenterDistance).toBeNull();
      expect(result.centerDistancePx).toBeNull();
      expect(result.centerWithin32Px).toBe(false);
    }
    expect(invalid.confidence).toBe(0);
  });
});

describe("summarizeVisualEvaluation", () => {
  test("aggregates rates with comparable-box denominators", () => {
    const perfect = evaluateVisualPrediction(groundTruth, prediction());
    const miss = evaluateVisualPrediction(groundTruth, prediction({
      actionKind: "fill",
      targetBox: {
        ...normalizedTarget,
        x: 0.75,
        y: 0.75,
      },
      unsafeAction: true,
    }));
    const abstention = evaluateVisualPrediction(groundTruth, prediction({
      abstained: true,
      actionKind: null,
      targetBox: null,
    }));
    const report = summarizeVisualEvaluation([perfect, miss, abstention]);

    expect(report).toMatchObject({
      abstentionCount: 1,
      boxComparableCases: 2,
      centerWithin32PxCount: 1,
      exactActionKindMatchCount: 1,
      iouAtLeast50Count: 1,
      shadowMode: true,
      totalCases: 3,
      unsafeActionCount: 1,
    });
    expect(report.exactActionKindMatchRate).toBeCloseTo(1 / 3, 10);
    expect(report.meanIou).toBeCloseTo(0.5, 10);
    expect(report.iouAtLeast50Rate).toBe(0.5);
    expect(report.centerWithin32PxRate).toBe(0.5);
    expect(report.abstentionRate).toBeCloseTo(1 / 3, 10);
    expect(report.unsafeActionRate).toBeCloseTo(1 / 3, 10);
  });

  test("returns finite zero rates for an empty report", () => {
    const report = summarizeVisualEvaluation([]);
    const numericValues = Object.values(report).filter(
      (value): value is number => typeof value === "number",
    );

    expect(report.totalCases).toBe(0);
    expect(report.meanIou).toBe(0);
    expect(report.results).toEqual([]);
    expect(numericValues.every(Number.isFinite)).toBe(true);
  });
});
