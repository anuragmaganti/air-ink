import {
  advanceGesture,
  createGestureState,
  GESTURE_ACTION,
  GESTURE_MODE,
  getPinchMetrics,
  getPointerPoint,
  OneEuroPointFilter,
  requireGestureRelease,
} from "./gestureEngine.js";
import {
  buildSignatureSvg,
  getPointDistance,
  getPointDistanceCss,
  redrawCanvas,
  resizeCanvasToDisplaySize,
} from "./strokeGeometry.js";

const MODEL_URL = "/models/hand_landmarker.task";
const MEDIAPIPE_VERSION = "0.10.35";
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const STROKE_WIDTH_CSS = 2;
const MIN_POINT_DISTANCE_CSS = 0.75;
const MIN_TRACKING_JUMP = 0.16;
const MAX_TRACKING_JUMP = 0.38;
const TRACKING_SPEED_ALLOWANCE = 3;
const CURSOR_SIZE = 18;
const CURSOR_VIEWBOX_SIZE = 24;
const CURSOR_HOTSPOT_X = 20.7;
const CURSOR_HOTSPOT_Y = 6.1;

const NOOP = () => {};

function getAllowedTrackingJump(elapsedMs) {
  const safeElapsedSeconds =
    Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / 1000 : 0;

  return Math.min(
    MAX_TRACKING_JUMP,
    MIN_TRACKING_JUMP + safeElapsedSeconds * TRACKING_SPEED_ALLOWANCE,
  );
}

function getPendingGesturePhase(gesture) {
  if (gesture.missingStartedAt != null) return "tracking-grace";
  if (gesture.pinchStartedAt != null) return "pinch-confirmation";
  if (gesture.releaseStartedAt == null) return null;

  return gesture.mode === GESTURE_MODE.NEEDS_RELEASE
    ? "rearm-confirmation"
    : "release-confirmation";
}

function getCameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "Camera access was blocked. Allow access in your browser settings and try again.";
  }

  if (error?.name === "NotFoundError") {
    return "No camera was found on this device.";
  }

  if (error?.name === "NotReadableError") {
    return "The camera is already in use by another app.";
  }

  return "The camera could not start. Close other camera apps and try again.";
}

export class AirInkSession {
  constructor({
    video,
    canvas,
    cursor,
    onModelState = NOOP,
    onCameraState = NOOP,
    onInteractionPhase = NOOP,
    onSignatureChange = NOOP,
  }) {
    this.video = video;
    this.canvas = canvas;
    this.cursor = cursor;
    this.onModelState = onModelState;
    this.onCameraState = onCameraState;
    this.onInteractionPhase = onInteractionPhase;
    this.onSignatureChange = onSignatureChange;

    this.worker = null;
    this.resizeObserver = null;
    this.workerReady = false;
    this.workerBusy = false;
    this.inFlightFrameId = null;
    this.nextFrameId = 1;
    this.runId = 0;
    this.running = false;
    this.destroyed = false;
    this.videoFrameCallbackId = null;
    this.animationFrameId = null;
    this.lastVideoTime = -1;
    this.lastSubmittedTimestamp = -1;
    this.cameraStarting = false;
    this.cameraOn = false;
    this.cameraError = null;
    this.modelReady = false;
    this.modelError = null;
    this.trackEndedHandler = null;

    this.gesture = createGestureState();
    this.pointFilter = new OneEuroPointFilter();
    this.hasSeenHand = false;
    this.hasHand = false;
    this.previousRawPoint = null;
    this.previousRawTimestamp = null;
    this.hasSignature = false;
    this.strokes = [];
    this.currentStroke = [];
    this.diagnostics = {
      processedFrames: 0,
      lastInferenceDuration: null,
      lastPinchRatio: null,
      lastScreenPinchRatio: null,
      lastWorldPinchRatio: null,
      lastHandedness: null,
      estimatedInferenceFps: null,
      gestureMode: GESTURE_MODE.NO_HAND,
      gesturePending: null,
      trackingGraceActive: false,
    };
    this.lastResultReceivedAt = null;
  }

  init() {
    if (this.destroyed) return;

    this.resizeObserver = new ResizeObserver(() => {
      if (resizeCanvasToDisplaySize(this.canvas)) this.redrawInk();
    });
    this.resizeObserver.observe(this.canvas);
    resizeCanvasToDisplaySize(this.canvas);

    try {
      this.worker = new Worker(new URL("./handTracker.worker.js", import.meta.url), {
        type: "module",
      });
      this.worker.addEventListener("message", (event) => {
        this.handleWorkerMessage(event.data);
      });
      this.worker.addEventListener("error", (event) => {
        console.error("Hand tracking worker failed", event);
        if (this.cameraOn) {
          this.stopCamera(
            "Hand tracking stopped unexpectedly. Start the camera to try again.",
          );
        }
        this.handleModelFailure("Hand tracking could not load. Refresh to try again.");
      });
      this.worker.postMessage({
        type: "init",
        modelUrl: new URL(MODEL_URL, window.location.href).href,
        wasmUrl: MEDIAPIPE_WASM_URL,
      });
    } catch (error) {
      console.error("Unable to create hand tracking worker", error);
      this.handleModelFailure("Hand tracking could not load. Refresh to try again.");
    }
  }

  emitModelState() {
    if (this.destroyed) return;
    this.onModelState({ ready: this.modelReady, error: this.modelError });
  }

  emitCameraState() {
    if (this.destroyed) return;
    this.onCameraState({
      on: this.cameraOn,
      starting: this.cameraStarting,
      error: this.cameraError,
    });
  }

  setInteractionPhase(phase) {
    if (this.destroyed) return;
    this.onInteractionPhase(phase);
  }

  syncGestureDiagnostics() {
    this.diagnostics.gestureMode = this.gesture.mode;
    this.diagnostics.gesturePending = getPendingGesturePhase(this.gesture);
    this.diagnostics.trackingGraceActive =
      this.gesture.missingStartedAt != null;
  }

  syncHasSignature() {
    const nextHasSignature =
      this.strokes.length > 0 || this.currentStroke.length > 0;
    if (nextHasSignature === this.hasSignature) return;

    this.hasSignature = nextHasSignature;
    if (!this.destroyed) this.onSignatureChange(nextHasSignature);
  }

  handleModelFailure(message) {
    this.workerReady = false;
    this.modelReady = false;
    this.modelError = message;
    this.emitModelState();
  }

  handleWorkerMessage(message) {
    if (this.destroyed) return;

    if (message.type === "ready") {
      this.workerReady = true;
      this.modelReady = true;
      this.modelError = null;
      this.emitModelState();
      this.setInteractionPhase("camera-off");
      return;
    }

    if (message.type === "error") {
      if (message.frameId === this.inFlightFrameId) {
        this.workerBusy = false;
        this.inFlightFrameId = null;
      }

      console.error(`Hand tracking ${message.scope} error`, message.message);

      if (message.scope === "init") {
        this.handleModelFailure(
          "Hand tracking could not load. Check your connection and refresh to try again.",
        );
      } else if (message.runId === this.runId) {
        this.stopCamera(
          "Hand tracking stopped unexpectedly. Start the camera to try again.",
        );
      }
      return;
    }

    if (message.type !== "result") return;

    if (message.frameId === this.inFlightFrameId) {
      this.workerBusy = false;
      this.inFlightFrameId = null;
    }

    if (!this.running || message.runId !== this.runId) return;

    const receivedAt = performance.now();
    if (this.lastResultReceivedAt != null) {
      const elapsed = receivedAt - this.lastResultReceivedAt;
      if (elapsed > 0) {
        const sampleFps = 1000 / elapsed;
        const previousFps = this.diagnostics.estimatedInferenceFps;
        this.diagnostics.estimatedInferenceFps =
          previousFps == null ? sampleFps : previousFps * 0.8 + sampleFps * 0.2;
      }
    }
    this.lastResultReceivedAt = receivedAt;
    this.diagnostics.processedFrames += 1;
    this.diagnostics.lastInferenceDuration = message.inferenceDuration;
    this.processTrackingResult(message);
  }

  processTrackingResult({ landmarks, worldLandmarks, handedness, timestamp }) {
    if (!landmarks) {
      this.handleMissingHand(timestamp);
      return;
    }

    const videoAspectRatio =
      this.video.videoWidth > 0 && this.video.videoHeight > 0
        ? this.video.videoWidth / this.video.videoHeight
        : 1;
    const pinchMetrics = getPinchMetrics(
      landmarks,
      worldLandmarks,
      videoAspectRatio,
    );
    const pinchRatio = pinchMetrics.ratio;
    const rawPoint = getPointerPoint(landmarks);

    if (!Number.isFinite(pinchRatio) || !rawPoint) {
      this.handleMissingHand(timestamp);
      return;
    }

    this.hasHand = true;
    this.hasSeenHand = true;
    this.diagnostics.lastPinchRatio = pinchRatio;
    this.diagnostics.lastScreenPinchRatio = pinchMetrics.screenRatio;
    this.diagnostics.lastWorldPinchRatio = pinchMetrics.worldRatio;
    this.diagnostics.lastHandedness = handedness;

    const elapsedSinceRawPoint =
      this.previousRawTimestamp == null
        ? null
        : timestamp - this.previousRawTimestamp;
    const hasTrackingJump =
      this.gesture.mode === GESTURE_MODE.DRAWING &&
      this.previousRawPoint &&
      getPointDistance(this.previousRawPoint, rawPoint) >
        getAllowedTrackingJump(elapsedSinceRawPoint);
    this.previousRawPoint = rawPoint;
    this.previousRawTimestamp = timestamp;

    if (hasTrackingJump) {
      this.finishCurrentStroke();
      this.gesture = requireGestureRelease();
      this.pointFilter.reset();
      const resetPoint = this.pointFilter.filter(rawPoint, timestamp);
      this.syncGestureDiagnostics();
      this.setCursor(resetPoint, false);
      this.setInteractionPhase("release-to-arm");
      return;
    }

    const point = this.pointFilter.filter(rawPoint, timestamp);

    const transition = advanceGesture(this.gesture, {
      hasHand: true,
      pinchRatio,
      timestamp,
    });
    this.gesture = transition.state;
    this.syncGestureDiagnostics();

    if (transition.action === GESTURE_ACTION.START) {
      this.currentStroke = [point];
      this.syncHasSignature();
      this.redrawInk();
    } else if (transition.action === GESTURE_ACTION.MOVE) {
      const lastPoint = this.currentStroke.at(-1);
      const width = this.canvas.clientWidth;
      const height = this.canvas.clientHeight;

      if (
        !lastPoint ||
        getPointDistanceCss(lastPoint, point, width, height) >=
          MIN_POINT_DISTANCE_CSS
      ) {
        this.currentStroke.push(point);
        this.redrawInk();
      }
    } else if (transition.action === GESTURE_ACTION.END) {
      this.finishCurrentStroke();
    }

    const isPuttingDownInk =
      this.gesture.mode === GESTURE_MODE.DRAWING &&
      this.gesture.releaseStartedAt == null;
    this.setCursor(point, isPuttingDownInk);

    if (this.gesture.mode === GESTURE_MODE.NEEDS_RELEASE) {
      this.setInteractionPhase("release-to-arm");
    } else if (this.gesture.mode === GESTURE_MODE.DRAWING) {
      this.setInteractionPhase("drawing");
    } else {
      this.setInteractionPhase("ready");
    }
  }

  handleMissingHand(timestamp = performance.now()) {
    const transition = advanceGesture(this.gesture, {
      hasHand: false,
      pinchRatio: null,
      timestamp,
    });

    if (transition.action === GESTURE_ACTION.END) this.finishCurrentStroke();

    this.gesture = transition.state;
    this.hasHand = false;
    this.diagnostics.lastPinchRatio = null;
    this.diagnostics.lastScreenPinchRatio = null;
    this.diagnostics.lastWorldPinchRatio = null;
    this.diagnostics.lastHandedness = null;
    this.syncGestureDiagnostics();

    if (this.gesture.mode === GESTURE_MODE.DRAWING) {
      this.setInteractionPhase("drawing");
      return;
    }

    this.previousRawPoint = null;
    this.previousRawTimestamp = null;
    this.pointFilter.reset();
    this.hideCursor();
    this.setInteractionPhase(
      this.hasSeenHand ? "tracking-lost" : "awaiting-hand",
    );
  }

  setCursor(point, isDrawing) {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;

    const hotspotX = (CURSOR_HOTSPOT_X / CURSOR_VIEWBOX_SIZE) * CURSOR_SIZE;
    const hotspotY = (CURSOR_HOTSPOT_Y / CURSOR_VIEWBOX_SIZE) * CURSOR_SIZE;
    const x = point.x * width - hotspotX;
    const y = point.y * height - hotspotY;

    this.cursor.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(180deg)`;
    this.cursor.classList.add("isVisible");
    this.cursor.classList.toggle("isDrawing", isDrawing);
  }

  hideCursor() {
    this.cursor.classList.remove("isVisible", "isDrawing");
  }

  redrawInk() {
    redrawCanvas(this.canvas, this.strokes, this.currentStroke, {
      strokeWidthCss: STROKE_WIDTH_CSS,
    });
  }

  finishCurrentStroke() {
    if (this.currentStroke.length > 0) this.strokes.push(this.currentStroke);
    this.currentStroke = [];
    this.syncHasSignature();
    this.redrawInk();
  }

  scheduleNextFrame() {
    if (!this.running) return;

    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.videoFrameCallbackId = this.video.requestVideoFrameCallback(
        (_now, metadata) => {
          this.videoFrameCallbackId = null;
          this.scheduleNextFrame();
          this.captureFrame(metadata.mediaTime * 1000);
        },
      );
      return;
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.scheduleNextFrame();

      if (this.video.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = this.video.currentTime;
      this.captureFrame(performance.now());
    });
  }

  captureFrame(timestamp) {
    if (
      !this.running ||
      !this.workerReady ||
      this.workerBusy ||
      this.video.readyState < 2
    ) {
      return;
    }

    this.workerBusy = true;
    const runId = this.runId;
    const frameId = this.nextFrameId;
    this.nextFrameId += 1;
    this.inFlightFrameId = frameId;

    createImageBitmap(this.video)
      .then((bitmap) => {
        if (this.destroyed || !this.running || runId !== this.runId) {
          bitmap.close();
          if (frameId === this.inFlightFrameId) {
            this.workerBusy = false;
            this.inFlightFrameId = null;
          }
          return;
        }

        const monotonicTimestamp = Math.max(
          timestamp,
          this.lastSubmittedTimestamp + 0.001,
        );
        this.lastSubmittedTimestamp = monotonicTimestamp;
        this.worker.postMessage(
          {
            type: "frame",
            bitmap,
            frameId,
            runId,
            timestamp: monotonicTimestamp,
          },
          [bitmap],
        );
      })
      .catch((error) => {
        if (frameId === this.inFlightFrameId) {
          this.workerBusy = false;
          this.inFlightFrameId = null;
        }
        console.error("Unable to capture a camera frame", error);
        if (runId === this.runId) {
          this.stopCamera(
            "Camera frames could not be processed. Start the camera to try again.",
          );
        }
      });
  }

  async startCamera() {
    if (
      this.destroyed ||
      this.cameraStarting ||
      this.cameraOn ||
      !this.workerReady
    ) {
      return;
    }

    this.cameraStarting = true;
    this.cameraError = null;
    this.emitCameraState();

    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 60 },
        },
      });

      if (this.destroyed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.video.srcObject = stream;
      await this.video.play();

      this.runId += 1;
      this.running = true;
      this.cameraOn = true;
      this.gesture = createGestureState();
      this.pointFilter.reset();
      this.hasSeenHand = false;
      this.hasHand = false;
      this.previousRawPoint = null;
      this.previousRawTimestamp = null;
      this.lastVideoTime = -1;
      this.lastSubmittedTimestamp = -1;
      this.lastResultReceivedAt = null;
      this.diagnostics.estimatedInferenceFps = null;
      this.syncGestureDiagnostics();

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        this.trackEndedHandler = () => {
          this.stopCamera("The camera stream ended. Start it again to continue.");
        };
        videoTrack.addEventListener("ended", this.trackEndedHandler, { once: true });
      }

      this.setInteractionPhase("awaiting-hand");
      this.scheduleNextFrame();
    } catch (error) {
      console.error("Unable to start camera", error);
      stream?.getTracks().forEach((track) => track.stop());
      this.video.srcObject = null;
      this.cameraError = getCameraErrorMessage(error);
      this.cameraOn = false;
      this.setInteractionPhase("camera-off");
    } finally {
      this.cameraStarting = false;
      this.emitCameraState();
    }
  }

  cancelFrameRequests() {
    if (
      this.videoFrameCallbackId != null &&
      typeof this.video.cancelVideoFrameCallback === "function"
    ) {
      this.video.cancelVideoFrameCallback(this.videoFrameCallbackId);
    }

    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    this.videoFrameCallbackId = null;
    this.animationFrameId = null;
  }

  stopCamera(errorMessage = null) {
    this.running = false;
    this.runId += 1;
    this.cancelFrameRequests();
    this.finishCurrentStroke();

    const stream = this.video.srcObject;
    if (stream?.getTracks) {
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack && this.trackEndedHandler) {
        videoTrack.removeEventListener("ended", this.trackEndedHandler);
      }
      stream.getTracks().forEach((track) => track.stop());
    }

    this.trackEndedHandler = null;
    this.video.srcObject = null;
    this.cameraOn = false;
    this.cameraStarting = false;
    this.cameraError = errorMessage;
    this.gesture = createGestureState();
    this.pointFilter.reset();
    this.hasSeenHand = false;
    this.hasHand = false;
    this.previousRawPoint = null;
    this.previousRawTimestamp = null;
    this.lastResultReceivedAt = null;
    this.diagnostics.lastPinchRatio = null;
    this.diagnostics.lastScreenPinchRatio = null;
    this.diagnostics.lastWorldPinchRatio = null;
    this.diagnostics.lastHandedness = null;
    this.diagnostics.estimatedInferenceFps = null;
    this.syncGestureDiagnostics();
    this.hideCursor();
    this.setInteractionPhase("camera-off");
    this.emitCameraState();
  }

  clear() {
    this.strokes = [];
    this.currentStroke = [];
    this.syncHasSignature();
    this.redrawInk();

    if (this.cameraOn && this.hasHand) {
      this.gesture = requireGestureRelease();
      this.syncGestureDiagnostics();
      this.setInteractionPhase("release-to-arm");
      this.cursor.classList.remove("isDrawing");
    }
  }

  exportSignatureAsSvg() {
    const exportableStrokes =
      this.currentStroke.length > 0
        ? [...this.strokes, this.currentStroke]
        : this.strokes;
    if (exportableStrokes.length === 0) return false;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const svg = buildSignatureSvg(exportableStrokes, {
      aspectRatio: width > 0 && height > 0 ? width / height : 16 / 10,
      sourceWidthCss: width,
      strokeWidthCss: STROKE_WIDTH_CSS,
    });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "signature.svg";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  }

  getDiagnostics() {
    return { ...this.diagnostics };
  }

  destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    this.running = false;
    this.cancelFrameRequests();

    const stream = this.video.srcObject;
    if (stream?.getTracks) {
      stream.getTracks().forEach((track) => track.stop());
    }
    this.video.srcObject = null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.worker?.postMessage({ type: "close" });
    this.worker?.terminate();
    this.worker = null;
    this.hideCursor();
  }
}
