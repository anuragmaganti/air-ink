export const TRACKING_VALUE = Object.freeze({
  POINTER_X: 0,
  POINTER_Y: 1,
  PINCH_RATIO: 2,
  SCREEN_PINCH_RATIO: 3,
  WORLD_PINCH_RATIO: 4,
  HANDEDNESS_CODE: 5,
  HANDEDNESS_SCORE: 6,
});

export const TRACKING_VALUE_COUNT = 7;

export const HANDEDNESS_CODE = Object.freeze({
  LEFT: -1,
  UNKNOWN: 0,
  RIGHT: 1,
});

function numberOrNaN(value) {
  return Number.isFinite(value) ? value : Number.NaN;
}

function encodeHandedness(categoryName) {
  if (categoryName === "Left") return HANDEDNESS_CODE.LEFT;
  if (categoryName === "Right") return HANDEDNESS_CODE.RIGHT;
  return HANDEDNESS_CODE.UNKNOWN;
}

export function decodeHandedness(code) {
  if (code === HANDEDNESS_CODE.LEFT) return "Left";
  if (code === HANDEDNESS_CODE.RIGHT) return "Right";
  return null;
}

export function createTrackingPacket({ pointer, pinchMetrics, handedness }) {
  // Float64 preserves the precision of the previous structured-clone path.
  const values = new Float64Array(TRACKING_VALUE_COUNT);

  values[TRACKING_VALUE.POINTER_X] = numberOrNaN(pointer?.x);
  values[TRACKING_VALUE.POINTER_Y] = numberOrNaN(pointer?.y);
  values[TRACKING_VALUE.PINCH_RATIO] = numberOrNaN(pinchMetrics?.ratio);
  values[TRACKING_VALUE.SCREEN_PINCH_RATIO] = numberOrNaN(
    pinchMetrics?.screenRatio,
  );
  values[TRACKING_VALUE.WORLD_PINCH_RATIO] = numberOrNaN(
    pinchMetrics?.worldRatio,
  );
  values[TRACKING_VALUE.HANDEDNESS_CODE] = encodeHandedness(
    handedness?.categoryName,
  );
  values[TRACKING_VALUE.HANDEDNESS_SCORE] = numberOrNaN(handedness?.score);

  return values;
}

export function isTrackingPacket(values) {
  return (
    values instanceof Float64Array && values.length === TRACKING_VALUE_COUNT
  );
}
