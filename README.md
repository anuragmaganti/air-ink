# Air Ink

Air Ink is an in-browser signature studio. A webcam tracks one hand, a thumb-to-index pinch controls pen down and pen up, and movement of the index fingertip becomes a downloadable SVG signature.

## Runtime architecture

The interaction is split into four layers instead of keeping camera, model, gesture, and drawing logic in the React component:

1. `src/airInk/handTracker.worker.js` owns MediaPipe initialization and synchronous inference in a Web Worker.
2. `src/airInk/gestureEngine.js` turns landmarks into a pinch ratio, filtered pointer position, and deterministic gesture state.
3. `src/airInk/AirInkSession.js` owns camera lifecycle, video-frame scheduling, gesture-to-stroke behavior, cursor presentation, and cleanup.
4. `src/airInk/strokeGeometry.js` renders normalized strokes to Canvas and builds equivalent SVG paths.

React only receives low-frequency UI state: model readiness, camera state, interaction copy, errors, signature availability, and export feedback. Per-frame landmarks and points do not cause React renders.

## Model and inference

- Package: `@mediapipe/tasks-vision` 0.10.35.
- Model: Google's float16 Hand Landmarker v1 task, stored locally at `public/models/hand_landmarker.task`.
- Output: 21 normalized image landmarks, 21 world landmarks in meters, and handedness for one hand.
- Confidence configuration: `0.65` detection, `0.55` hand presence, and `0.55` tracking.
- Camera preference: user-facing, 1280x720, 16:9, and up to an ideal 60 FPS. These are non-mandatory constraints, so the browser can select a supported fallback.

`requestVideoFrameCallback` schedules work from actual decoded camera frames. Only one frame can be in flight, so slow inference drops intermediate frames instead of building a stale queue. The MediaPipe worker uses the module WASM loader and keeps synchronous `detectForVideo` calls off the UI thread.

The model file is local. MediaPipe's versioned WASM runtime is fetched from jsDelivr; camera frames are transferred only from the page to the same-origin worker and are not uploaded.

## Pinch behavior

Pinch detection uses 3D world landmarks when available. This prevents fingertips that overlap in the 2D image but remain separated in depth from being treated as contact.

The normalized signal is:

```text
pinch ratio = distance(thumb tip 4, index tip 8)
              / mean(distance(index MCP 5, pinky MCP 17),
                     distance(wrist 0, middle MCP 9))
```

The palm-size denominator makes the signal stable as the hand moves toward or away from the camera.

- Pen down at a ratio of `0.20` or lower.
- Pen up at a ratio of `0.32` or higher.
- Values between those thresholds preserve the current state.

This is a Schmitt-trigger style hysteresis rule. Pen up happens on the first processed result over the release threshold. There are no grace frames, frame-count delays, or smoothed pinch values.

The gesture state machine is:

```text
no hand -> needs release -> ready -> drawing
    ^          |             ^          |
    |          +-- open -----+-- release+
    +------------- tracking loss -------+
```

After tracking loss, a jump, or Clear, the user must visibly open the pinch before drawing again. This prevents a still-pinched reacquired hand from drawing a long connection across the canvas.

## Pointer and stroke quality

The index fingertip is the pen position. The thumb only controls the pinch. This avoids the old behavior where opening the thumb moved a thumb/index midpoint and produced trailing ink during release.

Pointer coordinates use a One Euro filter. It applies more smoothing near rest and less smoothing during fast movement. Pinch detection bypasses this filter, so pointer polish cannot delay pen up.

Additional safeguards:

- Mirrored `x` coordinates match the mirrored camera preview.
- Points are stored from `0..1`, independent of Canvas pixel dimensions.
- Samples closer than `0.75` displayed pixels are ignored to suppress stationary jitter and duplicate points.
- A normalized jump over `0.18` ends the stroke and requires release instead of drawing a connector.
- Canvas resolution follows its displayed size and device pixel ratio, capped at 2x for a quality/performance balance.
- Canvas and SVG use the same quadratic smoothing geometry, round caps, round joins, and CSS-equivalent stroke width.
- The quill cursor is a separate compositor layer, so hover movement does not clear and redraw all historical ink.

## Failure and cleanup behavior

- No hand: end the current stroke immediately and hide the cursor.
- Tracking reacquisition: require an open pinch before rearming.
- Camera stop or stream end: cancel frame callbacks, finalize the stroke, stop media tracks, reset gesture state, and preserve completed ink.
- Worker frame failure: stop the camera and expose a retryable error.
- Resize: resize the backing Canvas and redraw normalized strokes without changing their geometry.
- Clear while pinched: clear ink and require release before another stroke can begin.

## Verification

```bash
npm test
npm run lint
npm run build
```

The Node tests cover immediate release, hysteresis, tracking-loss rearming, 3D pinch measurement, index-tip mapping, normalized path geometry, CSS-pixel sampling, and SVG output.

Automated tests cannot establish the ideal thresholds for every webcam, hand shape, angle, and lighting condition. Final calibration should record real sessions and compare pinch ratio, inference time, false starts, false releases, and end-of-stroke overshoot before changing the constants.

## Tech stack

- React 19 and Vite
- MediaPipe Tasks Vision
- Web Workers and transferable `ImageBitmap` frames
- WebRTC `getUserMedia`
- HTML Canvas and SVG
- Phosphor Icons
- Vercel Analytics
