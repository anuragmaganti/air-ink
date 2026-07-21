import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AirInkSession,
  getInferenceFrameSize,
} from "../src/airInk/AirInkSession.js";
import { GESTURE_MODE } from "../src/airInk/gestureEngine.js";
import {
  createTrackingPacket,
  TRACKING_VALUE_COUNT,
} from "../src/airInk/trackingPacket.js";

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
  return {
    trackingValues: createTrackingPacket({
      pointer: { x: 1 - indexX, y: indexY },
      pinchMetrics: {
        ratio: pinchRatio,
        screenRatio: pinchRatio,
        worldRatio: pinchRatio,
      },
      handedness: { categoryName: "Right", score: 0.99 },
    }),
    timestamp,
  };
}

function createMissingFrame(timestamp) {
  return {
    trackingValues: createTrackingPacket({}),
    timestamp,
  };
}

test("session bridges noisy release and tracking frames without breaking ink", () => {
  const phases = [];
  const signatures = [];
  const session = new AirInkSession({
    video: { srcObject: null },
    canvas: createCanvas(),
    liveCanvas: createCanvas(),
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

  session.processTrackingResult(createMissingFrame(98));
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
  session.processTrackingResult(createMissingFrame(250));
  session.processTrackingResult(createMissingFrame(351));
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
    liveCanvas: createCanvas(),
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

test("inference frames are bounded without distortion or upscaling", () => {
  assert.deepEqual(getInferenceFrameSize(1280, 720), {
    width: 640,
    height: 360,
  });
  assert.deepEqual(getInferenceFrameSize(1280, 960), {
    width: 480,
    height: 360,
  });
  assert.deepEqual(getInferenceFrameSize(320, 240), {
    width: 320,
    height: 240,
  });
  assert.equal(getInferenceFrameSize(0, 720), null);
});

test("tracking results use one fixed transferable numeric packet", () => {
  const { trackingValues } = createFrame({
    pinchRatio: 0.24,
    indexX: 0.7,
    timestamp: 0,
  });

  assert.ok(trackingValues instanceof Float64Array);
  assert.equal(trackingValues.length, TRACKING_VALUE_COUNT);
  assert.equal(trackingValues.byteLength, 56);
});
