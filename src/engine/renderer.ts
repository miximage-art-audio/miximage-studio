import { computeFitGeometry } from './dsp';
import {
  COLOR_THEMES,
  ColorThemeKey,
  FitMode,
  WaveformLayoutConfig,
  WaveformStyle,
  getDefaultWaveformLayout,
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
    const pad = blurScale * 2;
    ctx.drawImage(
      img,
      geom.cover.x - pad,
      geom.cover.y - pad,
      geom.cover.w + pad * 2,
      geom.cover.h + pad * 2
    );
    ctx.restore();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(0, 0, targetW, targetH);

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
 * Renders a single frame onto `targetCtx` with Bass-Sync Physics + 64-band Neon Bloom Waveform (8 styles)
 * with customizable position, scale, and opacity.
 */
export function renderStudioFrame(
  targetCtx: CanvasRenderingContext2D,
  surface: RenderSurface,
  specCol: Float32Array | number[],
  bassVal: number,
  style: WaveformStyle,
  themeKey: ColorThemeKey,
  intensityMult: number,
  frameSeed = 0,
  layout?: WaveformLayoutConfig
): void {
  const { width: w, height: h, baseCanvas, overlayCanvas, glowCanvas } = surface;
  const theme = COLOR_THEMES[themeKey] ?? COLOR_THEMES.cyberpunk;
  const c1 = theme.c1Rgb;
  const c2 = theme.c2Rgb;
  const wfLayout = layout ?? getDefaultWaveformLayout(style);

  // 1. Bass-Sync Physics Engine (Zoom Punch + Directional Micro-Shake + Luminance Flash)
  const zoom = 1.0 + bassVal * 0.1 * intensityMult;
  const scaleFactor = Math.min(w, h) / 1080;
  const shakePx = bassVal > 0.45 ? Math.floor(bassVal * 14 * intensityMult * scaleFactor) : 0;

  let dx = 0;
  let dy = 0;
  if (shakePx > 0) {
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

  targetCtx.translate(w / 2 + dx, h / 2 + dy);
  targetCtx.scale(zoom, zoom);
  targetCtx.translate(-w / 2, -h / 2);

  targetCtx.drawImage(baseCanvas, 0, 0, w, h);

  if (bassVal > 0.3 && intensityMult > 0) {
    const k = Math.min(0.6, (bassVal - 0.3) * 0.25 * intensityMult);
    targetCtx.globalCompositeOperation = 'lighter';
    targetCtx.globalAlpha = k;
    targetCtx.drawImage(baseCanvas, 0, 0, w, h);
  }
  targetCtx.restore();

  if (wfLayout.opacity <= 0.001) {
    return;
  }

  // 2. Draw 64-band Waveform onto transparent overlayCanvas centered on (anchorX, anchorY) with scale
  const oCtx = overlayCanvas.getContext('2d')!;
  oCtx.clearRect(0, 0, w, h);
  const nBars = specCol.length;
  const anchorX = w * wfLayout.posX;
  const anchorY = h * wfLayout.posY;

  oCtx.save();
  oCtx.translate(anchorX, anchorY);
  oCtx.scale(wfLayout.scale, wfLayout.scale);

  if (style === 'neon_bars') {
    const barAreaW = w * 0.82;
    const startX = -barAreaW / 2;
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
      oCtx.fillRect(x, -bh, barW, bh + bh * 0.35);

      oCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      oCtx.fillRect(
        x,
        -bh - Math.max(2, 2.5 * scaleFactor),
        barW,
        Math.max(1.5, 2 * scaleFactor)
      );
    }
  } else if (style === 'smooth_wave') {
    const maxAmp = h * 0.15;
    const spanW = w * 0.84;
    const xStart = -spanW / 2;
    const xEnd = spanW / 2;
    const dxStep = spanW / Math.max(1, nBars - 1);

    const topPts: Array<[number, number]> = [];
    const botPts: Array<[number, number]> = [];
    for (let i = 0; i < nBars; i++) {
      const val = specCol[i] ?? 0;
      const amp = Math.pow(val, 1.25) * maxAmp * (1.0 + bassVal * 0.3);
      const x = xStart + i * dxStep;
      topPts.push([x, -amp]);
      botPts.push([x, amp * 0.45]);
    }

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

      const x1 = Math.cos(angle) * baseR;
      const y1 = Math.sin(angle) * baseR;
      const x2 = Math.cos(angle) * (baseR + length);
      const y2 = Math.sin(angle) * (baseR + length);

      oCtx.strokeStyle = rgbStr(col);
      oCtx.beginPath();
      oCtx.moveTo(x1, y1);
      oCtx.lineTo(x2, y2);
      oCtx.stroke();
    }

    oCtx.beginPath();
    oCtx.arc(0, 0, baseR, 0, Math.PI * 2);
    oCtx.strokeStyle = rgbStr(c1);
    oCtx.lineWidth = Math.max(2, 3 * scaleFactor);
    oCtx.stroke();
  } else if (style === 'mirror_horizon') {
    // 4. Symmetrical Horizon: Equal top & bottom mirrored spectrum bars + center horizon beam
    const barAreaW = w * 0.84;
    const startX = -barAreaW / 2;
    const maxHalfH = h * 0.13;
    const step = barAreaW / nBars;
    const barW = Math.max(2, step * 0.58);

    const lineGrad = oCtx.createLinearGradient(startX, 0, -startX, 0);
    lineGrad.addColorStop(0, rgbStr(c1, 0.9));
    lineGrad.addColorStop(1, rgbStr(c2, 0.9));
    oCtx.fillStyle = lineGrad;
    oCtx.fillRect(startX, -Math.max(1, 1.5 * scaleFactor), barAreaW, Math.max(2, 3 * scaleFactor));

    for (let i = 0; i < nBars; i++) {
      const val = specCol[i] ?? 0;
      const ratio = i / Math.max(1, nBars - 1);
      const col = lerpColor(c1, c2, ratio);
      const halfH = Math.max(
        3 * scaleFactor,
        Math.pow(val, 1.28) * maxHalfH * (1.0 + bassVal * 0.35)
      );
      const x = startX + i * step;

      oCtx.fillStyle = rgbStr(col);
      oCtx.fillRect(x, -halfH, barW, halfH * 2);
    }
  } else if (style === 'pulse_rings') {
    // 5. Concentric Pulse Rings: 3 harmonic frequency-modulated rings (Bass, Mid, High)
    const minDim = Math.min(w, h);
    const bandSlices = [
      { start: 0, end: 18, baseR: minDim * 0.12, ampScale: minDim * 0.045, col: c1, lw: 3.5 },
      { start: 18, end: 42, baseR: minDim * 0.21, ampScale: minDim * 0.055, col: lerpColor(c1, c2, 0.5), lw: 3.0 },
      { start: 42, end: 64, baseR: minDim * 0.30, ampScale: minDim * 0.05, col: c2, lw: 2.5 },
    ];

    const ptsCount = 72;
    for (let rIdx = 0; rIdx < bandSlices.length; rIdx++) {
      const ring = bandSlices[rIdx];
      const pulseR = ring.baseR * (1.0 + bassVal * (0.22 - rIdx * 0.04));
      oCtx.beginPath();
      for (let p = 0; p <= ptsCount; p++) {
        const t = p / ptsCount;
        const angle = t * Math.PI * 2;
        const bandPos =
          ring.start + ((p % ptsCount) / ptsCount) * (ring.end - ring.start);
        const b0 = Math.floor(bandPos) % nBars;
        const b1 = (b0 + 1) % nBars;
        const frac = bandPos - Math.floor(bandPos);
        const val = (specCol[b0] ?? 0) * (1 - frac) + (specCol[b1] ?? 0) * frac;
        const radius = pulseR + Math.pow(val, 1.2) * ring.ampScale;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (p === 0) oCtx.moveTo(x, y);
        else oCtx.lineTo(x, y);
      }
      oCtx.closePath();
      oCtx.strokeStyle = rgbStr(ring.col);
      oCtx.lineWidth = Math.max(2, ring.lw * scaleFactor);
      oCtx.stroke();
    }
  } else if (style === 'particle_burst') {
    // 6. Particle Burst: 64 radial glowing nodes + inner energy core + connecting rays
    const minDim = Math.min(w, h);
    const innerR = minDim * 0.11 * (1.0 + bassVal * 0.24);
    const maxDist = minDim * 0.24;
    const rotOffset = frameSeed * 0.012;

    oCtx.beginPath();
    oCtx.arc(0, 0, innerR, 0, Math.PI * 2);
    oCtx.strokeStyle = rgbStr(c1, 0.85);
    oCtx.lineWidth = Math.max(2, 2.5 * scaleFactor);
    oCtx.stroke();

    for (let i = 0; i < nBars; i++) {
      const val = specCol[i] ?? 0;
      const ratio = i / Math.max(1, nBars - 1);
      const col = lerpColor(c1, c2, ratio);
      const angle = (i * 2 * Math.PI) / nBars + rotOffset;
      const dist = innerR + Math.pow(val, 1.25) * maxDist * (1.0 + bassVal * 0.25);

      const x1 = Math.cos(angle) * innerR;
      const y1 = Math.sin(angle) * innerR;
      const x2 = Math.cos(angle) * dist;
      const y2 = Math.sin(angle) * dist;

      oCtx.strokeStyle = rgbStr(col, 0.45);
      oCtx.lineWidth = Math.max(1, 1.8 * scaleFactor);
      oCtx.beginPath();
      oCtx.moveTo(x1, y1);
      oCtx.lineTo(x2, y2);
      oCtx.stroke();

      const dotR = Math.max(2.5, (3.5 + val * 6.5) * scaleFactor);
      oCtx.fillStyle = rgbStr(col);
      oCtx.beginPath();
      oCtx.arc(x2, y2, dotR, 0, Math.PI * 2);
      oCtx.fill();

      oCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      oCtx.beginPath();
      oCtx.arc(x2, y2, dotR * 0.42, 0, Math.PI * 2);
      oCtx.fill();
    }
  } else if (style === 'dual_ribbon') {
    // 7. Dual Harmonic Ribbon: Two intertwined phase-shifted neon spline curves
    const spanW = w * 0.86;
    const xStart = -spanW / 2;
    const maxAmp = h * 0.14;
    const dxStep = spanW / Math.max(1, nBars - 1);

    const drawRibbon = (phaseSign: number, color: [number, number, number], lw: number) => {
      oCtx.beginPath();
      for (let i = 0; i < nBars; i++) {
        const val = specCol[i] ?? 0;
        const x = xStart + i * dxStep;
        const waveMod = Math.sin(i * 0.35 + frameSeed * 0.15 * phaseSign);
        const y =
          phaseSign *
          Math.pow(val, 1.15) *
          maxAmp *
          (0.65 + 0.35 * waveMod) *
          (1.0 + bassVal * 0.32);
        if (i === 0) {
          oCtx.moveTo(x, y);
        } else {
          const prevX = xStart + (i - 1) * dxStep;
          const prevVal = specCol[i - 1] ?? 0;
          const prevWave = Math.sin((i - 1) * 0.35 + frameSeed * 0.15 * phaseSign);
          const prevY =
            phaseSign *
            Math.pow(prevVal, 1.15) *
            maxAmp *
            (0.65 + 0.35 * prevWave) *
            (1.0 + bassVal * 0.32);
          const xc = (prevX + x) / 2;
          const yc = (prevY + y) / 2;
          oCtx.quadraticCurveTo(prevX, prevY, xc, yc);
        }
      }
      oCtx.strokeStyle = rgbStr(color);
      oCtx.lineWidth = Math.max(2.5, lw * scaleFactor);
      oCtx.lineCap = 'round';
      oCtx.stroke();
    };

    drawRibbon(-1, c1, 4.5);
    drawRibbon(1, c2, 4.0);
  } else if (style === 'matrix_blocks') {
    // 8. Matrix LED Blocks: Stacked segmented equalizer cells per band
    const barAreaW = w * 0.84;
    const startX = -barAreaW / 2;
    const maxBlocks = 14;
    const totalH = h * 0.22;
    const step = barAreaW / nBars;
    const blockW = Math.max(2, step * 0.64);
    const cellStep = totalH / maxBlocks;
    const blockH = Math.max(2, cellStep * 0.68);

    for (let i = 0; i < nBars; i++) {
      const val = specCol[i] ?? 0;
      const ratio = i / Math.max(1, nBars - 1);
      const col = lerpColor(c1, c2, ratio);
      const activeCount = Math.max(
        1,
        Math.min(maxBlocks, Math.round(Math.pow(val, 1.2) * maxBlocks * (1.0 + bassVal * 0.25)))
      );
      const x = startX + i * step;

      for (let b = 0; b < activeCount; b++) {
        const y = -b * cellStep - blockH;
        const isPeak = b === activeCount - 1;
        oCtx.fillStyle = isPeak ? 'rgba(255, 255, 255, 0.92)' : rgbStr(col);
        oCtx.fillRect(x, y, blockW, blockH);
      }
    }
  }

  oCtx.restore();

  // 3. 2-Layer Additive Neon Bloom Glow scaled by user opacity
  const gCtx = glowCanvas.getContext('2d')!;
  gCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  gCtx.save();
  const glowBlur = Math.max(3, Math.round(12 * (glowCanvas.width / w) * scaleFactor * 3));
  gCtx.filter = `blur(${glowBlur}px)`;
  gCtx.drawImage(overlayCanvas, 0, 0, glowCanvas.width, glowCanvas.height);
  gCtx.restore();

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'lighter';
  targetCtx.globalAlpha = 0.85 * wfLayout.opacity;
  targetCtx.drawImage(glowCanvas, 0, 0, w, h);
  targetCtx.globalAlpha = 0.95 * wfLayout.opacity;
  targetCtx.drawImage(overlayCanvas, 0, 0, w, h);
  targetCtx.restore();
}
