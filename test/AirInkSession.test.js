import assert from "node:assert/strict";
import { test } from "node:test";
import { AirInkSession } from "../src/airInk/AirInkSession.js";
import { GESTURE_MODE } from "../src/airInk/gestureEngine.js";

function createClassList() {
  const classes = new Set();

  return {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    toggle: (name, force) => {
      if (force) classes.add(name);
      else classes.delete(name);
    },
    contains: (name) => classes.has(name),
  };
}

function createCanvas() {
  const canvas = {
    clientWidth: 1000,
    clientHeight: 625,
    width: 1000,
    height: 625,
  };
  const context = {
    canvas,
    save() {},
    restore() {},
    clearRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    stroke() {},
  };

  canvas.getContext = () => context;
  return canvas;
}

function createFrame({ pinchRatio, indexX, indexY = 0.5, timestamp }) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const worldLandmarks = Array.from({ length: 21 }, () => ({
    x: 0,
    y: 0,
    z: 0,
  }));

  landmarks[8] = { x: indexX, y: indexY, z: 0 };
  worldLandmarks[0] = { x: 0, y: 0, z: 0 };
  worldLandmarks[5] = { x: -0.04, y: 0.08, z: 0 };
  worldLandmarks[9] = { x: 0, y: 0.1, z: 0 };
  worldLandmarks[17] = { x: 0.04, y: 0.08, z: 0 };
  worldLandmarks[4] = { x: 0, y: 0.12, z: 0 };
  worldLandmarks[8] = { x: pinchRatio * 0.09, y: 0.12, z: 0 };

  return {
    landmarks,
    worldLandmarks,
    handedness: { categoryName: "Right", score: 0.99 },
    timestamp,
  };
}

test("session finalizes immediately and rearms safely after loss or Clear", () => {
  const phases = [];
  const signatures = [];
  const session = new AirInkSession({
    video: { srcObject: null },
    canvas: createCanvas(),
    cursor: { style: {}, classList: createClassList() },
    onInteractionPhase: (phase) => phases.push(phase),
    onSignatureChange: (hasSignature) => signatures.push(hasSignature),
  });

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.5, indexX: 0.7, timestamp: 0 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.READY);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.15, indexX: 0.68, timestamp: 16 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.DRAWING);
  assert.equal(session.currentStroke.length, 1);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.15, indexX: 0.6, timestamp: 32 }),
  );
  assert.equal(session.currentStroke.length, 2);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.4, indexX: 0.58, timestamp: 48 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.READY);
  assert.equal(session.currentStroke.length, 0);
  assert.equal(session.strokes.length, 1);
  assert.deepEqual(signatures, [true]);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.15, indexX: 0.55, timestamp: 64 }),
  );
  session.handleMissingHand();
  assert.equal(session.gesture.mode, GESTURE_MODE.NO_HAND);
  assert.equal(session.strokes.length, 2);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.15, indexX: 0.5, timestamp: 80 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.NEEDS_RELEASE);
  assert.equal(session.strokes.length, 2);

  session.cameraOn = true;
  session.hasHand = true;
  session.clear();
  assert.equal(session.gesture.mode, GESTURE_MODE.NEEDS_RELEASE);
  assert.equal(session.strokes.length, 0);
  assert.equal(session.hasSignature, false);
  assert.equal(phases.at(-1), "release-to-arm");
  assert.deepEqual(signatures, [true, false]);
});
