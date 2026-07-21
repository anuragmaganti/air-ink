import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  advanceGesture,
  createGestureState,
  DEFAULT_GESTURE_CONFIG,
  GESTURE_ACTION,
  GESTURE_MODE,
  getPinchMetrics,
  getPinchRatio,
  getPointerPoint,
} from "../src/airInk/gestureEngine.js";

function createLandmarks() {
  return Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
}

function observe(state, pinchRatio, timestamp, hasHand = true) {
  return advanceGesture(state, { hasHand, pinchRatio, timestamp });
}

function setNormalizedPalm(landmarks) {
  landmarks[0] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[5] = { x: 0.4, y: 0.55, z: 0 };
  landmarks[9] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[17] = { x: 0.6, y: 0.55, z: 0 };
}

function setWorldPalm(landmarks) {
  landmarks[0] = { x: 0, y: 0, z: 0 };
  landmarks[5] = { x: -0.04, y: 0.08, z: 0 };
  landmarks[9] = { x: 0, y: 0.1, z: 0 };
  landmarks[17] = { x: 0.04, y: 0.08, z: 0 };
}

describe("pinch gesture state machine", () => {
  test("confirms contact and ignores a one-frame false release", () => {
    let result = observe(createGestureState(), 0.6, 0);
    assert.equal(result.state.mode, GESTURE_MODE.READY);

    result = observe(result.state, 0.25, 10);
    assert.equal(result.action, GESTURE_ACTION.NONE);
    assert.equal(result.state.mode, GESTURE_MODE.READY);

    result = observe(result.state, 0.38, 35);
    assert.equal(result.action, GESTURE_ACTION.START);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, 0.6, 50);
    assert.equal(result.action, GESTURE_ACTION.NONE);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, 0.25, 66);
    assert.equal(result.action, GESTURE_ACTION.MOVE);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, 0.6, 80);
    result = observe(result.state, 0.4, 115);
    assert.equal(result.action, GESTURE_ACTION.END);
    assert.equal(result.state.mode, GESTURE_MODE.READY);
  });

  test("bridges short tracking loss and rearms after sustained loss", () => {
    let result = observe(
      createGestureState(GESTURE_MODE.DRAWING, { lastTimestamp: 0 }),
      null,
      10,
      false,
    );
    assert.equal(result.action, GESTURE_ACTION.NONE);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, 0.2, 70);
    assert.equal(result.action, GESTURE_ACTION.MOVE);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, null, 100, false);
    result = observe(result.state, null, 199, false);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, null, 200, false);
    assert.equal(result.action, GESTURE_ACTION.END);
    assert.equal(result.state.mode, GESTURE_MODE.NO_HAND);

    result = observe(result.state, 0.2, 210);
    assert.equal(result.action, GESTURE_ACTION.NONE);
    assert.equal(result.state.mode, GESTURE_MODE.NEEDS_RELEASE);

    result = observe(result.state, 0.6, 220);
    result = observe(result.state, 0.4, 260);
    assert.equal(result.state.mode, GESTURE_MODE.READY);

    result = observe(result.state, 0.2, 270);
    result = observe(result.state, 0.2, 295);
    assert.equal(result.action, GESTURE_ACTION.START);
  });
});

describe("hand measurements", () => {
  test("uses visible thumb and index contact instead of noisy world depth", () => {
    const normalized = createLandmarks();
    const world = createLandmarks();
    setNormalizedPalm(normalized);
    setWorldPalm(world);

    normalized[4] = { x: 0.5, y: 0.3, z: 0 };
    normalized[8] = { x: 0.55, y: 0.3, z: -0.1 };
    world[4] = { x: 0, y: 0.12, z: 0 };
    world[8] = { x: 0, y: 0.12, z: 0.045 };

    const metrics = getPinchMetrics(normalized, world);

    assert.ok(Math.abs(metrics.screenRatio - 0.2) < 0.0001);
    assert.ok(Math.abs(metrics.worldRatio - 0.5) < 0.0001);
    assert.equal(metrics.ratio, metrics.screenRatio);

    const widescreenMetrics = getPinchMetrics(normalized, world, 16 / 9);
    assert.ok(
      widescreenMetrics.ratio < DEFAULT_GESTURE_CONFIG.pinchStartRatio,
    );
  });

  test("falls back to world landmarks if image landmarks are invalid", () => {
    const world = createLandmarks();
    setWorldPalm(world);
    world[4] = { x: 0, y: 0.12, z: 0 };
    world[8] = { x: 0.018, y: 0.12, z: 0 };

    assert.ok(Math.abs(getPinchRatio(null, world) - 0.2) < 0.0001);
  });

  test("uses the mirrored index fingertip as the pen position", () => {
    const landmarks = createLandmarks();
    landmarks[4] = { x: 0.1, y: 0.2, z: 0 };
    landmarks[8] = { x: 0.75, y: 0.4, z: 0 };

    assert.deepEqual(getPointerPoint(landmarks), { x: 0.25, y: 0.4 });
  });
});
