import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildSignatureSvg,
  getPointDistanceCss,
  getStrokePathData,
  IncrementalStrokeRenderer,
} from "../src/airInk/strokeGeometry.js";

function createRecordingCanvas() {
  const calls = [];
  const canvas = {
    clientWidth: 1000,
    clientHeight: 625,
    width: 1000,
    height: 625,
  };
  const context = {
    canvas,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    clearRect: () => calls.push("clearRect"),
    beginPath: () => calls.push("beginPath"),
    arc: () => calls.push("arc"),
    fill: () => calls.push("fill"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    quadraticCurveTo: () => calls.push("quadraticCurveTo"),
    stroke: () => calls.push("stroke"),
  };

  canvas.getContext = () => context;
  return { canvas, calls };
}

describe("normalized stroke geometry", () => {
  test("maps the same stroke to any output size", () => {
    const stroke = [
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.6 },
    ];

    assert.equal(
      getStrokePathData(stroke, 1000, 500),
      "M 100.00 100.00 L 500.00 300.00",
    );
  });

  test("measures sampling distance in displayed CSS pixels", () => {
    const distance = getPointDistanceCss(
      { x: 0.1, y: 0.2 },
      { x: 0.11, y: 0.22 },
      1000,
      500,
    );

    assert.ok(Math.abs(distance - Math.sqrt(200)) < 0.0001);
  });

  test("exports paths and dots with a resize-independent viewBox", () => {
    const svg = buildSignatureSvg(
      [
        [{ x: 0.25, y: 0.5 }],
        [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.8 },
        ],
      ],
      {
        aspectRatio: 16 / 10,
        sourceWidthCss: 500,
        strokeWidthCss: 2,
      },
    );

    assert.match(svg, /viewBox="0 0 1000 625"/);
    assert.match(svg, /<circle cx="250\.00" cy="312\.50"/);
    assert.match(svg, /stroke-width="4\.00"/);
    assert.match(svg, /M 100\.00 125\.00 L 900\.00 500\.00/);
  });
});

describe("incremental stroke rendering", () => {
  test("commits only stable segments without clearing completed ink", () => {
    const base = createRecordingCanvas();
    const live = createRecordingCanvas();
    const renderer = new IncrementalStrokeRenderer(base.canvas, live.canvas);
    const stroke = [{ x: 0.1, y: 0.2 }];

    renderer.startStroke([], stroke);
    stroke.push({ x: 0.2, y: 0.3 });
    renderer.appendPoint([], stroke);
    stroke.push({ x: 0.3, y: 0.35 });
    renderer.appendPoint([], stroke);
    stroke.push({ x: 0.4, y: 0.4 });
    renderer.appendPoint([], stroke);

    assert.equal(
      base.calls.filter((call) => call === "quadraticCurveTo").length,
      2,
    );
    assert.equal(
      base.calls.filter((call) => call === "clearRect").length,
      0,
    );
    assert.ok(
      live.calls.filter((call) => call === "clearRect").length >= 3,
    );

    renderer.finishStroke([], stroke);
    assert.equal(
      base.calls.filter((call) => call === "lineTo").length,
      1,
    );
  });
});
