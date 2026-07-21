const DEFAULT_STROKE_COLOR = "#1d1c19";
const DEFAULT_EXPORT_COLOR = "black";

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function mapPoint(point, width, height) {
  return {
    x: point.x * width,
    y: point.y * height,
  };
}

function formatNumber(value) {
  return value.toFixed(2);
}

function configureStrokeContext(
  context,
  { color = DEFAULT_STROKE_COLOR, strokeWidthCss = 2 } = {},
) {
  const { canvas } = context;
  const pixelRatio =
    canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const strokeWidth = strokeWidthCss * pixelRatio;

  context.lineWidth = strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.fillStyle = color;

  return strokeWidth;
}

function clearCanvasLayer(canvas) {
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
}

export function getPointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function getPointDistanceCss(a, b, width, height) {
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

export function resizeCanvasToDisplaySize(canvas, maxPixelRatio = 2) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width <= 0 || height <= 0) return false;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
  const nextWidth = Math.max(1, Math.round(width * pixelRatio));
  const nextHeight = Math.max(1, Math.round(height * pixelRatio));

  if (canvas.width === nextWidth && canvas.height === nextHeight) return false;

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  return true;
}

export function drawStroke(
  context,
  stroke,
  options = {},
) {
  if (stroke.length === 0) return;

  const { canvas } = context;
  const points = stroke.map((point) =>
    mapPoint(point, canvas.width, canvas.height),
  );

  context.save();
  const strokeWidth = configureStrokeContext(context, options);

  if (points.length === 1) {
    const [point] = points;
    context.beginPath();
    context.arc(point.x, point.y, strokeWidth / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    context.lineTo(points[1].x, points[1].y);
  } else {
    for (let index = 1; index < points.length - 1; index += 1) {
      const nextMidpoint = midpoint(points[index], points[index + 1]);
      context.quadraticCurveTo(
        points[index].x,
        points[index].y,
        nextMidpoint.x,
        nextMidpoint.y,
      );
    }

    const lastPoint = points.at(-1);
    context.lineTo(lastPoint.x, lastPoint.y);
  }

  context.stroke();
  context.restore();
}

function drawQuadraticSegment(context, start, control, end, options) {
  const { canvas } = context;
  const mappedStart = mapPoint(start, canvas.width, canvas.height);
  const mappedControl = mapPoint(control, canvas.width, canvas.height);
  const mappedEnd = mapPoint(end, canvas.width, canvas.height);

  context.save();
  configureStrokeContext(context, options);
  context.beginPath();
  context.moveTo(mappedStart.x, mappedStart.y);
  context.quadraticCurveTo(
    mappedControl.x,
    mappedControl.y,
    mappedEnd.x,
    mappedEnd.y,
  );
  context.stroke();
  context.restore();
}

function drawLineSegment(context, start, end, options) {
  const { canvas } = context;
  const mappedStart = mapPoint(start, canvas.width, canvas.height);
  const mappedEnd = mapPoint(end, canvas.width, canvas.height);

  context.save();
  configureStrokeContext(context, options);
  context.beginPath();
  context.moveTo(mappedStart.x, mappedStart.y);
  context.lineTo(mappedEnd.x, mappedEnd.y);
  context.stroke();
  context.restore();
}

function drawStableStrokePrefix(context, stroke, options) {
  if (stroke.length < 3) return;

  const { canvas } = context;
  const points = stroke.map((point) =>
    mapPoint(point, canvas.width, canvas.height),
  );

  context.save();
  configureStrokeContext(context, options);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length - 1; index += 1) {
    const nextMidpoint = midpoint(points[index], points[index + 1]);
    context.quadraticCurveTo(
      points[index].x,
      points[index].y,
      nextMidpoint.x,
      nextMidpoint.y,
    );
  }

  context.stroke();
  context.restore();
}

function drawLatestStableSegment(context, stroke, options) {
  if (stroke.length < 3) return;

  const lastIndex = stroke.length - 1;
  const control = stroke[lastIndex - 1];
  const start =
    stroke.length === 3
      ? stroke[0]
      : midpoint(stroke[lastIndex - 2], control);
  const end = midpoint(control, stroke[lastIndex]);

  drawQuadraticSegment(context, start, control, end, options);
}

function drawStrokeTail(context, stroke, options) {
  if (stroke.length < 3) {
    drawStroke(context, stroke, options);
    return;
  }

  const lastPoint = stroke.at(-1);
  const tailStart = midpoint(stroke.at(-2), lastPoint);
  drawLineSegment(context, tailStart, lastPoint, options);
}

export function redrawCanvas(canvas, strokes, currentStroke, options) {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const stroke of strokes) {
    drawStroke(context, stroke, options);
  }

  drawStroke(context, currentStroke, options);
}

export class IncrementalStrokeRenderer {
  constructor(canvas, liveCanvas, options = {}) {
    this.canvas = canvas;
    this.liveCanvas = liveCanvas ?? canvas;
    this.options = options;
    this.layered = this.liveCanvas !== this.canvas;
  }

  resize() {
    const baseResized = resizeCanvasToDisplaySize(this.canvas);
    const liveResized = this.layered
      ? resizeCanvasToDisplaySize(this.liveCanvas)
      : false;

    return baseResized || liveResized;
  }

  clear() {
    clearCanvasLayer(this.canvas);
    if (this.layered) clearCanvasLayer(this.liveCanvas);
  }

  redraw(strokes, currentStroke) {
    if (!this.layered) {
      redrawCanvas(this.canvas, strokes, currentStroke, this.options);
      return;
    }

    redrawCanvas(this.canvas, strokes, [], this.options);
    clearCanvasLayer(this.liveCanvas);

    const baseContext = this.canvas.getContext("2d");
    const liveContext = this.liveCanvas.getContext("2d");
    if (!baseContext || !liveContext) return;

    drawStableStrokePrefix(baseContext, currentStroke, this.options);
    drawStrokeTail(liveContext, currentStroke, this.options);
  }

  startStroke(strokes, currentStroke) {
    if (!this.layered) {
      redrawCanvas(this.canvas, strokes, currentStroke, this.options);
      return;
    }

    clearCanvasLayer(this.liveCanvas);
    const context = this.liveCanvas.getContext("2d");
    if (context) drawStroke(context, currentStroke, this.options);
  }

  appendPoint(strokes, currentStroke) {
    if (!this.layered) {
      redrawCanvas(this.canvas, strokes, currentStroke, this.options);
      return;
    }

    const baseContext = this.canvas.getContext("2d");
    const liveContext = this.liveCanvas.getContext("2d");
    if (!baseContext || !liveContext) return;

    drawLatestStableSegment(baseContext, currentStroke, this.options);
    clearCanvasLayer(this.liveCanvas);
    drawStrokeTail(liveContext, currentStroke, this.options);
  }

  finishStroke(strokes, currentStroke) {
    if (currentStroke.length === 0) return;

    if (!this.layered) {
      redrawCanvas(this.canvas, strokes, currentStroke, this.options);
      return;
    }

    const context = this.canvas.getContext("2d");
    clearCanvasLayer(this.liveCanvas);
    if (!context) return;

    if (currentStroke.length < 3) {
      drawStroke(context, currentStroke, this.options);
    } else {
      drawStrokeTail(context, currentStroke, this.options);
    }
  }
}

export function getStrokePathData(stroke, width, height) {
  if (stroke.length === 0) return "";

  const points = stroke.map((point) => mapPoint(point, width, height));
  const commands = [
    `M ${formatNumber(points[0].x)} ${formatNumber(points[0].y)}`,
  ];

  if (points.length === 1) return commands[0];

  if (points.length === 2) {
    commands.push(
      `L ${formatNumber(points[1].x)} ${formatNumber(points[1].y)}`,
    );
    return commands.join(" ");
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const nextMidpoint = midpoint(points[index], points[index + 1]);
    commands.push(
      `Q ${formatNumber(points[index].x)} ${formatNumber(points[index].y)} ${formatNumber(nextMidpoint.x)} ${formatNumber(nextMidpoint.y)}`,
    );
  }

  const lastPoint = points.at(-1);
  commands.push(
    `L ${formatNumber(lastPoint.x)} ${formatNumber(lastPoint.y)}`,
  );
  return commands.join(" ");
}

function buildStrokeSvg(stroke, width, height, strokeWidth, color) {
  if (stroke.length === 0) return "";

  if (stroke.length === 1) {
    const point = mapPoint(stroke[0], width, height);
    return `<circle cx="${formatNumber(point.x)}" cy="${formatNumber(point.y)}" r="${formatNumber(strokeWidth / 2)}" fill="${color}" />`;
  }

  return `<path d="${getStrokePathData(stroke, width, height)}" stroke="${color}" stroke-width="${formatNumber(strokeWidth)}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
}

export function buildSignatureSvg(
  strokes,
  {
    aspectRatio,
    sourceWidthCss,
    strokeWidthCss = 2,
    color = DEFAULT_EXPORT_COLOR,
    width = 1000,
  },
) {
  const safeAspectRatio =
    Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 10;
  const height = Math.round(width / safeAspectRatio);
  const safeSourceWidth = Math.max(sourceWidthCss || width, 1);
  const strokeWidth = strokeWidthCss * (width / safeSourceWidth);
  const elements = strokes
    .map((stroke) => buildStrokeSvg(stroke, width, height, strokeWidth, color))
    .filter(Boolean)
    .join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    ${elements}
  </svg>`;
}
