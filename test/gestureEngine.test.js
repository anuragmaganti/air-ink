import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  advanceGesture,
  createGestureState,
  GESTURE_ACTION,
  GESTURE_MODE,
  getPinchRatio,
  getPointerPoint,
} from "../src/airInk/gestureEngine.js";

function createLandmarks() {
  return Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
}

function observe(state, pinchRatio, hasHand = true) {
  return advanceGesture(state, { hasHand, pinchRatio });
}

describe("pinch gesture state machine", () => {
  test("ends drawing on the first sample over the release threshold", () => {
    let result = observe(createGestureState(), 0.5);
    assert.equal(result.state.mode, GESTURE_MODE.READY);

    result = observe(result.state, 0.19);
    assert.equal(result.action, GESTURE_ACTION.START);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, 0.25);
    assert.equal(result.action, GESTURE_ACTION.MOVE);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, 0.32);
    assert.equal(result.action, GESTURE_ACTION.END);
    assert.equal(result.state.mode, GESTURE_MODE.READY);
  });

  test("requires an open pinch before drawing after tracking loss", () => {
    let result = observe(createGestureState(GESTURE_MODE.READY), 0.15);
    assert.equal(result.state.mode, GESTURE_MODE.DRAWING);

    result = observe(result.state, null, false);
    assert.equal(result.action, GESTURE_ACTION.END);
    assert.equal(result.state.mode, GESTURE_MODE.NO_HAND);

    result = observe(result.state, 0.15);
    assert.equal(result.action, GESTURE_ACTION.NONE);
    assert.equal(result.state.mode, GESTURE_MODE.NEEDS_RELEASE);

    result = observe(result.state, 0.4);
    assert.equal(result.state.mode, GESTURE_MODE.READY);

    result = observe(result.state, 0.15);
    assert.equal(result.action, GESTURE_ACTION.START);
  });
});

describe("hand measurements", () => {
  test("uses 3D world landmarks for the scale-independent pinch ratio", () => {
    const normalized = createLandmarks();
    const world = createLandmarks();

    normalized[4] = { x: 0.1, y: 0.1, z: 0 };
    normalized[8] = { x: 0.8, y: 0.8, z: 0 };

    world[0] = { x: 0, y: 0, z: 0 };
    world[5] = { x: -0.04, y: 0.08, z: 0 };
    world[9] = { x: 0, y: 0.1, z: 0 };
    world[17] = { x: 0.04, y: 0.08, z: 0 };
    world[4] = { x: 0, y: 0.12, z: 0 };
    world[8] = { x: 0.018, y: 0.12, z: 0 };

    assert.ok(Math.abs(getPinchRatio(normalized, world) - 0.2) < 0.0001);
  });

  test("does not report contact when fingertips overlap only in 2D", () => {
    const world = createLandmarks();
    world[0] = { x: 0, y: 0, z: 0 };
    world[5] = { x: -0.04, y: 0.08, z: 0 };
    world[9] = { x: 0, y: 0.1, z: 0 };
    world[17] = { x: 0.04, y: 0.08, z: 0 };
    world[4] = { x: 0.2, y: 0.2, z: 0 };
    world[8] = { x: 0.2, y: 0.2, z: 0.04 };

    assert.ok(getPinchRatio(world, world) > 0.32);
  });

  test("uses the mirrored index fingertip as the pen position", () => {
    const landmarks = createLandmarks();
    landmarks[4] = { x: 0.1, y: 0.2, z: 0 };
    landmarks[8] = { x: 0.75, y: 0.4, z: 0 };

    assert.deepEqual(getPointerPoint(landmarks), { x: 0.25, y: 0.4 });
  });
});
