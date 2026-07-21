<p align="center">
  <img src="public/favicon.svg" alt="Air Ink logo" width="88" height="88" />
</p>

<h1 align="center">Air Ink</h1>

<p align="center">
  A browser-based gesture signature studio that turns hand movement into a crisp, downloadable SVG.
</p>

<p align="center">
  <a href="https://webcamsign.com/"><strong>Try Air Ink</strong></a>
</p>

Air Ink uses a webcam and real-time hand tracking to make signing feel physical without requiring a touchscreen or stylus. Touching the thumb and index finger together puts ink down, moving the index finger draws, and releasing the pinch lifts the pen.

## Features

### Gesture Drawing

- Tracks one hand from a live, mirrored camera preview.
- Uses a thumb-to-index pinch for pen down and pen up.
- Uses the index fingertip as the pointer, keeping position separate from the pinch gesture.
- Preserves a stroke through brief tracking noise instead of ending it after one missed frame.
- Shows contextual guidance for camera access, hand placement, drawing, and recovery.

### Signature Studio

- Draws smooth, responsive strokes on a dedicated signature stage.
- Keeps the quill pointer visible across the full drawing surface.
- Clears the current signature without restarting the camera.
- Downloads the finished signature as a scalable SVG with matching Canvas geometry.
- Adapts the workspace across desktop, tablet, and mobile layouts.

### Private By Design

- Processes camera frames inside the browser rather than uploading video to a server.
- Stores signature points only in memory for the current page session.
- Requires no account, backend, database, or environment variables.
- Ships the Hand Landmarker model with the app.

## How The App Works

1. A Web Worker initializes MediaPipe's Hand Landmarker model while the interface remains responsive.
2. After camera permission is granted, Air Ink schedules work from decoded video frames instead of polling the video element blindly.
3. Each frame is converted to an aspect-preserving `ImageBitmap` sized for inference and transferred to the worker.
4. MediaPipe finds the hand landmarks. The worker reduces that result to a compact packet containing the pointer, pinch measurements, and handedness.
5. A gesture state machine turns the thumb-to-index distance into stable pen-down and pen-up actions.
6. The filtered index-fingertip position is stored as normalized stroke points and rendered incrementally to Canvas.
7. Export rebuilds the same smoothed geometry as SVG, so the downloaded signature matches the preview.

```text
Webcam frame
    -> inference-sized ImageBitmap
    -> MediaPipe Web Worker
    -> compact tracking packet
    -> gesture state machine + pointer filter
    -> incremental Canvas renderer
    -> SVG export
```

## Key Decisions

### Keep Real-Time Work Outside React

Camera frames, landmarks, gesture state, and stroke points change too frequently to belong in React state. `AirInkSession` owns that imperative loop, while React receives only user-facing state such as model readiness, camera status, errors, and whether a signature exists. This avoids a component render for every tracked frame.

### Run Inference In A Web Worker

MediaPipe inference is synchronous, so running it on the main thread would compete with input, layout, and painting. Air Ink transfers frames to a worker and allows only one inference request at a time. If the model is still busy, intermediate frames are skipped rather than queued, preventing an increasingly delayed pointer.

### Separate Preview Quality From Inference Cost

The visible camera keeps the resolution selected by the browser. The inference copy is reduced only when necessary to fit within a `640x360` budget, preserves the source aspect ratio, and is never upscaled. The user keeps a clear preview while the model processes fewer pixels and avoids wasting work on low-resolution cameras.

### Treat A Pinch As State, Not A Single-Frame Event

The pinch distance is normalized against palm size, so the gesture behaves consistently as the hand moves toward or away from the camera. Separate start and release thresholds, short time-based confirmation, and a brief tracking-loss grace period absorb landmark jitter without making one bad frame break a stroke. After a clear, large tracking jump, or sustained hand loss, the gesture must visibly open before it can draw again; this prevents accidental connector lines.

### Filter Position Without Delaying Pen Up

A responsive One Euro filter smooths the index-fingertip path while preserving fast movement. Pinch detection bypasses that position filter, so visual smoothing cannot delay the moment the pen lifts. The thumb controls contact only; it does not influence pointer position and cannot pull the end of a line as the hand opens.

### Preserve One Geometry Model

Stroke points are stored in normalized coordinates, which keeps drawings stable across responsive Canvas sizes and high-density displays. Two stacked canvases separate committed ink from the short live tail, so each new sample does not redraw the full signature. Canvas and SVG share the same quadratic smoothing rules, round caps, joins, and relative stroke width.

## Tech Stack

| Area | Technology |
| --- | --- |
| Interface | React 19, JavaScript, CSS |
| Build tooling | Vite 8 |
| Hand tracking | MediaPipe Tasks Vision |
| Camera | WebRTC `getUserMedia` |
| Concurrency | Web Workers, transferable `ImageBitmap` and typed-array packets |
| Drawing and export | HTML Canvas, SVG |
| UI icons | Phosphor Icons |
| Analytics | Vercel Analytics |

## Project Structure

```text
public/
  models/hand_landmarker.task     Local MediaPipe model
src/
  App.jsx                         Interface and user-facing state
  App.css                         Responsive visual system
  airInk/
    AirInkSession.js              Camera, inference, cursor, and stroke lifecycle
    gestureEngine.js              Pinch state machine, measurements, and filtering
    handTracker.worker.js         MediaPipe initialization and inference
    trackingPacket.js             Compact worker-to-main-thread result format
    strokeGeometry.js             Incremental Canvas rendering and SVG generation
test/
  AirInkSession.test.js           Session and inference-pipeline behavior
  gestureEngine.test.js           Gesture detection and pointer filtering
  strokeGeometry.test.js          Drawing and export geometry
```

## Getting Started

### Prerequisites

- A current Node.js LTS release
- npm
- A webcam-enabled browser

### Installation

```bash
git clone https://github.com/anuragmaganti/air-ink.git
cd air-ink
npm install
npm run dev
```

Open the local URL shown by Vite, start the camera, and allow browser camera access. No application environment variables or external backend services are required.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Create the production build in `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across the project |
| `npm test` | Run the Node test suite |

## Testing

The automated suite covers gesture confirmation, noisy releases, brief and sustained tracking loss, release-to-rearm behavior, pinch measurement, pointer filtering, inference-frame sizing, compact worker packets, tracking-jump handling, incremental Canvas rendering, and SVG geometry.

```bash
npm test
npm run lint
npm run build
```

## Privacy And Deployment

Camera frames are transferred only between the page and its worker and are not sent to an Air Ink backend. Signatures remain in browser memory unless the user downloads the SVG. The model file is served locally with the application; MediaPipe's version-pinned WebAssembly runtime is loaded from jsDelivr. Vercel Analytics provides page-level usage analytics and does not receive custom camera, landmark, or signature data from the app.

The production app is available at [webcamsign.com](https://webcamsign.com/). Air Ink builds to static assets in `dist/` and can be served by any static host. Production hosting must use HTTPS because browsers restrict webcam access on insecure origins.
