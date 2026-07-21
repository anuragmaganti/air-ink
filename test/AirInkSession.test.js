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

  landmarks[0] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[5] = { x: 0.4, y: 0.55, z: 0 };
  landmarks[9] = { x: 0.5, y: 0.5, z: 0 };
  landmarks[17] = { x: 0.6, y: 0.55, z: 0 };
  landmarks[4] = {
    x: indexX + pinchRatio * 0.25,
    y: indexY,
    z: 0,
  };
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

test("session bridges noisy release and tracking frames without breaking ink", () => {
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
    createFrame({ pinchRatio: 0.6, indexX: 0.7, timestamp: 0 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.READY);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.68, timestamp: 10 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.READY);
  assert.equal(session.currentStroke.length, 0);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.68, timestamp: 35 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.DRAWING);
  assert.equal(session.currentStroke.length, 1);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.64, timestamp: 50 }),
  );
  assert.equal(session.currentStroke.length, 2);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.6, indexX: 0.63, timestamp: 66 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.DRAWING);
  assert.equal(session.currentStroke.length, 2);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.62, timestamp: 82 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.DRAWING);
  assert.equal(session.currentStroke.length, 3);

  session.handleMissingHand(98);
  assert.equal(session.gesture.mode, GESTURE_MODE.DRAWING);
  assert.equal(session.currentStroke.length, 3);
  assert.equal(session.diagnostics.trackingGraceActive, true);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.6, timestamp: 140 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.DRAWING);
  assert.equal(session.diagnostics.trackingGraceActive, false);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.6, indexX: 0.59, timestamp: 160 }),
  );
  session.processTrackingResult(
    createFrame({ pinchRatio: 0.6, indexX: 0.59, timestamp: 195 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.READY);
  assert.equal(session.currentStroke.length, 0);
  assert.equal(session.strokes.length, 1);
  assert.deepEqual(signatures, [true]);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.56, timestamp: 210 }),
  );
  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.56, timestamp: 235 }),
  );
  session.handleMissingHand(250);
  session.handleMissingHand(351);
  assert.equal(session.gesture.mode, GESTURE_MODE.NO_HAND);
  assert.equal(session.strokes.length, 2);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.5, timestamp: 360 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.NEEDS_RELEASE);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.6, indexX: 0.5, timestamp: 370 }),
  );
  session.processTrackingResult(
    createFrame({ pinchRatio: 0.6, indexX: 0.5, timestamp: 415 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.READY);

  session.cameraOn = true;
  session.hasHand = true;
  session.clear();
  assert.equal(session.gesture.mode, GESTURE_MODE.NEEDS_RELEASE);
  assert.equal(session.strokes.length, 0);
  assert.equal(session.hasSignature, false);
  assert.equal(phases.at(-1), "release-to-arm");
  assert.deepEqual(signatures, [true, false]);
});

test("session allows fast low-FPS motion but rejects a true tracking teleport", () => {
  const session = new AirInkSession({
    video: { srcObject: null },
    canvas: createCanvas(),
    cursor: { style: {}, classList: createClassList() },
  });

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.6, indexX: 0.75, timestamp: 0 }),
  );
  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.75, timestamp: 10 }),
  );
  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.75, timestamp: 35 }),
  );

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.45, timestamp: 105 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.DRAWING);
  assert.equal(session.currentStroke.length, 2);

  session.processTrackingResult(
    createFrame({ pinchRatio: 0.24, indexX: 0.05, timestamp: 121 }),
  );
  assert.equal(session.gesture.mode, GESTURE_MODE.NEEDS_RELEASE);
  assert.equal(session.currentStroke.length, 0);
  assert.equal(session.strokes.length, 1);
});
