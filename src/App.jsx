import { useEffect, useRef, useState } from "react";
import "./App.css";
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
import { AirInkSession } from "./airInk/AirInkSession";
import quillCursorUrl from "./assets/quill-cursor.svg";

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
    detail: "Move your hand back into view, then open your pinch to reset the pen.",
  },
  "release-to-arm": {
    title: "Open your pinch once",
    detail: "Separate thumb and index finger, then pinch again to start a clean stroke.",
  },
  ready: {
    title: "Pinch to put ink down",
    detail: "Touch thumb to index finger, then move your index finger to write.",
  },
  drawing: {
    title: "You are signing",
    detail: "Release the pinch to lift the ink. Pinch again to keep writing.",
  },
};

function HeroScribble() {
  return (
    <svg
      className="heroScribble"
      viewBox="0 0 360 58"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g className="heroScribbleShape heroScribbleShapeWide">
        <path
          className="heroScribbleStroke heroScribbleStrokeMain"
          d="M9 43 C32 39 43 15 64 13 C79 12 58 41 73 42 C92 43 105 11 125 13 C143 15 121 43 138 42 C157 41 168 15 186 17 C203 19 184 42 200 41 C219 40 230 19 246 21 C263 23 250 40 264 40 C286 39 311 24 351 17"
        />
        <path
          className="heroScribbleStroke heroScribbleStrokeTexture"
          d="M12 47 C36 42 48 20 66 18 C82 17 63 45 77 46 C97 46 110 17 128 18 C146 19 126 46 141 46 C161 45 173 20 190 21 C207 22 189 45 204 45 C224 44 235 24 250 25 C267 26 256 43 270 43 C291 42 315 29 348 22"
        />
      </g>

      <g className="heroScribbleShape heroScribbleShapeTablet">
        <path
          className="heroScribbleStroke heroScribbleStrokeMain"
          d="M8 44 C38 38 48 12 72 14 C87 16 65 43 81 43 C103 43 114 15 135 16 C151 17 132 43 149 43 C170 43 181 18 201 19 C217 20 201 42 217 42 C238 42 251 23 269 24 C287 25 280 39 294 38 C311 37 328 27 352 21"
        />
        <path
          className="heroScribbleStroke heroScribbleStrokeTexture"
          d="M12 48 C42 41 53 18 75 19 C91 20 71 46 85 47 C107 47 119 20 138 21 C155 22 137 46 153 47 C174 47 186 23 204 24 C222 25 207 46 222 46 C243 46 256 28 273 29 C290 30 285 43 299 42 C316 41 331 32 349 27"
        />
      </g>

      <g className="heroScribbleShape heroScribbleShapeMobile">
        <path
          className="heroScribbleStroke heroScribbleStrokeMain"
          d="M10 39 C45 36 61 19 85 19 C104 19 88 39 107 39 C131 39 145 18 168 19 C188 20 173 39 192 39 C217 39 231 22 253 23 C272 24 264 38 281 37 C303 36 322 28 350 24"
        />
        <path
          className="heroScribbleStroke heroScribbleStrokeTexture"
          d="M13 44 C48 40 65 24 88 24 C107 24 93 43 111 43 C135 43 149 23 171 24 C191 25 178 43 196 43 C221 43 235 27 256 28 C275 29 269 42 285 41 C306 40 325 33 347 29"
        />
      </g>
    </svg>
  );
}

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const liveCanvasRef = useRef(null);
  const cursorRef = useRef(null);
  const sessionRef = useRef(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [interactionPhase, setInteractionPhase] = useState("loading-model");
  const [feedback, setFeedback] = useState(null);

  const status =
    INTERACTION_COPY[interactionPhase] ?? INTERACTION_COPY["camera-off"];
  const showCanvasPrompt = !hasSignature;

  useEffect(() => {
    const session = new AirInkSession({
      video: videoRef.current,
      canvas: canvasRef.current,
      liveCanvas: liveCanvasRef.current,
      cursor: cursorRef.current,
      onModelState: ({ ready, error }) => {
        setModelReady(ready);
        setModelError(error);
      },
      onCameraState: ({ on, starting, error }) => {
        setCameraOn(on);
        setCameraStarting(starting);
        setCameraError(error);
      },
      onInteractionPhase: setInteractionPhase,
      onSignatureChange: setHasSignature,
    });

    sessionRef.current = session;
    session.init();

    if (import.meta.env.DEV) {
      window.__AIR_INK_DEBUG__ = {
        getSnapshot: () => session.getDiagnostics(),
      };
    }

    return () => {
      session.destroy();
      sessionRef.current = null;
      if (import.meta.env.DEV) delete window.__AIR_INK_DEBUG__;
    };
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;

    const timeoutId = window.setTimeout(() => {
      setFeedback(null);
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  function startCamera() {
    setFeedback(null);
    sessionRef.current?.startCamera();
  }

  function stopCamera() {
    sessionRef.current?.stopCamera();
  }

  function clearCanvas() {
    sessionRef.current?.clear();
  }

  function exportSignatureAsSVG() {
    if (!sessionRef.current?.exportSignatureAsSvg()) return;
    setFeedback({ section: "export", message: "Signature exported as SVG." });
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
            <span className="heroLine">Your hand is</span>{" "}
            <span className="heroLine">
              the <em>pen.</em>
            </span>
          </h1>
          <HeroScribble />
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
          <div className="stageBody">
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
                className="ink inkBase"
                aria-label="Signature drawing canvas"
              />
              <canvas
                ref={liveCanvasRef}
                className="ink inkLive"
                aria-hidden="true"
              />
              <img
                ref={cursorRef}
                className="airInkCursor"
                src={quillCursorUrl}
                alt=""
                aria-hidden="true"
                draggable="false"
              />
            </div>
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
