import { useEffect, useRef, useState } from "react";
import "./App.css";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import {
  ArrowCounterClockwise,
  Camera,
  CheckCircle,
  DownloadSimple,
  HandGrabbing,
  PenNib,
  ShieldCheck,
  SpinnerGap,
  VideoCameraSlash,
} from "@phosphor-icons/react";
import quillCursorUrl from "./assets/quill-cursor.svg";

const MODEL_URL = "/models/hand_landmarker.task";
const MEDIAPIPE_VERSION = "0.10.32";
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const STROKE_WIDTH = 2;
const CANVAS_STROKE_COLOR = "#1d1c19";
const EXPORT_STROKE_COLOR = "black";
const CURSOR_RADIUS = 5;
const CURSOR_IDLE_COLOR = "#ff5a36";
const CURSOR_DRAWING_COLOR = "#1d1c19";
const CURSOR_QUILL_SIZE = 18;
const CURSOR_QUILL_VIEWBOX_SIZE = 24;
const CURSOR_QUILL_HOTSPOT_X = 20.7;
const CURSOR_QUILL_HOTSPOT_Y = 6.1;
const PINCH_ON_RATIO = 0.18;
const PINCH_OFF_RATIO = 0.24;
const PINCH_SMOOTHING = 0.45;
const PINCH_RELEASE_GRACE_FRAMES = 3;
const DRAWING_RELEASE_RATIO = 0.34;
const DRAWING_RELEASE_GRACE_FRAMES = 6;

const INTERACTION_COPY = {
  "loading-model": {
    title: "Warming up the ink",
    detail: "The gesture engine is loading in your browser.",
  },
  "camera-off": {
    title: "Your mark starts here",
    detail: "Turn on the camera, then bring one hand into view.",
  },
  "awaiting-hand": {
    title: "Bring one hand into view",
    detail: "Keep your thumb and index finger visible in the camera frame.",
  },
  "tracking-lost": {
    title: "Find the frame again",
    detail: "Move your hand back into view to continue your signature.",
  },
  ready: {
    title: "Pinch to put ink down",
    detail: "Touch thumb to index finger, then move your hand to write.",
  },
  drawing: {
    title: "You are signing",
    detail: "Release the pinch to lift the ink. Pinch again to keep writing.",
  },
};

function App() {
  const handLandmarkerRef = useRef(null);
  const videoRef = useRef(null);
  const rafId = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const canvasRef = useRef(null);
  const isPinchingRef = useRef(false);
  const isDrawingRef = useRef(false);
  const handDetectedRef = useRef(false);
  const hasSignatureRef = useRef(false);
  const interactionPhaseRef = useRef("loading-model");
  const cursorPointRef = useRef(null);
  const quillCursorImageRef = useRef(null);
  const smoothedPinchRatioRef = useRef(null);
  const pinchReleaseFramesRef = useRef(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [interactionPhase, setInteractionPhase] = useState("loading-model");
  const [feedback, setFeedback] = useState(null);

  const strokesRef = useRef([]);
  const currentStrokeRef = useRef([]);

  const status = INTERACTION_COPY[interactionPhase];
  const showCanvasPrompt = !hasSignature;

  useEffect(() => {
    if (!feedback) return undefined;

    const timeoutId = window.setTimeout(() => {
      setFeedback(null);
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  function syncHandDetected(next) {
    handDetectedRef.current = next;
  }

  function syncHasSignature(next) {
    if (hasSignatureRef.current === next) return;

    hasSignatureRef.current = next;
    setHasSignature(next);
  }

  function updateHasSignature() {
    syncHasSignature(
      strokesRef.current.length > 0 || currentStrokeRef.current.length > 0,
    );
  }

  function syncInteractionPhase(next) {
    if (interactionPhaseRef.current === next) return;

    interactionPhaseRef.current = next;
    setInteractionPhase(next);
  }

  function showFeedback(section, message) {
    setFeedback({ section, message });
  }

  function finishCurrentStroke() {
    if (isDrawingRef.current && currentStrokeRef.current.length > 0) {
      strokesRef.current.push(currentStrokeRef.current);
    }

    currentStrokeRef.current = [];
    isDrawingRef.current = false;
    updateHasSignature();
  }

  function syncCanvasSize(canvas, video) {
    const canvasAspect = canvas.clientWidth / canvas.clientHeight;
    const nextWidth = video.videoWidth;
    const nextHeight = Math.round(nextWidth / canvasAspect);

    if (
      !Number.isFinite(canvasAspect) ||
      canvasAspect <= 0 ||
      (canvas.width === nextWidth && canvas.height === nextHeight)
    ) {
      return;
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
    redrawCanvas();
  }

  function getDrawPoint(thumbTip, indexTip, canvas) {
    const midX = ((thumbTip.x + indexTip.x) / 2) * canvas.width;
    const midY = ((thumbTip.y + indexTip.y) / 2) * canvas.height;

    return {
      x: canvas.width - midX,
      y: midY,
    };
  }

  function getMidPoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  function getLandmarkDistance2D(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;

    return Math.hypot(dx, dy);
  }

  function getPinchDistanceRatio(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const wrist = landmarks[0];
    const indexMcp = landmarks[5];
    const middleMcp = landmarks[9];
    const pinkyMcp = landmarks[17];

    const pinchDistance = getLandmarkDistance2D(thumbTip, indexTip);
    const palmWidth = getLandmarkDistance2D(indexMcp, pinkyMcp);
    const palmLength = getLandmarkDistance2D(wrist, middleMcp);
    const handScale = Math.max(palmWidth, palmLength, 0.0001);

    return pinchDistance / handScale;
  }

  function getSmoothedPinchRatio(nextRatio) {
    const previousRatio = smoothedPinchRatioRef.current;

    if (previousRatio == null) {
      smoothedPinchRatioRef.current = nextRatio;
      return nextRatio;
    }

    const smoothedRatio =
      previousRatio + (nextRatio - previousRatio) * PINCH_SMOOTHING;

    smoothedPinchRatioRef.current = smoothedRatio;
    return smoothedRatio;
  }

  function getCanvasScale(canvas) {
    return canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  }

  function resetPinchSignal() {
    smoothedPinchRatioRef.current = null;
    pinchReleaseFramesRef.current = 0;
  }

  function drawStroke(ctx, stroke) {
    if (stroke.length === 0) return;

    const strokeWidth = STROKE_WIDTH * getCanvasScale(ctx.canvas);

    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = CANVAS_STROKE_COLOR;
    ctx.fillStyle = CANVAS_STROKE_COLOR;

    if (stroke.length === 1) {
      const [point] = stroke;

      ctx.beginPath();
      ctx.arc(point.x, point.y, strokeWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);

    if (stroke.length === 2) {
      ctx.lineTo(stroke[1].x, stroke[1].y);
      ctx.stroke();
      return;
    }

    for (let i = 1; i < stroke.length - 1; i += 1) {
      const midPoint = getMidPoint(stroke[i], stroke[i + 1]);
      ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, midPoint.x, midPoint.y);
    }

    const lastPoint = stroke[stroke.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);
    ctx.stroke();
  }

  function drawCursor(ctx) {
    const point = cursorPointRef.current;
    if (!point || !handDetectedRef.current) return;

    const quillCursorImage = quillCursorImageRef.current;
    const canvasScale = getCanvasScale(ctx.canvas);

    if (quillCursorImage) {
      const quillSize = CURSOR_QUILL_SIZE * canvasScale;
      const drawX =
        (-CURSOR_QUILL_HOTSPOT_X / CURSOR_QUILL_VIEWBOX_SIZE) *
        quillSize;
      const drawY =
        (-CURSOR_QUILL_HOTSPOT_Y / CURSOR_QUILL_VIEWBOX_SIZE) *
        quillSize;

      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(Math.PI);
      ctx.globalAlpha = isPinchingRef.current ? 1 : 0.92;
      ctx.drawImage(
        quillCursorImage,
        drawX,
        drawY,
        quillSize,
        quillSize,
      );
      ctx.restore();
      return;
    }

    const cursorColor = isPinchingRef.current
      ? CURSOR_DRAWING_COLOR
      : CURSOR_IDLE_COLOR;

    ctx.save();
    ctx.strokeStyle = cursorColor;
    ctx.fillStyle = cursorColor;
    ctx.lineWidth = 2 * canvasScale;

    ctx.beginPath();
    ctx.arc(point.x, point.y, CURSOR_RADIUS * canvasScale, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(point.x, point.y, 2 * canvasScale, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function redrawCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke);
    }

    drawStroke(ctx, currentStrokeRef.current);
    drawCursor(ctx);
  }

  useEffect(() => {
    let cancelled = false;
    const image = new Image();

    image.decoding = "async";
    image.src = quillCursorUrl;
    image.onload = () => {
      if (cancelled) return;
      quillCursorImageRef.current = image;
    };

    return () => {
      cancelled = true;
      quillCursorImageRef.current = null;
    };
  }, []);

  function getStrokePathData(stroke) {
    if (stroke.length === 0) return "";

    if (stroke.length === 1) {
      const [point] = stroke;
      return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }

    if (stroke.length === 2) {
      return stroke
        .map((point, index) =>
          index === 0
            ? `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
            : `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
        )
        .join(" ");
    }

    const commands = [`M ${stroke[0].x.toFixed(2)} ${stroke[0].y.toFixed(2)}`];

    for (let i = 1; i < stroke.length - 1; i += 1) {
      const midPoint = getMidPoint(stroke[i], stroke[i + 1]);

      commands.push(
        `Q ${stroke[i].x.toFixed(2)} ${stroke[i].y.toFixed(2)} ${midPoint.x.toFixed(2)} ${midPoint.y.toFixed(2)}`,
      );
    }

    const lastPoint = stroke[stroke.length - 1];
    commands.push(`L ${lastPoint.x.toFixed(2)} ${lastPoint.y.toFixed(2)}`);

    return commands.join(" ");
  }

  function buildStrokeSvg(stroke, strokeWidth) {
    if (stroke.length === 0) return "";

    if (stroke.length === 1) {
      const [point] = stroke;

      return `<circle
        cx="${point.x.toFixed(2)}"
        cy="${point.y.toFixed(2)}"
        r="${(strokeWidth / 2).toFixed(2)}"
        fill="${EXPORT_STROKE_COLOR}" />`;
    }

    return `<path d="${getStrokePathData(stroke)}"
        stroke="${EXPORT_STROKE_COLOR}"
        stroke-width="${strokeWidth.toFixed(2)}"
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round" />`;
  }

  function processVideoFrame(video, canvas, handLandmarker) {
    const result = handLandmarker.detectForVideo(video, performance.now());
    const hasHand = result.landmarks.length > 0;
    const hadHand = handDetectedRef.current;

    syncHandDetected(hasHand);

    if (!hasHand) {
      cursorPointRef.current = null;
      resetPinchSignal();
      isPinchingRef.current = false;
      finishCurrentStroke();
      syncInteractionPhase(hadHand ? "tracking-lost" : "awaiting-hand");
      redrawCanvas();
      return;
    }

    const lm = result.landmarks[0];
    const thumbTip = lm[4];
    const indexTip = lm[8];
    const pinchRatio = getSmoothedPinchRatio(getPinchDistanceRatio(lm));
    // Once ink is down, be much slower to lift it so strokes survive weak angles.
    const releaseRatio = isDrawingRef.current
      ? DRAWING_RELEASE_RATIO
      : PINCH_OFF_RATIO;
    const releaseGraceFrames = isDrawingRef.current
      ? DRAWING_RELEASE_GRACE_FRAMES
      : PINCH_RELEASE_GRACE_FRAMES;

    if (!isPinchingRef.current && pinchRatio < PINCH_ON_RATIO) {
      pinchReleaseFramesRef.current = 0;
      isPinchingRef.current = true;
    }

    if (isPinchingRef.current && pinchRatio > releaseRatio) {
      pinchReleaseFramesRef.current += 1;

      if (pinchReleaseFramesRef.current >= releaseGraceFrames) {
        pinchReleaseFramesRef.current = 0;
        isPinchingRef.current = false;
      }
    } else {
      pinchReleaseFramesRef.current = 0;
    }

    const drawPoint = getDrawPoint(thumbTip, indexTip, canvas);
    cursorPointRef.current = drawPoint;

    if (!isPinchingRef.current) {
      finishCurrentStroke();
      syncInteractionPhase("ready");
      redrawCanvas();
      return;
    }

    syncInteractionPhase("drawing");

    if (!isDrawingRef.current) {
      isDrawingRef.current = true;
      currentStrokeRef.current = [drawPoint];
      updateHasSignature();
      redrawCanvas();
      return;
    }

    currentStrokeRef.current.push(drawPoint);
    updateHasSignature();
    redrawCanvas();
  }

  function stopDetectionLoop() {
    finishCurrentStroke();

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }

    lastVideoTimeRef.current = -1;
  }

  function clearCanvas() {
    strokesRef.current = [];
    currentStrokeRef.current = [];
    isDrawingRef.current = false;
    isPinchingRef.current = false;
    resetPinchSignal();
    updateHasSignature();
    redrawCanvas();
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: "VIDEO",
          numHands: 1,
        });

        if (cancelled) {
          handLandmarker.close?.();
          return;
        }

        handLandmarkerRef.current = handLandmarker;
        setModelReady(true);
        syncInteractionPhase("camera-off");
      } catch (error) {
        console.error("Unable to load hand tracking", error);

        if (!cancelled) {
          setModelError(
            "Hand tracking could not load. Check your connection and refresh to try again.",
          );
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      handLandmarkerRef.current?.close?.();
      handLandmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);

      const stream = video?.srcObject;
      if (stream && stream.getTracks) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  function startDetectionLoop() {
    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const handLandmarker = handLandmarkerRef.current;

      if (!video || !canvas || !handLandmarker || video.readyState < 2) {
        rafId.current = requestAnimationFrame(loop);
        return;
      }

      syncCanvasSize(canvas, video);

      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        processVideoFrame(video, canvas, handLandmarker);
      }

      rafId.current = requestAnimationFrame(loop);
    };

    rafId.current = requestAnimationFrame(loop);
  }

  async function startCamera() {
    if (cameraStarting || cameraOn) return;

    setCameraStarting(true);
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });
      const video = videoRef.current;

      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      await video.play();

      setCameraOn(true);
      setFeedback(null);
      syncInteractionPhase("awaiting-hand");
      startDetectionLoop();
    } catch (error) {
      console.error("Unable to start camera", error);

      const message =
        error?.name === "NotAllowedError"
          ? "Camera access was blocked. Allow access in your browser settings and try again."
          : error?.name === "NotFoundError"
            ? "No camera was found on this device."
            : "The camera could not start. Close other camera apps and try again.";

      setCameraError(message);
      syncInteractionPhase("camera-off");
    } finally {
      setCameraStarting(false);
    }
  }

  function stopCamera() {
    stopDetectionLoop();
    syncHandDetected(false);
    cursorPointRef.current = null;
    isPinchingRef.current = false;
    resetPinchSignal();

    const video = videoRef.current;
    const stream = video?.srcObject;

    if (stream && stream.getTracks) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (video) video.srcObject = null;

    setCameraOn(false);
    setCameraError(null);
    syncInteractionPhase("camera-off");
    redrawCanvas();
  }

  function exportSignatureAsSVG() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const exportableStrokes =
      currentStrokeRef.current.length > 0
        ? [...strokesRef.current, currentStrokeRef.current]
        : strokesRef.current;

    if (exportableStrokes.length === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    const exportStrokeWidth = STROKE_WIDTH * getCanvasScale(canvas);
    const svgElements = exportableStrokes
      .map((stroke) => buildStrokeSvg(stroke, exportStrokeWidth))
      .filter(Boolean)
      .join("\n");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${width} ${height}"
      width="${width}"
      height="${height}">
    ${svgElements}</svg>`.trim();

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "signature.svg";
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showFeedback("export", "Signature exported as SVG.");
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand" aria-label="Air Ink home">
          <span className="brandMark" aria-hidden="true">
            <PenNib size={20} weight="fill" />
          </span>
          <div className="brandName">Air Ink</div>
        </div>
        <p className="headerStatement">
          Air Ink uses your webcam to turn your <strong>hand movement</strong> into a{" "}
          <span className="statementFinish">crisp, downloadable signature.</span>
        </p>
        <div className="privacyNote">
          <ShieldCheck size={18} weight="bold" aria-hidden="true" />
          <span>Video stays on your device</span>
        </div>
      </header>

      <main className="workspace">
        <section className="introPanel" aria-labelledby="page-title">
          <h1 id="page-title" className="heroTitle">
            Your hand is the <em>pen.</em>
          </h1>
        </section>

        <section className="cameraPanel" aria-label="Camera controls">
          <div className="videoFrame">
            <video
              ref={videoRef}
              muted
              playsInline
              className="cameraPreview"
              aria-label="Mirrored live camera preview"
            />

            {!cameraOn ? (
              <div className="videoPlaceholder">
                {cameraStarting || (!modelReady && !modelError) ? (
                  <SpinnerGap
                    className="spinner"
                    size={30}
                    weight="bold"
                    aria-hidden="true"
                  />
                ) : (
                  <VideoCameraSlash size={30} weight="duotone" aria-hidden="true" />
                )}
                <span>
                  {modelError
                    ? "Tracker unavailable"
                    : cameraStarting
                      ? "Waiting for permission"
                      : !modelReady
                        ? "Loading hand tracking"
                        : "Camera preview"}
                </span>
              </div>
            ) : null}
          </div>

          {modelError || cameraError ? (
            <div className="inlineError" role="alert">
              {modelError || cameraError}
            </div>
          ) : null}

          {!cameraOn ? (
            <button
              type="button"
              className="controlButton primary cameraAction"
              onClick={startCamera}
              disabled={!modelReady || cameraStarting || Boolean(modelError)}
            >
              {modelError ? (
                <VideoCameraSlash size={19} weight="bold" />
              ) : cameraStarting || !modelReady ? (
                <SpinnerGap className="spinner" size={19} weight="bold" />
              ) : (
                <Camera size={19} weight="bold" />
              )}
              {modelError
                ? "Tracker unavailable"
                : cameraStarting
                  ? "Opening camera"
                  : modelReady
                    ? "Start camera"
                    : "Loading tracker"}
            </button>
          ) : (
            <button
              type="button"
              className="controlButton cameraAction"
              onClick={stopCamera}
            >
              <VideoCameraSlash size={19} weight="bold" />
              Stop camera
            </button>
          )}
        </section>

        <section className="stage" aria-label="Signature stage">
          <div className="drawingSurface">
            <div className="signatureGuide">
              <div className="signatureGuideLabel">Sign here</div>
              <div className="signatureGuideLine" />
            </div>

            {showCanvasPrompt ? (
              <div className="canvasPrompt" role="status" aria-live="polite">
                <div className="gestureIcon" aria-hidden="true">
                  <HandGrabbing size={36} weight="duotone" />
                </div>
                <div>
                  <h3>{modelError ? "The canvas needs the tracker" : status.title}</h3>
                  <p>{modelError || status.detail}</p>
                </div>
              </div>
            ) : null}

            <canvas
              ref={canvasRef}
              className="ink"
              aria-label="Signature drawing canvas"
            />
          </div>

          <div className="actionDock">
            <button
              type="button"
              className="controlButton"
              onClick={clearCanvas}
              disabled={!hasSignature}
            >
              <ArrowCounterClockwise size={19} weight="bold" />
              Clear
            </button>

            <button
              type="button"
              className="controlButton exportButton"
              onClick={exportSignatureAsSVG}
              disabled={!hasSignature}
            >
              <DownloadSimple size={19} weight="bold" />
              Download SVG
            </button>

            {feedback?.section === "export" ? (
              <div className="exportFeedback" role="status">
                <CheckCircle size={18} weight="fill" />
                {feedback.message}
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
