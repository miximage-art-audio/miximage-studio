import { computeFitGeometry } from './dsp';
import {
  COLOR_THEMES,
  ColorThemeKey,
  FitMode,
  WaveformStyle,
} from './presets';

export interface RenderSurface {
  baseCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  glowCanvas: HTMLCanvasElement;
  workCanvas: HTMLCanvasElement;
  width: number;
  height: number;
}

function rgbStr(c: [number, number, number], alpha = 1): string {
  return alpha >= 1
    ? `rgb(${c[0]}, ${c[1]}, ${c[2]})`
    : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

function lerpColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(c1[0] * (1 - t) + c2[0] * t),
    Math.round(c1[1] * (1 - t) + c2[1] * t),
    Math.round(c1[2] * (1 - t) + c2[2] * t),
  ];
}

/**
 * Prepares the offscreen base canvas implementing both `cover` and `blur_pad` modes.
 */
export function createRenderSurface(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
  fitMode: FitMode
): RenderSurface {
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = targetW;
  baseCanvas.height = targetH;
  const ctx = baseCanvas.getContext('2d')!;

  const srcW = img.naturalWidth || img.width || targetW;
  const srcH = img.naturalHeight || img.height || targetH;
  const geom = computeFitGeometry(srcW, srcH, targetW, targetH);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (fitMode === 'cover') {
    ctx.drawImage(img, geom.cover.x, geom.cover.y, geom.cover.w, geom.cover.h);
  } else {
    // blur_pad: Gaussian blurred cover background dimmed by 55% (0.45 brightness) + centered full image
    const blurScale = Math.max(12, Math.round(Math.min(targetW, targetH) * 0.032));
    ctx.save();
    ctx.filter = `blur(${blurScale}px) brightness(0.45)`;
    // Slightly overscale during blur to avoid transparent edges
    const pad = blurScale * 2;
    ctx.drawImage(
      img,
      geom.cover.x - pad,
      geom.cover.y - pad,
      geom.cover.w + pad * 2,
      geom.cover.h + pad * 2
    );
    ctx.restore();

    // Subtle dark vignette around centered artwork for crisp separation
    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(0, 0, targetW, targetH);

    // Draw crisp uncropped foreground artwork centered
    ctx.drawImage(
      img,
      geom.contain.x,
      geom.contain.y,
      geom.contain.w,
      geom.contain.h
    );
  }

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = targetW;
  overlayCanvas.height = targetH;

  const glowCanvas = document.createElement('canvas');
  // Quarter-res glow buffer keeps Gaussian bloom fast and smooth
  glowCanvas.width = Math.max(96, Math.round(targetW / 4));
  glowCanvas.height = Math.max(96, Math.round(targetH / 4));

  const workCanvas = document.createElement('canvas');
  workCanvas.width = targetW;
  workCanvas.height = targetH;

  return {
    baseCanvas,
    overlayCanvas,
    glowCanvas,
    workCanvas,
    width: targetW,
    height: targetH,
  };
}

/**
 * Renders a single frame onto `targetCtx` with Bass-Sync Physics + 64-band Neon Bloom Waveform.
 */
export function renderStudioFrame(
  targetCtx: CanvasRenderingContext2D,
  surface: RenderSurface,
  specCol: Float32Array | number[],
  bassVal: number,
  style: WaveformStyle,
  themeKey: ColorThemeKey,
  intensityMult: number,
  frameSeed = 0
): void {
  const { width: w, height: h, baseCanvas, overlayCanvas, glowCanvas } = surface;
  const theme = COLOR_THEMES[themeKey] ?? COLOR_THEMES.cyberpunk;
  const c1 = theme.c1Rgb;
  const c2 = theme.c2Rgb;

  // 1. Bass-Sync Physics Engine (Zoom Punch + Directional Micro-Shake + Luminance Flash)
  const zoom = 1.0 + bassVal * 0.1 * intensityMult;
  const scaleFactor = Math.min(w, h) / 1080;
  const shakePx = bassVal > 0.45 ? Math.floor(bassVal * 14 * intensityMult * scaleFactor) : 0;

  let dx = 0;
  let dy = 0;
  if (shakePx > 0) {
    // Deterministic per-frame pseudo-random offset for reproducible playback & exports
    const s1 = Math.sin((frameSeed + 1) * 12.9898) * 43758.5453;
    const s2 = Math.sin((frameSeed + 1) * 78.233) * 43758.5453;
    const r1 = (s1 - Math.floor(s1)) * 2 - 1;
    const r2 = (s2 - Math.floor(s2)) * 2 - 1;
    dx = Math.round(r1 * shakePx);
    dy = Math.round(r2 * shakePx);
  }

  targetCtx.save();
  targetCtx.fillStyle = '#090D16';
  targetCtx.fillRect(0, 0, w, h);

  // Apply Zoom Punch + Micro-Shake around center
  targetCtx.translate(w / 2 + dx, h / 2 + dy);
  targetCtx.scale(zoom, zoom);
  targetCtx.translate(-w / 2, -h / 2);

  targetCtx.drawImage(baseCanvas, 0, 0, w, h);

  // Apply Bass Flash Boost when bassVal > 0.3 via exact additive self-composite: rgb * (1 + k) = rgb + k * rgb
  if (bassVal > 0.3) {
    const k = Math.min(0.6, (bassVal - 0.3) * 0.25 * intensityMult);
    targetCtx.globalCompositeOperation = 'lighter';
    targetCtx.globalAlpha = k;
    targetCtx.drawImage(baseCanvas, 0, 0, w, h);
  }
  targetCtx.restore();

  // 2. Draw 64-band Waveform onto transparent overlayCanvas
  const oCtx = overlayCanvas.getContext('2d')!;
  oCtx.clearRect(0, 0, w, h);
  const nBars = specCol.length;

  if (style === 'neon_bars') {
    const barAreaW = w * 0.82;
    const startX = (w - barAreaW) / 2;
    const baseY = h * 0.84;
    const maxBarH = h * 0.16;
    const step = barAreaW / nBars;
    const barW = Math.max(2, step * 0.6);

    for (let i = 0; i < nBars; i++) {
      const val = specCol[i] ?? 0;
      const ratio = i / Math.max(1, nBars - 1);
      const col = lerpColor(c1, c2, ratio);
      const bh = Math.max(
        4 * scaleFactor,
        Math.pow(val, 1.3) * maxBarH * (1.0 + bassVal * 0.35)
      );
      const x = startX + i * step;

      oCtx.fillStyle = rgbStr(col);
      oCtx.fillRect(x, baseY - bh, barW, bh + bh * 0.35);

      // Crisp peak cap accent
      oCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      oCtx.fillRect(x, baseY - bh - Math.max(2, 2.5 * scaleFactor), barW, Math.max(1.5, 2 * scaleFactor));
    }
  } else if (style === 'smooth_wave') {
    const baseY = h * 0.84;
    const maxAmp = h * 0.15;
    const xStart = w * 0.08;
    const xEnd = w * 0.92;
    const dxStep = (xEnd - xStart) / Math.max(1, nBars - 1);

    const topPts: Array<[number, number]> = [];
    const botPts: Array<[number, number]> = [];
    for (let i = 0; i < nBars; i++) {
      const val = specCol[i] ?? 0;
      const amp = Math.pow(val, 1.25) * maxAmp * (1.0 + bassVal * 0.3);
      const x = xStart + i * dxStep;
      topPts.push([x, baseY - amp]);
      botPts.push([x, baseY + amp * 0.45]);
    }

    // Translucent gradient fill
    const grad = oCtx.createLinearGradient(xStart, 0, xEnd, 0);
    grad.addColorStop(0, rgbStr(c1, 0.65));
    grad.addColorStop(1, rgbStr(c2, 0.75));

    oCtx.beginPath();
    oCtx.moveTo(topPts[0][0], topPts[0][1]);
    for (let i = 1; i < topPts.length - 1; i++) {
      const xc = (topPts[i][0] + topPts[i + 1][0]) / 2;
      const yc = (topPts[i][1] + topPts[i + 1][1]) / 2;
      oCtx.quadraticCurveTo(topPts[i][0], topPts[i][1], xc, yc);
    }
    oCtx.lineTo(topPts[topPts.length - 1][0], topPts[topPts.length - 1][1]);
    for (let i = botPts.length - 1; i >= 0; i--) {
      oCtx.lineTo(botPts[i][0], botPts[i][1]);
    }
    oCtx.closePath();
    oCtx.fillStyle = grad;
    oCtx.fill();

    // Glowing top stroke
    const strokeGrad = oCtx.createLinearGradient(xStart, 0, xEnd, 0);
    strokeGrad.addColorStop(0, rgbStr(c1, 1));
    strokeGrad.addColorStop(1, rgbStr(c2, 1));
    oCtx.beginPath();
    oCtx.moveTo(topPts[0][0], topPts[0][1]);
    for (let i = 1; i < topPts.length - 1; i++) {
      const xc = (topPts[i][0] + topPts[i + 1][0]) / 2;
      const yc = (topPts[i][1] + topPts[i + 1][1]) / 2;
      oCtx.quadraticCurveTo(topPts[i][0], topPts[i][1], xc, yc);
    }
    oCtx.lineTo(topPts[topPts.length - 1][0], topPts[topPts.length - 1][1]);
    oCtx.strokeStyle = strokeGrad;
    oCtx.lineWidth = Math.max(2.5, 4 * scaleFactor);
    oCtx.lineCap = 'round';
    oCtx.stroke();
  } else if (style === 'circular_core') {
    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) * 0.18 * (1.0 + bassVal * 0.22);
    const maxLen = Math.min(w, h) * 0.16;

    oCtx.lineWidth = Math.max(2.5, 4 * scaleFactor);
    oCtx.lineCap = 'round';

    for (let i = 0; i < nBars; i++) {
      const angle = (i * 2 * Math.PI) / nBars;
      const ratio = i / Math.max(1, nBars - 1);
      const col = lerpColor(c1, c2, ratio);
      const val = specCol[i] ?? 0;
      const length = Math.max(4 * scaleFactor, Math.pow(val, 1.3) * maxLen);

      const x1 = cx + Math.cos(angle) * baseR;
      const y1 = cy + Math.sin(angle) * baseR;
      const x2 = cx + Math.cos(angle) * (baseR + length);
      const y2 = cy + Math.sin(angle) * (baseR + length);

      oCtx.strokeStyle = rgbStr(col);
      oCtx.beginPath();
      oCtx.moveTo(x1, y1);
      oCtx.lineTo(x2, y2);
      oCtx.stroke();
    }

    oCtx.beginPath();
    oCtx.arc(cx, cy, baseR, 0, Math.PI * 2);
    oCtx.strokeStyle = rgbStr(c1);
    oCtx.lineWidth = Math.max(2, 3 * scaleFactor);
    oCtx.stroke();
  }

  // 3. 2-Layer Additive Neon Bloom Glow (fast quarter-res blur pass)
  const gCtx = glowCanvas.getContext('2d')!;
  gCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  gCtx.save();
  const glowBlur = Math.max(3, Math.round(12 * (glowCanvas.width / w) * scaleFactor * 3));
  gCtx.filter = `blur(${glowBlur}px)`;
  gCtx.drawImage(overlayCanvas, 0, 0, glowCanvas.width, glowCanvas.height);
  gCtx.restore();

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'lighter';
  targetCtx.globalAlpha = 0.85;
  targetCtx.drawImage(glowCanvas, 0, 0, w, h);
  targetCtx.globalAlpha = 0.95;
  targetCtx.drawImage(overlayCanvas, 0, 0, w, h);
  targetCtx.restore();
}
