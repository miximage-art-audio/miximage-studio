import { computeFitGeometry } from './dsp';
import {
  COLOR_THEMES,
  ColorThemeKey,
  FitMode,
  WaveformColorMix,
  WaveformLayoutConfig,
  WaveformStyle,
  getDefaultWaveformLayout,
  hexToRgb,
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

function sampleColor3(
  c1: [number, number, number],
  cMid: [number, number, number],
  c2: [number, number, number],
  u: number
): [number, number, number] {
  const t = Math.max(0, Math.min(1, u));
  if (t <= 0.5) {
    return lerpColor(c1, cMid, t * 2);
  }
  return lerpColor(cMid, c2, (t - 0.5) * 2);
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

function sampleSpec(specCol: Float32Array | number[], u: number): number {
  const n = specCol.length;
  if (n === 0) return 0;
  const clamped = Math.max(0, Math.min(1, u));
  const pos = clamped * (n - 1);
  const i0 = Math.floor(pos);
  const i1 = Math.min(n - 1, i0 + 1);
  const t = pos - i0;
  const smoothT = t * t * (3 - 2 * t);
  return (specCol[i0] ?? 0) * (1 - smoothT) + (specCol[i1] ?? 0) * smoothT;
}

function taperEnvelope(u: number): number {
  // Smooth bell taper at far left & right edges so waves look clean like studio graphics
  return Math.sin(Math.max(0, Math.min(1, u)) * Math.PI) * 0.65 + 0.35;
}

/**
 * Renders a single frame onto `targetCtx` with smooth Bass-Sync Physics + 64-band Neon Bloom Waveform (15 styles)
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
  framePhase = 0,
  layout?: WaveformLayoutConfig,
  onsetFlux?: number,
  customColors?: WaveformColorMix
): void {
  const { width: w, height: h, baseCanvas, overlayCanvas, glowCanvas } = surface;
  const theme = COLOR_THEMES[themeKey] ?? COLOR_THEMES.cyberpunk;
  const c1 = customColors ? hexToRgb(customColors.c1, theme.c1Rgb) : theme.c1Rgb;
  const cMid = customColors
    ? hexToRgb(customColors.c2, theme.cMidRgb ?? lerpColor(theme.c1Rgb, theme.c2Rgb, 0.5))
    : (theme.cMidRgb ?? lerpColor(theme.c1Rgb, theme.c2Rgb, 0.5));
  const c2 = customColors ? hexToRgb(customColors.c3, theme.c2Rgb) : theme.c2Rgb;
  const wfLayout = layout ?? getDefaultWaveformLayout(style);

  // 1. Bass-Sync Physics Engine (Onset Flux Zoom Punch + Kick Micro-Shake + Luminance Flash)
  const punchVal = onsetFlux !== undefined ? onsetFlux : bassVal;
  const zoom = 1.0 + punchVal * 0.12 * intensityMult;
  const scaleFactor = Math.min(w, h) / 1080;
  const shakePx = punchVal > 0.18 ? punchVal * 12 * intensityMult * scaleFactor : 0;

  let dx = 0;
  let dy = 0;
  if (shakePx > 0.1) {
    // Smooth organic dual-frequency sway triggered specifically on kick drum hits
    dx = Math.sin(framePhase * 1.45) * shakePx * 0.75 + Math.cos(framePhase * 2.3) * shakePx * 0.25;
    dy = Math.cos(framePhase * 1.65) * shakePx * 0.75 + Math.sin(framePhase * 2.1) * shakePx * 0.25;
  }

  targetCtx.save();
  targetCtx.fillStyle = '#090D16';
  targetCtx.fillRect(0, 0, w, h);

  targetCtx.translate(w / 2 + dx, h / 2 + dy);
  targetCtx.scale(zoom, zoom);
  targetCtx.translate(-w / 2, -h / 2);

  targetCtx.drawImage(baseCanvas, 0, 0, w, h);

  if (punchVal > 0.15 && intensityMult > 0) {
    const k = Math.min(0.45, (punchVal - 0.15) * 0.30 * intensityMult);
    targetCtx.globalCompositeOperation = 'lighter';
    targetCtx.globalAlpha = k;
    targetCtx.drawImage(baseCanvas, 0, 0, w, h);
  }
  targetCtx.restore();

  if (wfLayout.opacity <= 0.001) {
    return;
  }

  // 2. Draw 15 Non-Circular 3D/Wave Styles onto transparent overlayCanvas
  const oCtx = overlayCanvas.getContext('2d')!;
  oCtx.clearRect(0, 0, w, h);
  const anchorX = w * wfLayout.posX;
  const anchorY = h * wfLayout.posY;
  const spanW = w * 0.84;
  const xStart = -spanW / 2;
  const xEnd = spanW / 2;

  const makeSpanGrad = (alpha = 1) => {
    const g = oCtx.createLinearGradient(xStart, 0, xEnd, 0);
    g.addColorStop(0, rgbStr(c1, alpha));
    g.addColorStop(0.5, rgbStr(cMid, alpha));
    g.addColorStop(1, rgbStr(c2, alpha));
    return g;
  };

  oCtx.save();
  oCtx.translate(anchorX, anchorY);
  oCtx.scale(wfLayout.scale, wfLayout.scale);

  if (style === 'bars_3d') {
    // 1. 3D Isometric Extruded Equalizer Bars (front gradient face + bright top cap + 3D side extrusion + soft reflection)
    const count = 36;
    const step = spanW / count;
    const barW = Math.max(4, step * 0.54);
    const depthX = Math.max(2.5, barW * 0.36);
    const depthY = Math.max(2.0, barW * 0.26);
    const maxBarH = h * 0.17;
    const baseLineY = maxBarH * 0.15;

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleSpec(specCol, u);
      const col = sampleColor3(c1, cMid, c2, u);
      const sideCol = lerpColor(col, [8, 12, 24], 0.48);
      const topCol = lerpColor(col, [255, 255, 255], 0.58);

      const bh = Math.max(
        6 * scaleFactor,
        Math.pow(val, 1.25) * maxBarH * (1.0 + bassVal * 0.28)
      );
      const x = xStart + i * step + (step - barW) * 0.3;
      const yTop = baseLineY - bh;

      // Soft bottom reflection
      const reflH = bh * 0.32;
      const reflGrad = oCtx.createLinearGradient(0, baseLineY, 0, baseLineY + reflH);
      reflGrad.addColorStop(0, rgbStr(col, 0.34));
      reflGrad.addColorStop(1, rgbStr(col, 0));
      oCtx.fillStyle = reflGrad;
      oCtx.fillRect(x, baseLineY + 2 * scaleFactor, barW, reflH);

      // Right 3D extruded face
      oCtx.fillStyle = rgbStr(sideCol, 0.92);
      oCtx.beginPath();
      oCtx.moveTo(x + barW, yTop);
      oCtx.lineTo(x + barW + depthX, yTop - depthY);
      oCtx.lineTo(x + barW + depthX, baseLineY - depthY);
      oCtx.lineTo(x + barW, baseLineY);
      oCtx.closePath();
      oCtx.fill();

      // Top 3D bevel face
      oCtx.fillStyle = rgbStr(topCol, 0.96);
      oCtx.beginPath();
      oCtx.moveTo(x, yTop);
      oCtx.lineTo(x + depthX, yTop - depthY);
      oCtx.lineTo(x + barW + depthX, yTop - depthY);
      oCtx.lineTo(x + barW, yTop);
      oCtx.closePath();
      oCtx.fill();

      // Front illuminated bar face
      const faceGrad = oCtx.createLinearGradient(0, yTop, 0, baseLineY);
      faceGrad.addColorStop(0, rgbStr(lerpColor(col, [255, 255, 255], 0.15)));
      faceGrad.addColorStop(1, rgbStr(lerpColor(col, [12, 18, 36], 0.25)));
      oCtx.fillStyle = faceGrad;
      oCtx.fillRect(x, yTop, barW, bh);
    }
  } else if (style === 'layered_fluid') {
    // 2. Symmetrical Rounded Pill Capsules (Image 1: Wide-spaced vertical rounded pill bars with 3-lobe diamond silhouette & 3-color gradient)
    const count = 31;
    const step = spanW / count;
    const barW = Math.max(5 * scaleFactor, step * 0.44);
    const maxHalfH = h * 0.165;
    oCtx.lineCap = 'round';
    oCtx.lineWidth = barW;

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleSpec(specCol, u);
      const centerLobe = Math.exp(-Math.pow((u - 0.5) / 0.15, 2));
      const leftLobe = 0.64 * Math.exp(-Math.pow((u - 0.22) / 0.10, 2));
      const rightLobe = 0.64 * Math.exp(-Math.pow((u - 0.78) / 0.10, 2));
      const contour = 0.12 + 0.88 * Math.min(1, centerLobe + leftLobe + rightLobe);
      const halfH = Math.max(
        barW * 0.55,
        (0.28 + Math.pow(val, 1.1) * 0.72) * contour * maxHalfH * (1 + bassVal * 0.30)
      );
      const x = xStart + (i + 0.5) * step;
      const col = sampleColor3(c1, cMid, c2, u);

      oCtx.strokeStyle = rgbStr(col, 0.96);
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'dot_halftone') {
    // 3. Symmetrical Halftone Dot Columns
    const cols = 54;
    const stepX = spanW / cols;
    const maxHalfH = h * 0.14;
    const dotStepY = Math.max(4.5, 6.5 * scaleFactor);

    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const val = sampleSpec(specCol, u);
      const col = sampleColor3(c1, cMid, c2, u);
      const halfH = Math.max(dotStepY, Math.pow(val, 1.2) * maxHalfH * taperEnvelope(u) * (1 + bassVal * 0.28));
      const x = xStart + (i + 0.5) * stepX;
      const numDots = Math.max(1, Math.floor(halfH / dotStepY));

      for (let d = 0; d <= numDots; d++) {
        const distFrac = d / Math.max(1, numDots);
        const r = Math.max(1.2, (3.2 * (1 - distFrac * 0.62)) * scaleFactor);
        oCtx.fillStyle = rgbStr(col, 0.95 - distFrac * 0.35);
        oCtx.beginPath();
        oCtx.arc(x, -d * dotStepY, r, 0, Math.PI * 2);
        if (d > 0) oCtx.arc(x, d * dotStepY, r, 0, Math.PI * 2);
        oCtx.fill();
      }
    }
  } else if (style === 'pixel_grid') {
    // 4. Symmetrical 3D LED Pixel Blocks
    const cols = 48;
    const stepX = spanW / cols;
    const cellW = Math.max(3, stepX * 0.62);
    const cellH = Math.max(3, cellW * 0.72);
    const gapY = Math.max(1.5, cellH * 0.32);
    const maxHalfCells = 8;

    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const val = sampleSpec(specCol, u);
      const col = sampleColor3(c1, cMid, c2, u);
      const hiCol = lerpColor(col, [255, 255, 255], 0.45);
      const count = Math.max(
        1,
        Math.min(maxHalfCells, Math.round(Math.pow(val, 1.18) * maxHalfCells * taperEnvelope(u) * (1 + bassVal * 0.25)))
      );
      const x = xStart + i * stepX + (stepX - cellW) / 2;

      for (let b = 0; b < count; b++) {
        const offset = b * (cellH + gapY);
        const isTip = b === count - 1;
        oCtx.fillStyle = isTip ? rgbStr(hiCol, 0.95) : rgbStr(col, 0.9);
        oCtx.fillRect(x, -offset - cellH / 2, cellW, cellH);
        if (b > 0) {
          oCtx.fillRect(x, offset - cellH / 2, cellW, cellH);
        }
      }
    }
  } else if (style === 'mesh_ribbon') {
    // 5. 3D Twisted Dotted Mesh Ribbon (multi-strand flowing particle net)
    const strands = 10;
    const pts = 84;
    const maxAmp = h * 0.14;

    for (let s = 0; s < strands; s++) {
      const sFrac = s / (strands - 1);
      const strandPhase = (sFrac - 0.5) * 2.1;
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const val = Math.max(0.14, sampleSpec(specCol, u));
        const col = sampleColor3(c1, cMid, c2, u);
        const twist = Math.sin(u * Math.PI * 3.5 + framePhase * 0.08 + strandPhase);
        const y =
          twist *
          Math.pow(val, 0.92) *
          maxAmp *
          taperEnvelope(u) *
          (1 + bassVal * 0.25);
        const dotR = Math.max(1.3, (2.1 + val * 1.3) * scaleFactor);
        oCtx.fillStyle = rgbStr(col, 0.68 + 0.32 * (1 - Math.abs(sFrac - 0.5)));
        oCtx.beginPath();
        oCtx.arc(x, y, dotR, 0, Math.PI * 2);
        oCtx.fill();
      }
    }
  } else if (style === 'smooth_osc') {
    // 6. Smooth Continuous Organic Bezier Wave Stroke
    const pts = 88;
    const maxAmp = h * 0.15;
    oCtx.beginPath();
    for (let i = 0; i < pts; i++) {
      const u = i / (pts - 1);
      const x = xStart + u * spanW;
      const val = sampleSpec(specCol, u);
      const osc = Math.sin(u * Math.PI * 10 + framePhase * 0.16);
      const y = osc * Math.pow(val, 1.1) * maxAmp * taperEnvelope(u) * (1 + bassVal * 0.28);
      if (i === 0) {
        oCtx.moveTo(x, y);
      } else {
        const pu = (i - 1) / (pts - 1);
        const px = xStart + pu * spanW;
        const pVal = sampleSpec(specCol, pu);
        const py =
          Math.sin(pu * Math.PI * 10 + framePhase * 0.16) *
          Math.pow(pVal, 1.1) *
          maxAmp *
          taperEnvelope(pu) *
          (1 + bassVal * 0.28);
        oCtx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      }
    }
    oCtx.strokeStyle = makeSpanGrad(0.95);
    oCtx.lineWidth = Math.max(2.5, 4.2 * scaleFactor);
    oCtx.lineCap = 'round';
    oCtx.lineJoin = 'round';
    oCtx.stroke();
  } else if (style === 'mirror_needles') {
    // 7. Crisp Symmetrical Vertical Needles
    const count = 88;
    const step = spanW / count;
    const maxHalfH = h * 0.15;
    oCtx.lineWidth = Math.max(1.5, 2.6 * scaleFactor);
    oCtx.lineCap = 'round';

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleSpec(specCol, u);
      const col = sampleColor3(c1, cMid, c2, u);
      const halfH = Math.max(2 * scaleFactor, Math.pow(val, 1.25) * maxHalfH * taperEnvelope(u) * (1 + bassVal * 0.3));
      const x = xStart + (i + 0.5) * step;

      oCtx.strokeStyle = rgbStr(col, 0.95);
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'silk_aura') {
    // 8. Soft Feathered Silk Aurora Curtain
    const count = 120;
    const step = spanW / count;
    const maxHalfH = h * 0.16;
    oCtx.lineWidth = Math.max(1.5, step * 0.95);

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleSpec(specCol, u);
      const col = sampleColor3(c1, cMid, c2, u);
      const halfH = Math.max(4 * scaleFactor, Math.pow(val, 1.12) * maxHalfH * Math.sin(u * Math.PI) * (1 + bassVal * 0.28));
      const x = xStart + i * step;

      const vGrad = oCtx.createLinearGradient(x, -halfH, x, halfH);
      vGrad.addColorStop(0, rgbStr(col, 0));
      vGrad.addColorStop(0.5, rgbStr(lerpColor(col, [255, 255, 255], 0.25), 0.72));
      vGrad.addColorStop(1, rgbStr(col, 0));

      oCtx.strokeStyle = vGrad;
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'prism_peaks') {
    // 9. Inner-Glow Gradient Pill Capsules (Image 2: Closely-packed vertical rounded capsules glowing bright in the center and fading toward top/bottom tips)
    const count = 39;
    const step = spanW / count;
    const barW = Math.max(5.5 * scaleFactor, step * 0.64);
    const maxHalfH = h * 0.16;
    oCtx.lineCap = 'round';
    oCtx.lineWidth = barW;

    const coreCol = lerpColor(c1, [255, 255, 255], 0.22);

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleSpec(specCol, u);
      const centerPeak = Math.exp(-Math.pow((u - 0.5) / 0.14, 2));
      const sidePeaks =
        0.52 * Math.exp(-Math.pow((u - 0.24) / 0.12, 2)) +
        0.52 * Math.exp(-Math.pow((u - 0.76) / 0.12, 2));
      const cadence = 0.72 + 0.28 * Math.abs(Math.cos(i * 1.35 + framePhase * 0.06));
      const contour = (0.18 + 0.82 * Math.min(1, centerPeak + sidePeaks)) * cadence;

      const halfH = Math.max(
        barW * 0.55,
        (0.26 + Math.pow(val, 1.08) * 0.74) * contour * maxHalfH * (1 + bassVal * 0.28)
      );
      const x = xStart + (i + 0.5) * step;

      const vGrad = oCtx.createLinearGradient(x, -halfH, x, halfH);
      vGrad.addColorStop(0, rgbStr(c2, 0.94));
      vGrad.addColorStop(0.28, rgbStr(cMid, 0.96));
      vGrad.addColorStop(0.5, rgbStr(coreCol, 1.0));
      vGrad.addColorStop(0.72, rgbStr(cMid, 0.96));
      vGrad.addColorStop(1, rgbStr(c2, 0.94));

      oCtx.strokeStyle = vGrad;
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'brush_spectrum') {
    // 10. Painterly Dense Brush Spectrum Band
    const count = 110;
    const step = spanW / count;
    const maxHalfH = h * 0.14;

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleSpec(specCol, u);
      const col = sampleColor3(c1, cMid, c2, u);
      const micro = 0.68 + 0.32 * Math.abs(Math.sin(i * 1.7 + framePhase * 0.12));
      const halfH = Math.max(2 * scaleFactor, Math.pow(val, 1.15) * maxHalfH * micro * taperEnvelope(u) * (1 + bassVal * 0.28));
      const x = xStart + i * step;

      oCtx.fillStyle = rgbStr(col, 0.78);
      oCtx.fillRect(x, -halfH, Math.max(1.8, step * 0.85), halfH * 2);
      oCtx.fillStyle = rgbStr(lerpColor(col, [255, 255, 255], 0.35), 0.5);
      oCtx.fillRect(x, -halfH * 0.45, Math.max(1.8, step * 0.85), halfH * 0.9);
    }
  } else if (style === 'harmonic_waves') {
    // 11. Overlapping Harmonic Ribbons with Outlined Crests
    const pts = 68;
    const maxAmp = h * 0.135;
    const bands = [
      { freq: 3.0, phase: 0.0, col: c1, fillAlpha: 0.22 },
      { freq: 4.5, phase: 1.5, col: cMid, fillAlpha: 0.24 },
      { freq: 6.0, phase: 3.0, col: c2, fillAlpha: 0.24 },
    ];

    for (const b of bands) {
      const top: Array<[number, number]> = [];
      const bot: Array<[number, number]> = [];
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const val = sampleSpec(specCol, u);
        const wave = Math.sin(u * Math.PI * b.freq + framePhase * 0.09 + b.phase);
        const amp = Math.pow(val, 1.15) * maxAmp * taperEnvelope(u) * (1 + bassVal * 0.24);
        top.push([x, wave * amp]);
        bot.push([x, -wave * amp * 0.65]);
      }

      oCtx.beginPath();
      oCtx.moveTo(top[0][0], top[0][1]);
      for (let i = 1; i < top.length; i++) oCtx.lineTo(top[i][0], top[i][1]);
      for (let i = bot.length - 1; i >= 0; i--) oCtx.lineTo(bot[i][0], bot[i][1]);
      oCtx.closePath();
      oCtx.fillStyle = rgbStr(b.col, b.fillAlpha);
      oCtx.fill();

      oCtx.beginPath();
      oCtx.moveTo(top[0][0], top[0][1]);
      for (let i = 1; i < top.length; i++) oCtx.lineTo(top[i][0], top[i][1]);
      oCtx.strokeStyle = rgbStr(b.col, 0.9);
      oCtx.lineWidth = Math.max(1.5, 2.2 * scaleFactor);
      oCtx.stroke();
    }
  } else if (style === 'dot_mountains') {
    // 12. Glowing Laser Waveform + Bokeh Sparkles (Image 3: Sharp ECG/synth spikes + glowing center beam + bokeh circles & sparkles)
    const maxAmp = h * 0.17;

    // Layer A: Soft out-of-focus bokeh circles in background
    const bokehCount = 18;
    for (let b = 0; b < bokehCount; b++) {
      const bu = (b + 0.5) / bokehCount;
      const bx = xStart + bu * spanW + Math.sin(b * 4.1 + framePhase * 0.03) * 18 * scaleFactor;
      const by = Math.cos(b * 2.7 + framePhase * 0.04) * maxAmp * 0.62;
      const br = (10 + (b % 4) * 6.5) * scaleFactor * (0.9 + bassVal * 0.25);
      const bCol = sampleColor3(c1, cMid, c2, bu);
      oCtx.fillStyle = rgbStr(bCol, 0.11 + (b % 3) * 0.04);
      oCtx.beginPath();
      oCtx.arc(bx, by, br, 0, Math.PI * 2);
      oCtx.fill();
    }

    // Layer B: Glowing horizontal center laser beam
    const beamGrad = oCtx.createLinearGradient(xStart, 0, xEnd, 0);
    beamGrad.addColorStop(0, rgbStr(c1, 0));
    beamGrad.addColorStop(0.15, rgbStr(c1, 0.65));
    beamGrad.addColorStop(0.5, rgbStr(lerpColor(cMid, [255, 255, 255], 0.5), 0.9));
    beamGrad.addColorStop(0.85, rgbStr(c2, 0.65));
    beamGrad.addColorStop(1, rgbStr(c2, 0));
    oCtx.strokeStyle = beamGrad;
    oCtx.lineWidth = Math.max(1.5, 2.4 * scaleFactor);
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    oCtx.lineTo(xEnd, 0);
    oCtx.stroke();

    // Layer C: High-frequency sharp laser spikes (outer color glow + inner white-hot core)
    const pts = 128;
    const waveCoords: Array<[number, number, number]> = [];
    for (let i = 0; i < pts; i++) {
      const u = i / (pts - 1);
      const x = xStart + u * spanW;
      const val = sampleSpec(specCol, u);
      const mainCluster = Math.exp(-Math.pow((u - 0.44) / 0.065, 2));
      const leftCluster = 0.72 * Math.exp(-Math.pow((u - 0.19) / 0.075, 2));
      const rightCluster = 0.78 * Math.exp(-Math.pow((u - 0.67) / 0.075, 2));
      const baseBed = 0.18 * Math.sin(u * Math.PI);
      const env = Math.min(1.15, baseBed + mainCluster + leftCluster + rightCluster);
      const carrier =
        Math.sin(i * 1.95 + framePhase * 0.22) * 0.72 +
        Math.cos(i * 0.9 - framePhase * 0.14) * 0.28;
      const y =
        carrier *
        (0.25 + Math.pow(val, 1.05) * 0.75) *
        env *
        maxAmp *
        (1 + bassVal * 0.34);
      waveCoords.push([x, y, u]);
    }

    // Outer colored laser stroke
    oCtx.beginPath();
    for (let i = 0; i < waveCoords.length; i++) {
      if (i === 0) oCtx.moveTo(waveCoords[i][0], waveCoords[i][1]);
      else oCtx.lineTo(waveCoords[i][0], waveCoords[i][1]);
    }
    oCtx.strokeStyle = makeSpanGrad(0.95);
    oCtx.lineWidth = Math.max(2.6, 4.4 * scaleFactor);
    oCtx.lineJoin = 'round';
    oCtx.lineCap = 'round';
    oCtx.stroke();

    // Inner white-hot core stroke
    oCtx.beginPath();
    for (let i = 0; i < waveCoords.length; i++) {
      if (i === 0) oCtx.moveTo(waveCoords[i][0], waveCoords[i][1]);
      else oCtx.lineTo(waveCoords[i][0], waveCoords[i][1]);
    }
    oCtx.strokeStyle = 'rgba(240, 250, 255, 0.92)';
    oCtx.lineWidth = Math.max(1.1, 1.6 * scaleFactor);
    oCtx.stroke();

    // Layer D: Floating sparkle particles around the laser waveform
    const sparkCount = 44;
    for (let s = 0; s < sparkCount; s++) {
      const su = (s + 0.3) / sparkCount;
      const sx = xStart + su * spanW;
      const sVal = sampleSpec(specCol, su);
      const sy =
        Math.sin(s * 3.7 + framePhase * 0.09) *
        maxAmp *
        (0.16 + sVal * 0.45) *
        Math.sin(su * Math.PI);
      const sr = Math.max(1.4, (1.8 + (s % 3) * 1.2 + bassVal * 1.1) * scaleFactor);
      const sCol = sampleColor3(c1, cMid, c2, su);

      oCtx.fillStyle = rgbStr(sCol, 0.78);
      oCtx.beginPath();
      oCtx.arc(sx, sy, sr * 1.45, 0, Math.PI * 2);
      oCtx.fill();

      oCtx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      oCtx.beginPath();
      oCtx.arc(sx, sy, sr * 0.65, 0, Math.PI * 2);
      oCtx.fill();
    }
  } else if (style === 'double_flame') {
    // 13. Mirrored LED Square Matrix with Center Gap (Image 4: Discrete square LED blocks mirrored across a center gap, colored vertically from center c1 -> middle cMid -> tip c2)
    const cols = 52;
    const stepX = spanW / cols;
    const cellW = Math.max(3.2 * scaleFactor, stepX * 0.68);
    const cellH = Math.max(3.0 * scaleFactor, cellW * 0.86);
    const gapY = Math.max(1.4 * scaleFactor, cellH * 0.28);
    const centerGap = Math.max(4.0 * scaleFactor, cellH * 0.85);
    const maxHalfRows = 10;

    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const val = sampleSpec(specCol, u);
      const ridge =
        0.55 +
        0.45 *
          Math.abs(
            Math.sin(u * Math.PI * 6.5 + framePhase * 0.07) * 0.65 +
              Math.cos(i * 1.4) * 0.35
          );
      const activeRows = Math.max(
        1,
        Math.min(
          maxHalfRows,
          Math.round(
            (0.18 + Math.pow(val, 1.05) * 0.82) *
              ridge *
              maxHalfRows *
              taperEnvelope(u) *
              (1 + bassVal * 0.26)
          )
        )
      );
      const x = xStart + i * stepX + (stepX - cellW) / 2;

      for (let r = 0; r < activeRows; r++) {
        const vFrac = r / Math.max(1, maxHalfRows - 1);
        // Vertical 3-color mix from center gap (c1) -> middle (cMid) -> outer tip (c2)
        const rowCol = sampleColor3(c1, cMid, c2, vFrac);
        const yTop = -centerGap / 2 - (r + 1) * cellH - r * gapY;
        const yBot = centerGap / 2 + r * (cellH + gapY);

        oCtx.fillStyle = rgbStr(rowCol, 0.95);
        oCtx.fillRect(x, yTop, cellW, cellH);

        oCtx.fillStyle = rgbStr(rowCol, 0.88);
        oCtx.fillRect(x, yBot, cellW, cellH);
      }
    }
  } else if (style === 'triple_sine') {
    // 14. Three Intertwined Glowing Sine Ribbons
    const pts = 88;
    const maxAmp = h * 0.13;
    const ribbons = [
      { phase: 0.0, col: c1, lw: 3.6 },
      { phase: 2.1, col: cMid, lw: 3.2 },
      { phase: 4.2, col: c2, lw: 3.4 },
    ];

    for (const r of ribbons) {
      oCtx.beginPath();
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const val = sampleSpec(specCol, u);
        const y =
          Math.sin(u * Math.PI * 7 + framePhase * 0.12 + r.phase) *
          Math.pow(val, 1.05) *
          maxAmp *
          taperEnvelope(u) *
          (1 + bassVal * 0.25);
        if (i === 0) oCtx.moveTo(x, y);
        else oCtx.lineTo(x, y);
      }
      oCtx.strokeStyle = rgbStr(r.col, 0.94);
      oCtx.lineWidth = Math.max(2, r.lw * scaleFactor);
      oCtx.lineCap = 'round';
      oCtx.lineJoin = 'round';
      oCtx.stroke();
    }
  } else if (style === 'seismic_line') {
    // 15. Equalizer Bars with Floating Peak Caps & Water Reflection (Image 5)
    const count = 18;
    const step = spanW / count;
    const barW = Math.max(6 * scaleFactor, step * 0.58);
    const capH = Math.max(3.2 * scaleFactor, barW * 0.15);
    const maxBarH = h * 0.145;
    const lineThickness = Math.max(2.2 * scaleFactor, 3.2 * scaleFactor);

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleSpec(specCol, u);
      const col = sampleColor3(c1, cMid, c2, u);
      const arch = 0.35 + 0.65 * Math.sin(u * Math.PI);
      const pulse = 0.76 + 0.24 * Math.abs(Math.sin(i * 1.55 + framePhase * 0.08));
      const barH = Math.max(
        8 * scaleFactor,
        (0.22 + Math.pow(val, 1.12) * 0.78) * arch * pulse * maxBarH * (1 + bassVal * 0.28)
      );
      const capGap = Math.max(7 * scaleFactor, (10 + val * 10 + bassVal * 6) * scaleFactor);
      const x = xStart + i * step + (step - barW) / 2;

      // Upper main equalizer bar
      oCtx.fillStyle = rgbStr(col, 0.96);
      oCtx.fillRect(x, -lineThickness / 2 - barH, barW, barH);

      // Upper floating peak-hold cap
      oCtx.fillStyle = rgbStr(lerpColor(col, [255, 255, 255], 0.15), 0.98);
      oCtx.fillRect(x, -lineThickness / 2 - barH - capGap - capH, barW, capH);

      // Lower mirrored water reflection bar
      const reflBarH = barH * 0.88;
      const reflGrad = oCtx.createLinearGradient(0, lineThickness / 2, 0, lineThickness / 2 + reflBarH);
      reflGrad.addColorStop(0, rgbStr(col, 0.34));
      reflGrad.addColorStop(1, rgbStr(col, 0.12));
      oCtx.fillStyle = reflGrad;
      oCtx.fillRect(x, lineThickness / 2, barW, reflBarH);

      // Lower mirrored floating peak-hold cap
      oCtx.fillStyle = rgbStr(col, 0.24);
      oCtx.fillRect(x, lineThickness / 2 + reflBarH + capGap * 0.85, barW, capH);
    }

    // Continuous glowing horizontal center line across the full span
    oCtx.fillStyle = makeSpanGrad(0.98);
    oCtx.fillRect(xStart, -lineThickness / 2, spanW, lineThickness);
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
