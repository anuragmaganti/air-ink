import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

let handLandmarker = null;

function serializeLandmarks(landmarks) {
  if (!landmarks) return null;

  return landmarks.map(({ x, y, z }) => ({ x, y, z }));
}

function postWorkerError(scope, error, frame = {}) {
  self.postMessage({
    type: "error",
    scope,
    message: error instanceof Error ? error.message : String(error),
    ...frame,
  });
}

self.addEventListener("message", async (event) => {
  const message = event.data;

  if (message.type === "init") {
    try {
      const vision = await FilesetResolver.forVisionTasks(message.wasmUrl, true);
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: message.modelUrl },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      postWorkerError("init", error);
    }
    return;
  }

  if (message.type === "frame") {
    const { bitmap, frameId, runId, timestamp } = message;
    const startedAt = performance.now();

    try {
      if (!handLandmarker) throw new Error("Hand tracker is not initialized.");

      const result = handLandmarker.detectForVideo(bitmap, timestamp);
      const handedness = result.handedness?.[0]?.[0] ?? null;

      self.postMessage({
        type: "result",
        frameId,
        runId,
        timestamp,
        inferenceDuration: performance.now() - startedAt,
        landmarks: serializeLandmarks(result.landmarks?.[0]),
        worldLandmarks: serializeLandmarks(result.worldLandmarks?.[0]),
        handedness: handedness
          ? { categoryName: handedness.categoryName, score: handedness.score }
          : null,
      });
    } catch (error) {
      postWorkerError("frame", error, { frameId, runId });
    } finally {
      bitmap.close();
    }
    return;
  }

  if (message.type === "close") {
    handLandmarker?.close?.();
    handLandmarker = null;
    self.close();
  }
});
