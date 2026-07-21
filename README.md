# Air Ink

Air Ink is a gesture-based signature studio that lets users draw on a canvas with one hand and export the result as an SVG. A webcam pinch gesture acts as pen down and pen up in real time.

## What it does

- Tracks hand landmarks from a live webcam feed
- Detects a thumb-and-index-finger pinch to start and stop drawing
- Maps normalized hand coordinates onto an HTML canvas
- Keeps camera processing local to the browser
- Clears the current drawing or exports it as a scalable SVG

## How it works

Each video frame is processed by MediaPipe Tasks Vision. The app compares the distance between the thumb tip and index fingertip against the size of the detected palm, which keeps pinch detection stable across different distances from the camera. Hysteresis, smoothing, and release grace frames prevent noisy landmark readings from breaking a stroke.

Continuous gesture and drawing state live in React refs so frame-by-frame updates do not re-render the component tree. React state is reserved for visible interface changes such as camera readiness, interaction status, errors, and export feedback.

## Tech stack

- React 19 and Vite
- MediaPipe Tasks Vision
- WebRTC `getUserMedia`
- HTML Canvas and SVG
- Phosphor Icons
- Vercel Analytics
