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
  pinchStartRatio: 0.3,
  pinchReleaseRatio: 0.46,
  pinchStartHoldMs: 20,
  pinchReleaseHoldMs: 32,
  rearmHoldMs: 40,
  handLossGraceMs: 100,
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
const DEFAULT_FRAME_DURATION_MS = 1000 / 60;

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

export function getLandmarkDistance2D(a, b, aspectRatio = 1) {
  const safeAspectRatio =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const dx = (a.x - b.x) * safeAspectRatio;
  const dy = a.y - b.y;

  return Math.hypot(dx, dy);
}

function calculatePinchRatio(source, distance) {
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

  const pinchDistance = distance(thumbTip, indexTip);
  const palmWidth = distance(indexMcp, pinkyMcp);
  const palmLength = distance(wrist, middleMcp);
  const handScale = (palmWidth + palmLength) / 2;

  if (!Number.isFinite(handScale) || handScale < MIN_HAND_SCALE) return null;

  return pinchDistance / handScale;
}

export function getPinchMetrics(landmarks, worldLandmarks, aspectRatio = 1) {
  const screenRatio = calculatePinchRatio(landmarks, (a, b) =>
    getLandmarkDistance2D(a, b, aspectRatio),
  );
  const worldRatio = calculatePinchRatio(
    worldLandmarks,
    getLandmarkDistance3D,
  );

  return {
    // Screen-space contact matches what the user sees. Monocular world depth is
    // useful telemetry, but is too noisy to gate a binary pinch interaction.
    ratio: screenRatio ?? worldRatio,
    screenRatio,
    worldRatio,
  };
}

export function getPinchRatio(landmarks, worldLandmarks, aspectRatio = 1) {
  return getPinchMetrics(landmarks, worldLandmarks, aspectRatio).ratio;
}

export function getPointerPoint(landmarks) {
  const indexTip = landmarks?.[LANDMARK.INDEX_TIP];
  if (!isLandmark(indexTip)) return null;

  return {
    x: clamp(1 - indexTip.x, 0, 1),
    y: clamp(indexTip.y, 0, 1),
  };
}

export function createGestureState(mode = GESTURE_MODE.NO_HAND, pending = {}) {
  return {
    mode,
    pinchStartedAt: pending.pinchStartedAt ?? null,
    releaseStartedAt: pending.releaseStartedAt ?? null,
    missingStartedAt: pending.missingStartedAt ?? null,
    lastTimestamp: pending.lastTimestamp ?? null,
  };
}

export function requireGestureRelease() {
  return createGestureState(GESTURE_MODE.NEEDS_RELEASE);
}

function getObservationTimestamp(state, observation) {
  if (Number.isFinite(observation.timestamp)) return observation.timestamp;
  return (state.lastTimestamp ?? 0) + DEFAULT_FRAME_DURATION_MS;
}

function hasElapsed(startedAt, timestamp, duration) {
  return Number.isFinite(startedAt) && timestamp - startedAt >= duration;
}

function transition(mode, action, timestamp, pending = {}) {
  return {
    state: createGestureState(mode, { ...pending, lastTimestamp: timestamp }),
    action,
  };
}

export function advanceGesture(
  state,
  observation,
  config = DEFAULT_GESTURE_CONFIG,
) {
  const wasDrawing = state.mode === GESTURE_MODE.DRAWING;
  const timestamp = getObservationTimestamp(state, observation);
  const hasUsableHand =
    observation.hasHand && Number.isFinite(observation.pinchRatio);

  if (!hasUsableHand) {
    if (wasDrawing) {
      const missingStartedAt = state.missingStartedAt ?? timestamp;

      if (
        !hasElapsed(
          missingStartedAt,
          timestamp,
          config.handLossGraceMs,
        )
      ) {
        return transition(
          GESTURE_MODE.DRAWING,
          GESTURE_ACTION.NONE,
          timestamp,
          { missingStartedAt },
        );
      }

      return transition(
        GESTURE_MODE.NO_HAND,
        GESTURE_ACTION.END,
        timestamp,
      );
    }

    return transition(
      GESTURE_MODE.NO_HAND,
      GESTURE_ACTION.NONE,
      timestamp,
    );
  }

  const { pinchRatio } = observation;

  switch (state.mode) {
    case GESTURE_MODE.NO_HAND:
      return transition(
        pinchRatio >= config.pinchReleaseRatio
          ? GESTURE_MODE.READY
          : GESTURE_MODE.NEEDS_RELEASE,
        GESTURE_ACTION.NONE,
        timestamp,
      );

    case GESTURE_MODE.NEEDS_RELEASE: {
      const hasPendingRelease = state.releaseStartedAt != null;
      const clearlyPinched = pinchRatio <= config.pinchStartRatio;
      const clearlyOpen = pinchRatio >= config.pinchReleaseRatio;

      if ((!hasPendingRelease && !clearlyOpen) || clearlyPinched) {
        return transition(
          GESTURE_MODE.NEEDS_RELEASE,
          GESTURE_ACTION.NONE,
          timestamp,
        );
      }

      const releaseStartedAt = state.releaseStartedAt ?? timestamp;
      if (hasElapsed(releaseStartedAt, timestamp, config.rearmHoldMs)) {
        return transition(
          GESTURE_MODE.READY,
          GESTURE_ACTION.NONE,
          timestamp,
        );
      }

      return transition(
        GESTURE_MODE.NEEDS_RELEASE,
        GESTURE_ACTION.NONE,
        timestamp,
        { releaseStartedAt },
      );
    }

    case GESTURE_MODE.READY: {
      const hasPendingPinch = state.pinchStartedAt != null;
      const clearlyPinched = pinchRatio <= config.pinchStartRatio;
      const clearlyOpen = pinchRatio >= config.pinchReleaseRatio;

      if ((!hasPendingPinch && !clearlyPinched) || clearlyOpen) {
        return transition(
          GESTURE_MODE.READY,
          GESTURE_ACTION.NONE,
          timestamp,
        );
      }

      const pinchStartedAt = state.pinchStartedAt ?? timestamp;
      if (hasElapsed(pinchStartedAt, timestamp, config.pinchStartHoldMs)) {
        return transition(
          GESTURE_MODE.DRAWING,
          GESTURE_ACTION.START,
          timestamp,
        );
      }

      return transition(
        GESTURE_MODE.READY,
        GESTURE_ACTION.NONE,
        timestamp,
        { pinchStartedAt },
      );
    }

    case GESTURE_MODE.DRAWING: {
      const hasPendingRelease = state.releaseStartedAt != null;
      const clearlyPinched = pinchRatio <= config.pinchStartRatio;
      const clearlyOpen = pinchRatio >= config.pinchReleaseRatio;

      if ((!hasPendingRelease && !clearlyOpen) || clearlyPinched) {
        return transition(
          GESTURE_MODE.DRAWING,
          GESTURE_ACTION.MOVE,
          timestamp,
        );
      }

      const releaseStartedAt = state.releaseStartedAt ?? timestamp;
      if (
        hasElapsed(
          releaseStartedAt,
          timestamp,
          config.pinchReleaseHoldMs,
        )
      ) {
        return transition(
          GESTURE_MODE.READY,
          GESTURE_ACTION.END,
          timestamp,
        );
      }

      // Freeze ink while release is being confirmed. If the next sample is
      // pinched again, drawing resumes without a broken stroke or a tail.
      return transition(
        GESTURE_MODE.DRAWING,
        GESTURE_ACTION.NONE,
        timestamp,
        { releaseStartedAt },
      );
    }

    default:
      return transition(
        GESTURE_MODE.NO_HAND,
        wasDrawing ? GESTURE_ACTION.END : GESTURE_ACTION.NONE,
        timestamp,
      );
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
