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
  { color = DEFAULT_STROKE_COLOR, strokeWidthCss = 2 } = {},
) {
  if (stroke.length === 0) return;

  const { canvas } = context;
  const pixelRatio =
    canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
  const strokeWidth = strokeWidthCss * pixelRatio;
  const points = stroke.map((point) =>
    mapPoint(point, canvas.width, canvas.height),
  );

  context.save();
  context.lineWidth = strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.fillStyle = color;

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

export function redrawCanvas(canvas, strokes, currentStroke, options) {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const stroke of strokes) {
    drawStroke(context, stroke, options);
  }

  drawStroke(context, currentStroke, options);
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
