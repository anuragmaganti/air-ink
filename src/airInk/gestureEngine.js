export const GESTURE_MODE = Object.freeze({
  NO_HAND: "no-hand",
  NEEDS_RELEASE: "needs-release",
  READY: "ready",
  DRAWING: "drawing",
});

export const GESTURE_ACTION = Object.freeze({
  NONE: "none",
  START: "start",
  MOVE: "move",
  END: "end",
});

export const DEFAULT_GESTURE_CONFIG = Object.freeze({
  pinchStartRatio: 0.2,
  pinchReleaseRatio: 0.32,
});

const LANDMARK = Object.freeze({
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  PINKY_MCP: 17,
});

const MIN_HAND_SCALE = 0.0001;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isLandmark(point) {
  return (
    point != null &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (point.z == null || Number.isFinite(point.z))
  );
}

export function getLandmarkDistance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);

  return Math.hypot(dx, dy, dz);
}

function calculatePinchRatio(source) {
  if (!Array.isArray(source) || source.length < 21) return null;

  const thumbTip = source[LANDMARK.THUMB_TIP];
  const indexTip = source[LANDMARK.INDEX_TIP];
  const wrist = source[LANDMARK.WRIST];
  const indexMcp = source[LANDMARK.INDEX_MCP];
  const middleMcp = source[LANDMARK.MIDDLE_MCP];
  const pinkyMcp = source[LANDMARK.PINKY_MCP];

  if (
    ![thumbTip, indexTip, wrist, indexMcp, middleMcp, pinkyMcp].every(
      isLandmark,
    )
  ) {
    return null;
  }

  const pinchDistance = getLandmarkDistance3D(thumbTip, indexTip);
  const palmWidth = getLandmarkDistance3D(indexMcp, pinkyMcp);
  const palmLength = getLandmarkDistance3D(wrist, middleMcp);
  const handScale = (palmWidth + palmLength) / 2;

  if (!Number.isFinite(handScale) || handScale < MIN_HAND_SCALE) return null;

  return pinchDistance / handScale;
}

export function getPinchRatio(landmarks, worldLandmarks) {
  return calculatePinchRatio(worldLandmarks) ?? calculatePinchRatio(landmarks);
}

export function getPointerPoint(landmarks) {
  const indexTip = landmarks?.[LANDMARK.INDEX_TIP];
  if (!isLandmark(indexTip)) return null;

  return {
    x: clamp(1 - indexTip.x, 0, 1),
    y: clamp(indexTip.y, 0, 1),
  };
}

export function createGestureState(mode = GESTURE_MODE.NO_HAND) {
  return { mode };
}

export function requireGestureRelease() {
  return createGestureState(GESTURE_MODE.NEEDS_RELEASE);
}

export function advanceGesture(
  state,
  observation,
  config = DEFAULT_GESTURE_CONFIG,
) {
  const wasDrawing = state.mode === GESTURE_MODE.DRAWING;
  const hasUsableHand =
    observation.hasHand && Number.isFinite(observation.pinchRatio);

  if (!hasUsableHand) {
    return {
      state: createGestureState(GESTURE_MODE.NO_HAND),
      action: wasDrawing ? GESTURE_ACTION.END : GESTURE_ACTION.NONE,
    };
  }

  const { pinchRatio } = observation;

  switch (state.mode) {
    case GESTURE_MODE.NO_HAND:
      return {
        state: createGestureState(
          pinchRatio >= config.pinchReleaseRatio
            ? GESTURE_MODE.READY
            : GESTURE_MODE.NEEDS_RELEASE,
        ),
        action: GESTURE_ACTION.NONE,
      };

    case GESTURE_MODE.NEEDS_RELEASE:
      return {
        state: createGestureState(
          pinchRatio >= config.pinchReleaseRatio
            ? GESTURE_MODE.READY
            : GESTURE_MODE.NEEDS_RELEASE,
        ),
        action: GESTURE_ACTION.NONE,
      };

    case GESTURE_MODE.READY:
      if (pinchRatio <= config.pinchStartRatio) {
        return {
          state: createGestureState(GESTURE_MODE.DRAWING),
          action: GESTURE_ACTION.START,
        };
      }

      return { state, action: GESTURE_ACTION.NONE };

    case GESTURE_MODE.DRAWING:
      if (pinchRatio >= config.pinchReleaseRatio) {
        return {
          state: createGestureState(GESTURE_MODE.READY),
          action: GESTURE_ACTION.END,
        };
      }

      return { state, action: GESTURE_ACTION.MOVE };

    default:
      return {
        state: createGestureState(GESTURE_MODE.NO_HAND),
        action: wasDrawing ? GESTURE_ACTION.END : GESTURE_ACTION.NONE,
      };
  }
}

function smoothingFactor(cutoff, elapsedSeconds) {
  const timeConstant = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + timeConstant / elapsedSeconds);
}

function lowPass(previous, next, alpha) {
  return previous + alpha * (next - previous);
}

export class OneEuroPointFilter {
  constructor({ minCutoff = 3.5, beta = 1.2, derivativeCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.reset();
  }

  reset() {
    this.previousRaw = null;
    this.previousFiltered = null;
    this.previousDerivative = { x: 0, y: 0 };
    this.previousTimestamp = null;
  }

  filter(point, timestamp) {
    if (
      this.previousRaw == null ||
      this.previousFiltered == null ||
      this.previousTimestamp == null
    ) {
      this.previousRaw = point;
      this.previousFiltered = point;
      this.previousTimestamp = timestamp;
      return point;
    }

    const measuredElapsed = (timestamp - this.previousTimestamp) / 1000;
    const elapsedSeconds =
      Number.isFinite(measuredElapsed) && measuredElapsed > 0
        ? clamp(measuredElapsed, 1 / 120, 0.1)
        : 1 / 60;
    const rawDerivative = {
      x: (point.x - this.previousRaw.x) / elapsedSeconds,
      y: (point.y - this.previousRaw.y) / elapsedSeconds,
    };
    const derivativeAlpha = smoothingFactor(
      this.derivativeCutoff,
      elapsedSeconds,
    );
    const derivative = {
      x: lowPass(
        this.previousDerivative.x,
        rawDerivative.x,
        derivativeAlpha,
      ),
      y: lowPass(
        this.previousDerivative.y,
        rawDerivative.y,
        derivativeAlpha,
      ),
    };
    const speed = Math.hypot(derivative.x, derivative.y);
    const positionAlpha = smoothingFactor(
      this.minCutoff + this.beta * speed,
      elapsedSeconds,
    );
    const filtered = {
      x: lowPass(this.previousFiltered.x, point.x, positionAlpha),
      y: lowPass(this.previousFiltered.y, point.y, positionAlpha),
    };

    this.previousRaw = point;
    this.previousFiltered = filtered;
    this.previousDerivative = derivative;
    this.previousTimestamp = timestamp;

    return filtered;
  }
}
