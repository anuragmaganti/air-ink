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
- Confidence configuration: MediaPipe's `0.5` defaults for detection, hand presence, and tracking.
- Camera preference: user-facing, 1280x720, 16:9, and up to an ideal 60 FPS. These are non-mandatory constraints, so the browser can select a supported fallback.

`requestVideoFrameCallback` schedules work from actual decoded camera frames. The visible preview keeps the camera's selected resolution, while the inference bitmap is proportionally reduced to fit within `640x360` and is never upscaled. Only one frame can be in flight, so slow inference drops intermediate frames instead of building a stale queue. The MediaPipe worker uses the module WASM loader and keeps synchronous `detectForVideo` calls off the UI thread.

The model file is local. MediaPipe's versioned WASM runtime is fetched from jsDelivr; camera frames are transferred only from the page to the same-origin worker and are not uploaded.

## Pinch behavior

Pinch detection measures the visible distance between thumb tip landmark `4` and index tip landmark `8`. Image-space `x` is corrected for the camera aspect ratio before distance is measured, so a horizontal gap and vertical gap have comparable physical meaning on a 16:9 frame. MediaPipe world landmarks remain in diagnostics and act as a fallback only if image landmarks are invalid; monocular depth estimates do not gate the interaction.

The normalized signal is:

```text
pinch ratio = distance(thumb tip 4, index tip 8)
              / mean(distance(index MCP 5, pinky MCP 17),
                     distance(wrist 0, middle MCP 9))
```

The palm-size denominator makes the signal stable as the hand moves toward or away from the camera.

- Pen-down candidate at a ratio of `0.30` or lower.
- Pen-up candidate at a ratio of `0.46` or higher.
- Values between those thresholds preserve the current state.

This is a Schmitt-trigger style hysteresis rule with time-based confirmation rather than frame counts:

- Contact must remain below the pen-down threshold for `20ms` before a stroke starts.
- Release must remain above the pen-up threshold for `32ms` before the stroke ends.
- Ink freezes during release confirmation, preventing an opening hand from adding a tail.
- A missing or invalid hand result pauses the stroke for up to `100ms`; reacquisition within that window continues the same stroke.
- Rearming after loss, Clear, or a tracking jump requires a visibly open pinch for `40ms`.

These windows are long enough to reject one noisy inference result while staying below a perceptible click delay. They are based on elapsed media timestamps, so behavior is consistent at different inference frame rates.

Once confirmation begins, ratios in the middle hysteresis band keep accumulating evidence. Only a clear opposite gesture cancels the candidate. This prevents small landmark oscillations from repeatedly restarting the timer.

The gesture state machine is:

```text
no hand -> needs release -> ready -> drawing
    ^          |             ^          |
    |          +-- open -----+-- release+
    +---- sustained tracking loss -------+
                                  |
                       brief loss +-> drawing paused
```

After tracking loss, a jump, or Clear, the user must visibly open the pinch before drawing again. This prevents a still-pinched reacquired hand from drawing a long connection across the canvas.

## Pointer and stroke quality

The index fingertip is the pen position. The thumb only controls the pinch. This avoids the old behavior where opening the thumb moved a thumb/index midpoint and produced trailing ink during release.

Pointer coordinates use a One Euro filter tuned with a `6` minimum cutoff, `2.5` speed coefficient, and `1.5` derivative cutoff. It still suppresses near-rest landmark noise but follows intentional movement more aggressively than the original filter. Pinch detection bypasses this filter, so pointer polish cannot delay pen up. Cursor transforms are applied immediately rather than animated toward each sample.

Additional safeguards:

- Mirrored `x` coordinates match the mirrored camera preview.
- Points are stored from `0..1`, independent of Canvas pixel dimensions.
- Samples closer than `0.75` displayed pixels are ignored to suppress stationary jitter and duplicate points.
- Tracking-jump tolerance grows from `0.16` to at most `0.38` normalized units based on elapsed frame time. This permits legitimate fast motion at low FPS while still rejecting a one-frame teleport.
- Canvas resolution follows its displayed size and device pixel ratio, capped at 2x for a quality/performance balance.
- Two stacked canvases render ink incrementally. Stable quadratic segments are committed once to the base layer; only the short provisional tail is cleared and redrawn for each point. Resize remains a safe full-redraw path from normalized stroke data.
- Canvas and SVG use the same quadratic smoothing geometry, round caps, round joins, and CSS-equivalent stroke width.
- The quill cursor is a separate compositor layer, so hover movement does not clear and redraw all historical ink.

## Failure and cleanup behavior

- Brief hand loss: pause point collection and keep the current stroke alive for `100ms`.
- Sustained hand loss: end the stroke, hide the cursor, and require an open pinch after reacquisition.
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

The Node tests cover stable pinch confirmation, one-frame false release, brief and sustained tracking loss, safe rearming, visible thumb/index measurement, world-landmark fallback, responsive point filtering, bounded aspect-preserving inference frames, incremental canvas commits, FPS-aware motion continuity, teleport rejection, normalized path geometry, CSS-pixel sampling, and SVG output.

Automated tests cannot establish the ideal thresholds for every webcam, hand shape, angle, and lighting condition. Final calibration should record real sessions and compare pinch ratio, inference time, false starts, false releases, and end-of-stroke overshoot before changing the constants.

## Tech stack

- React 19 and Vite
- MediaPipe Tasks Vision
- Web Workers and transferable `ImageBitmap` frames
- WebRTC `getUserMedia`
- HTML Canvas and SVG
- Phosphor Icons
- Vercel Analytics
