import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildSignatureSvg,
  getPointDistanceCss,
  getStrokePathData,
} from "../src/airInk/strokeGeometry.js";

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
