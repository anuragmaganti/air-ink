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
