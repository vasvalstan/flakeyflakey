/**
 * Offline, shadow-mode evaluation for visual browser-action predictions.
 *
 * This module deliberately has no browser or network dependencies. Predictions
 * are compared with recorder ground truth; they are never executed.
 */

export const VISUAL_IOU_HIT_THRESHOLD = 0.5;
export const VISUAL_CENTER_HIT_RADIUS_PX = 32;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface NormalizedBoundingBox {
  coordinateSpace: "normalized";
  /** Left edge as a fraction of the viewport width. */
  x: number;
  /** Top edge as a fraction of the viewport height. */
  y: number;
  /** Width as a fraction of the viewport width. */
  width: number;
  /** Height as a fraction of the viewport height. */
  height: number;
}

export interface ViewportBoundingBox {
  coordinateSpace: "viewport";
  /** Left edge in CSS pixels. */
  x: number;
  /** Top edge in CSS pixels. */
  y: number;
  /** Width in CSS pixels. */
  width: number;
  /** Height in CSS pixels. */
  height: number;
  viewport: ViewportSize;
}

export type VisualBoundingBox = NormalizedBoundingBox | ViewportBoundingBox;

export type VisualActionKind =
  | "assertion"
  | "check"
  | "click"
  | "fill"
  | "hover"
  | "navigate"
  | "press"
  | "scroll"
  | "select";

export interface VisualScreenshotReferences {
  before: string;
  after: string;
}

export interface VisualGroundTruthCase {
  caseId: string;
  sessionId: string;
  actionId: string;
  intent: string;
  actionKind: VisualActionKind;
  targetSemanticLabel: string;
  targetBox: VisualBoundingBox;
  viewport: ViewportSize;
  screenshots: VisualScreenshotReferences;
}

export interface VisualPrediction {
  actionKind: VisualActionKind | null;
  targetBox?: VisualBoundingBox | null;
  confidence: number;
  abstained: boolean;
  /**
   * True when the proposed action would violate the evaluator's safety policy.
   * The evaluator records the proposal but never executes it.
   */
  unsafeAction: boolean;
}

export interface VisualCaseResult {
  caseId: string;
  sessionId: string;
  actionId: string;
  shadowMode: true;
  exactActionKindMatch: boolean;
  boxComparable: boolean;
  iou: number | null;
  iouAtLeast50: boolean;
  normalizedCenterDistance: number | null;
  centerDistancePx: number | null;
  centerWithin32Px: boolean;
  abstained: boolean;
  unsafeAction: boolean;
  confidence: number;
}

export interface VisualEvaluationReport {
  shadowMode: true;
  totalCases: number;
  exactActionKindMatchCount: number;
  exactActionKindMatchRate: number;
  boxComparableCases: number;
  meanIou: number;
  iouAtLeast50Count: number;
  iouAtLeast50Rate: number;
  centerWithin32PxCount: number;
  centerWithin32PxRate: number;
  abstentionCount: number;
  abstentionRate: number;
  unsafeActionCount: number;
  unsafeActionRate: number;
  results: VisualCaseResult[];
}

interface NormalizedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function isValidViewport(viewport: ViewportSize): boolean {
  return isFiniteNumber(viewport.width)
    && isFiniteNumber(viewport.height)
    && viewport.width > 0
    && viewport.height > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toNormalizedRect(box: VisualBoundingBox | null | undefined): NormalizedRect | null {
  if (!box
    || !isFiniteNumber(box.x)
    || !isFiniteNumber(box.y)
    || !isFiniteNumber(box.width)
    || !isFiniteNumber(box.height)
    || box.width <= 0
    || box.height <= 0) {
    return null;
  }

  let left = box.x;
  let top = box.y;
  let right = box.x + box.width;
  let bottom = box.y + box.height;

  if (box.coordinateSpace === "viewport") {
    if (!isValidViewport(box.viewport)) {
      return null;
    }
    left /= box.viewport.width;
    right /= box.viewport.width;
    top /= box.viewport.height;
    bottom /= box.viewport.height;
  }

  left = clamp(left, 0, 1);
  top = clamp(top, 0, 1);
  right = clamp(right, 0, 1);
  bottom = clamp(bottom, 0, 1);

  if (right <= left || bottom <= top) {
    return null;
  }

  return { bottom, left, right, top };
}

function safeRate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function safeConfidence(confidence: number): number {
  return isFiniteNumber(confidence) ? clamp(confidence, 0, 1) : 0;
}

/**
 * Calculates intersection-over-union after normalizing and clipping both boxes
 * to their viewports. Invalid, missing, zero-area, or non-overlapping boxes
 * return 0 rather than NaN.
 */
export function boxIoU(
  first: VisualBoundingBox | null | undefined,
  second: VisualBoundingBox | null | undefined,
): number {
  const firstRect = toNormalizedRect(first);
  const secondRect = toNormalizedRect(second);
  if (!firstRect || !secondRect) {
    return 0;
  }

  const intersectionWidth = Math.max(
    0,
    Math.min(firstRect.right, secondRect.right) - Math.max(firstRect.left, secondRect.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(firstRect.bottom, secondRect.bottom) - Math.max(firstRect.top, secondRect.top),
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const firstArea = (firstRect.right - firstRect.left) * (firstRect.bottom - firstRect.top);
  const secondArea = (secondRect.right - secondRect.left) * (secondRect.bottom - secondRect.top);
  const unionArea = firstArea + secondArea - intersectionArea;

  if (!isFiniteNumber(unionArea) || unionArea <= 0) {
    return 0;
  }
  return clamp(intersectionArea / unionArea, 0, 1);
}

/**
 * Returns Euclidean distance between box centers in normalized viewport units.
 * Returns null when either box cannot be compared.
 */
export function normalizedCenterDistance(
  first: VisualBoundingBox | null | undefined,
  second: VisualBoundingBox | null | undefined,
): number | null {
  const firstRect = toNormalizedRect(first);
  const secondRect = toNormalizedRect(second);
  if (!firstRect || !secondRect) {
    return null;
  }

  const firstCenterX = (firstRect.left + firstRect.right) / 2;
  const firstCenterY = (firstRect.top + firstRect.bottom) / 2;
  const secondCenterX = (secondRect.left + secondRect.right) / 2;
  const secondCenterY = (secondRect.top + secondRect.bottom) / 2;
  const distance = Math.hypot(secondCenterX - firstCenterX, secondCenterY - firstCenterY);
  return isFiniteNumber(distance) ? distance : null;
}

function centerDistanceInViewportPixels(
  first: VisualBoundingBox,
  second: VisualBoundingBox,
  viewport: ViewportSize,
): number | null {
  if (!isValidViewport(viewport)) {
    return null;
  }

  const firstRect = toNormalizedRect(first);
  const secondRect = toNormalizedRect(second);
  if (!firstRect || !secondRect) {
    return null;
  }

  const deltaX = (
    (secondRect.left + secondRect.right) / 2
    - (firstRect.left + firstRect.right) / 2
  ) * viewport.width;
  const deltaY = (
    (secondRect.top + secondRect.bottom) / 2
    - (firstRect.top + firstRect.bottom) / 2
  ) * viewport.height;
  const distance = Math.hypot(deltaX, deltaY);
  return isFiniteNumber(distance) ? distance : null;
}

/**
 * Scores one prediction against recorder ground truth without executing it.
 */
export function evaluateVisualPrediction(
  groundTruth: VisualGroundTruthCase,
  prediction: VisualPrediction,
): VisualCaseResult {
  const predictionBox = prediction.targetBox ?? null;
  const boxComparable = !prediction.abstained
    && toNormalizedRect(groundTruth.targetBox) !== null
    && toNormalizedRect(predictionBox) !== null;
  const iou = boxComparable ? boxIoU(groundTruth.targetBox, predictionBox) : null;
  const centerDistance = boxComparable
    ? normalizedCenterDistance(groundTruth.targetBox, predictionBox)
    : null;
  const centerDistancePx = boxComparable && predictionBox
    ? centerDistanceInViewportPixels(groundTruth.targetBox, predictionBox, groundTruth.viewport)
    : null;

  return {
    abstained: prediction.abstained,
    actionId: groundTruth.actionId,
    boxComparable,
    caseId: groundTruth.caseId,
    centerDistancePx,
    centerWithin32Px: centerDistancePx !== null && centerDistancePx <= VISUAL_CENTER_HIT_RADIUS_PX,
    confidence: safeConfidence(prediction.confidence),
    exactActionKindMatch: !prediction.abstained
      && prediction.actionKind === groundTruth.actionKind,
    iou,
    iouAtLeast50: iou !== null && iou >= VISUAL_IOU_HIT_THRESHOLD,
    normalizedCenterDistance: centerDistance,
    sessionId: groundTruth.sessionId,
    shadowMode: true,
    unsafeAction: prediction.unsafeAction,
  };
}

/**
 * Produces stable aggregate metrics. Rates with no eligible cases are 0, and
 * all numeric fields are guaranteed to be finite.
 */
export function summarizeVisualEvaluation(
  results: readonly VisualCaseResult[],
): VisualEvaluationReport {
  const totalCases = results.length;
  const exactActionKindMatchCount = results.filter((result) => result.exactActionKindMatch).length;
  const comparableResults = results.filter(
    (result): result is VisualCaseResult & { iou: number } => result.boxComparable && result.iou !== null,
  );
  const iouAtLeast50Count = comparableResults.filter((result) => result.iouAtLeast50).length;
  const centerWithin32PxCount = comparableResults.filter((result) => result.centerWithin32Px).length;
  const abstentionCount = results.filter((result) => result.abstained).length;
  const unsafeActionCount = results.filter((result) => result.unsafeAction).length;
  const iouTotal = comparableResults.reduce((total, result) => total + result.iou, 0);

  return {
    abstentionCount,
    abstentionRate: safeRate(abstentionCount, totalCases),
    boxComparableCases: comparableResults.length,
    centerWithin32PxCount,
    centerWithin32PxRate: safeRate(centerWithin32PxCount, comparableResults.length),
    exactActionKindMatchCount,
    exactActionKindMatchRate: safeRate(exactActionKindMatchCount, totalCases),
    iouAtLeast50Count,
    iouAtLeast50Rate: safeRate(iouAtLeast50Count, comparableResults.length),
    meanIou: safeRate(iouTotal, comparableResults.length),
    results: [...results],
    shadowMode: true,
    totalCases,
    unsafeActionCount,
    unsafeActionRate: safeRate(unsafeActionCount, totalCases),
  };
}
