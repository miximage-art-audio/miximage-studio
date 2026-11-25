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
 * Updates the base canvas background with an image or canvas,
 * implementing `center`, `cover`, and `blur_pad` modes.
 */
export function updateRenderSurfaceBase(
  surface: RenderSurface,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  fitMode: FitMode
): void {
  const { baseCanvas, width: targetW, height: targetH } = surface;
  const ctx = baseCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, targetW, targetH);
  const geom = computeFitGeometry(srcW, srcH, targetW, targetH);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Studio dark radial backdrop ensures transparent PNG artwork renders with rich depth
  const drawDarkBackdrop = () => {
    const bgGrad = ctx.createRadialGradient(
      targetW * 0.5,
      targetH * 0.48,
      Math.min(targetW, targetH) * 0.05,
      targetW * 0.5,
      targetH * 0.5,
      Math.max(targetW, targetH) * 0.72
    );
    bgGrad.addColorStop(0, '#131C33');
    bgGrad.addColorStop(0.55, '#090D16');
    bgGrad.addColorStop(1, '#050810');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, targetW, targetH);
  };

  if (fitMode === 'center') {
    drawDarkBackdrop();
    ctx.drawImage(
      source,
      geom.center.x,
      geom.center.y,
      geom.center.w,
      geom.center.h
    );
  } else if (fitMode === 'cover') {
    drawDarkBackdrop();
    ctx.drawImage(source, geom.cover.x, geom.cover.y, geom.cover.w, geom.cover.h);
  } else {
    // blur_pad: Gaussian blurred cover background dimmed by 55% (0.45 brightness) + centered full image
    drawDarkBackdrop();
    const blurScale = Math.max(12, Math.round(Math.min(targetW, targetH) * 0.032));
    ctx.save();
    ctx.filter = `blur(${blurScale}px) brightness(0.45)`;
    const pad = blurScale * 2;
    ctx.drawImage(
      source,
      geom.cover.x - pad,
      geom.cover.y - pad,
      geom.cover.w + pad * 2,
      geom.cover.h + pad * 2
    );
    ctx.restore();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
    ctx.fillRect(0, 0, targetW, targetH);

    ctx.drawImage(
      source,
      geom.contain.x,
      geom.contain.y,
      geom.contain.w,
      geom.contain.h
    );
  }
}

/**
 * Prepares the offscreen base canvas implementing `center`, `cover`, and `blur_pad` modes.
 */
export function createRenderSurface(
  img: HTMLImageElement | HTMLCanvasElement,
  targetW: number,
  targetH: number,
  fitMode: FitMode
): RenderSurface {
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = targetW;
  baseCanvas.height = targetH;

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = targetW;
  overlayCanvas.height = targetH;

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = Math.max(96, Math.round(targetW / 4));
  glowCanvas.height = Math.max(96, Math.round(targetH / 4));

  const workCanvas = document.createElement('canvas');
  workCanvas.width = Math.max(96, Math.round(targetW / 2));
  workCanvas.height = Math.max(96, Math.round(targetH / 2));

  const surface: RenderSurface = {
    baseCanvas,
    overlayCanvas,
    glowCanvas,
    workCanvas,
    width: targetW,
    height: targetH,
  };

  const srcW =
    ('naturalWidth' in img && img.naturalWidth ? img.naturalWidth : 0) ||
    img.width ||
    targetW;
  const srcH =
    ('naturalHeight' in img && img.naturalHeight ? img.naturalHeight : 0) ||
    img.height ||
    targetH;

  updateRenderSurfaceBase(surface, img, srcW, srcH, fitMode);

  return surface;
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

/**
 * True Pitch & Beat Spectrum Sampler:
 * Samples the 64-band musical Mel spectrogram directly (without artificial timers or bass overrides).
 * When `symmetric = true`, maps low-to-mid fundamental beats/vocals at the center (u = 0.5)
 * and mid-to-high harmonics toward the left/right wings with subtle stereo offset.
 */
function sampleMusicalSpec(
  specCol: Float32Array | number[],
  u: number,
  symmetric = false
): number {
  const clampedU = Math.max(0, Math.min(1, u));
  if (!symmetric) {
    // Full-range musical pitch mapping (30Hz -> 10kHz active musical range)
    const bandPos = Math.pow(clampedU, 0.92) * 0.92;
    return sampleSpec(specCol, bandPos);
  }
  // Center-outward pitch mapping for symmetrical styles
  const distFromCenter = Math.abs(clampedU - 0.5) * 2; // 0 at center, 1 at wings
  const stereoOffset = clampedU < 0.5 ? 0.0 : 0.035;
  const symBandPos = Math.min(0.94, Math.pow(distFromCenter, 0.9) * 0.88 + stereoOffset);
  return sampleSpec(specCol, symBandPos);
}

function drawSmoothCurve(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<readonly [number, number] | [number, number, ...number[]]>
): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) return;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
    const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function taperEnvelope(u: number): number {
  // Gentle edge taper so outer bars still respond clearly while framing the ends cleanly
  const s = Math.sin(Math.max(0, Math.min(1, u)) * Math.PI);
  return Math.pow(s, 0.55) * 0.58 + 0.42;
}

/**
 * Renders a single frame onto `targetCtx`:
 * 1) Background Artwork = Bass-Sync Physics (20Hz-150Hz Sub-bass & Kick Onset Zoom/Shake/Flash)
 * 2) Foreground Waveform = True 64-band Musical Pitch/Beat Sync (zero fake oscillation, silky liquid motion)
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
  customColors?: WaveformColorMix,
  showWaveform = true
): void {
  const { width: w, height: h, baseCanvas, overlayCanvas, glowCanvas, workCanvas } = surface;
  const theme = COLOR_THEMES[themeKey] ?? COLOR_THEMES.cyberpunk;
  const c1 = customColors ? hexToRgb(customColors.c1, theme.c1Rgb) : theme.c1Rgb;
  const cMid = customColors
    ? hexToRgb(customColors.c2, theme.cMidRgb ?? lerpColor(theme.c1Rgb, theme.c2Rgb, 0.5))
    : (theme.cMidRgb ?? lerpColor(theme.c1Rgb, theme.c2Rgb, 0.5));
  const c2 = customColors ? hexToRgb(customColors.c3, theme.c2Rgb) : theme.c2Rgb;
  const wfLayout = layout ?? getDefaultWaveformLayout(style);
  const scaleFactor = Math.min(w, h) / 1080;

  // 1. Background Screen Bass-Sync Engine (Smooth Velvety Breathing Zoom + Soft Ambient Bloom)
  // Blend sub-bass weight with transient onset to get a cohesive, musical pulse (zero jerky camera shake)
  const rawPunch = onsetFlux !== undefined
    ? bassVal * 0.58 + onsetFlux * 0.42
    : bassVal;

  // Smooth Hermite S-curve easing cushions the bounce and eliminates harsh step changes
  const clampedPunch = Math.min(1.0, Math.max(0.0, rawPunch));
  const smoothPunch = clampedPunch * clampedPunch * (3.0 - 2.0 * clampedPunch);

  // Organic, cushioned breathing zoom: max ~4.8% at 1.0x intensity for a lush, fluid pump
  const zoom = 1.0 + Math.pow(smoothPunch, 1.4) * 0.048 * intensityMult;

  targetCtx.save();
  targetCtx.fillStyle = '#090D16';
  targetCtx.fillRect(0, 0, w, h);

  // Center-anchored zoom with zero jittery screen shake
  targetCtx.translate(w / 2, h / 2);
  targetCtx.scale(zoom, zoom);
  targetCtx.translate(-w / 2, -h / 2);

  targetCtx.drawImage(baseCanvas, 0, 0, w, h);

  // Soft, continuous ambient bloom on heavy bass drops (quadratic falloff without harsh flashing cutoff)
  if (smoothPunch > 0.10 && intensityMult > 0) {
    const bloomAlpha = Math.min(0.22, Math.pow(smoothPunch, 2.2) * 0.28 * intensityMult);
    if (bloomAlpha > 0.005) {
      targetCtx.globalCompositeOperation = 'lighter';
      targetCtx.globalAlpha = bloomAlpha;
      targetCtx.drawImage(baseCanvas, 0, 0, w, h);
    }
  }
  targetCtx.restore();

  if (!showWaveform || wfLayout.opacity <= 0.001) {
    return;
  }

  // 2. Draw 15 Waveform Styles synced 100% to the Song's True Pitch & Beat Spectrum (specCol)
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
    // 1. 3D Isometric Extruded Equalizer Bars (True linear pitch spectrum Low -> Mid -> High)
    const count = 36;
    const step = spanW / count;
    const barW = Math.max(4, step * 0.54);
    const depthX = Math.max(2.5, barW * 0.36);
    const depthY = Math.max(2.0, barW * 0.26);
    const maxBarH = h * 0.18;
    const baseLineY = maxBarH * 0.15;

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, false);
      const col = sampleColor3(c1, cMid, c2, u);
      const sideCol = lerpColor(col, [8, 12, 24], 0.45);
      const topCol = lerpColor(col, [255, 255, 255], 0.62);

      const bh = Math.max(
        4 * scaleFactor,
        Math.pow(val, 1.08) * maxBarH * taperEnvelope(u)
      );
      const x = xStart + i * step + (step - barW) * 0.3;
      const yTop = baseLineY - bh;

      // Soft bottom reflection
      const reflH = bh * 0.36;
      const reflGrad = oCtx.createLinearGradient(0, baseLineY, 0, baseLineY + reflH);
      reflGrad.addColorStop(0, rgbStr(col, 0.36));
      reflGrad.addColorStop(1, rgbStr(col, 0));
      oCtx.fillStyle = reflGrad;
      oCtx.fillRect(x, baseLineY + 2 * scaleFactor, barW, reflH);

      // Right 3D extruded face
      oCtx.fillStyle = rgbStr(sideCol, 0.9);
      oCtx.beginPath();
      oCtx.moveTo(x + barW, yTop);
      oCtx.lineTo(x + barW + depthX, yTop - depthY);
      oCtx.lineTo(x + barW + depthX, baseLineY - depthY);
      oCtx.lineTo(x + barW, baseLineY);
      oCtx.closePath();
      oCtx.fill();

      // Top 3D bevel face
      oCtx.fillStyle = rgbStr(topCol, 0.95);
      oCtx.beginPath();
      oCtx.moveTo(x, yTop);
      oCtx.lineTo(x + depthX, yTop - depthY);
      oCtx.lineTo(x + barW + depthX, yTop - depthY);
      oCtx.lineTo(x + barW, yTop);
      oCtx.closePath();
      oCtx.fill();

      // Front illuminated bar face
      const faceGrad = oCtx.createLinearGradient(0, yTop, 0, baseLineY);
      faceGrad.addColorStop(0, rgbStr(lerpColor(col, [255, 255, 255], 0.22), 0.96));
      faceGrad.addColorStop(1, rgbStr(lerpColor(col, [12, 18, 36], 0.22), 0.92));
      oCtx.fillStyle = faceGrad;
      oCtx.fillRect(x, yTop, barW, bh);
    }
  } else if (style === 'layered_fluid') {
    // 2. Symmetrical Rounded Pill Capsules (Image 1: True center-outward spectrum sync without rigid 3-lobe lock)
    const count = 31;
    const step = spanW / count;
    const barW = Math.max(5 * scaleFactor, step * 0.44);
    const maxHalfH = h * 0.175;
    oCtx.lineCap = 'round';
    oCtx.lineWidth = barW;

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const halfH = Math.max(
        barW * 0.42,
        Math.pow(val, 1.08) * maxHalfH * taperEnvelope(u)
      );
      const x = xStart + (i + 0.5) * step;
      const col = sampleColor3(c1, cMid, c2, u);
      const coreCol = lerpColor(col, [255, 255, 255], 0.24);

      const vGrad = oCtx.createLinearGradient(x, -halfH, x, halfH);
      vGrad.addColorStop(0, rgbStr(col, 0.82));
      vGrad.addColorStop(0.5, rgbStr(coreCol, 0.98));
      vGrad.addColorStop(1, rgbStr(col, 0.82));

      oCtx.strokeStyle = vGrad;
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'dot_halftone') {
    // 3. Symmetrical Halftone Dot Columns
    const cols = 54;
    const stepX = spanW / cols;
    const maxHalfH = h * 0.155;
    const dotStepY = Math.max(4.5, 6.5 * scaleFactor);

    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const col = sampleColor3(c1, cMid, c2, u);
      const halfH = Math.max(
        dotStepY * 0.5,
        Math.pow(val, 1.08) * maxHalfH * taperEnvelope(u)
      );
      const x = xStart + (i + 0.5) * stepX;
      const exactDots = halfH / dotStepY;
      const numDots = Math.max(1, Math.ceil(exactDots));

      for (let d = 0; d <= numDots; d++) {
        const distFrac = d / Math.max(1, numDots);
        const tipFade = d === numDots ? Math.max(0.15, exactDots - Math.floor(exactDots)) : 1;
        const r = Math.max(1.2, 3.3 * (1 - distFrac * 0.58) * scaleFactor);
        oCtx.fillStyle = rgbStr(col, (0.94 - distFrac * 0.42) * tipFade);
        oCtx.beginPath();
        oCtx.arc(x, -d * dotStepY, r, 0, Math.PI * 2);
        if (d > 0) oCtx.arc(x, d * dotStepY, r, 0, Math.PI * 2);
        oCtx.fill();
      }
    }
  } else if (style === 'pixel_grid') {
    // 4. Symmetrical 3D LED Pixel Blocks (with smooth fractional tip alpha)
    const cols = 48;
    const stepX = spanW / cols;
    const cellW = Math.max(3, stepX * 0.62);
    const cellH = Math.max(3, cellW * 0.72);
    const gapY = Math.max(1.5, cellH * 0.32);
    const maxHalfCells = 8;

    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const col = sampleColor3(c1, cMid, c2, u);
      const hiCol = lerpColor(col, [255, 255, 255], 0.42);
      const exactCells = Math.max(
        0.5,
        Math.min(maxHalfCells, Math.pow(val, 1.08) * maxHalfCells * taperEnvelope(u))
      );
      const count = Math.max(1, Math.ceil(exactCells));
      const x = xStart + i * stepX + (stepX - cellW) / 2;

      for (let b = 0; b < count; b++) {
        const offset = b * (cellH + gapY);
        const isTip = b === count - 1;
        const tipAlpha = isTip ? Math.max(0.18, exactCells - Math.floor(exactCells) || 1) : 1;
        oCtx.fillStyle = isTip ? rgbStr(hiCol, 0.92 * tipAlpha) : rgbStr(col, 0.88);
        oCtx.fillRect(x, -offset - cellH / 2, cellW, cellH);
        if (b > 0) {
          oCtx.fillRect(x, offset - cellH / 2, cellW, cellH);
        }
      }
    }
  } else if (style === 'mesh_ribbon') {
    // 5. 3D Twisted Dotted Mesh Ribbon (Pure audio-synced amplitude without fake fast phase spin)
    const strands = 10;
    const pts = 84;
    const maxAmp = h * 0.15;

    for (let s = 0; s < strands; s++) {
      const sFrac = s / (strands - 1);
      const strandPhase = (sFrac - 0.5) * Math.PI * 0.95;
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const val = sampleMusicalSpec(specCol, u, false);
        const col = sampleColor3(c1, cMid, c2, u);
        const twist = Math.sin(u * Math.PI * 3.0 + strandPhase);
        const y = twist * Math.pow(val, 1.05) * maxAmp * taperEnvelope(u);
        const dotR = Math.max(1.3, (1.9 + val * 1.5) * scaleFactor);
        oCtx.fillStyle = rgbStr(col, 0.65 + 0.32 * (1 - Math.abs(sFrac - 0.5)));
        oCtx.beginPath();
        oCtx.arc(x, y, dotR, 0, Math.PI * 2);
        oCtx.fill();
      }
    }
  } else if (style === 'smooth_osc') {
    // 6. Smooth Continuous Organic Bezier Wave (Phase-locked to pitch spectrum, no fake scrolling)
    const pts = 64;
    const maxAmp = h * 0.16;

    const layers = [
      { sign: -0.68, alpha: 0.45, lw: 6.2 },
      { sign: 1.0, alpha: 0.95, lw: 4.0 },
    ];

    for (const layer of layers) {
      const coords: Array<[number, number]> = [];
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const val = sampleMusicalSpec(specCol, u, true);
        const carrier = Math.sin(u * Math.PI * 5.0);
        const y = carrier * layer.sign * Math.pow(val, 1.08) * maxAmp * taperEnvelope(u);
        coords.push([x, y]);
      }
      oCtx.beginPath();
      drawSmoothCurve(oCtx, coords);
      oCtx.strokeStyle = makeSpanGrad(layer.alpha);
      oCtx.lineWidth = Math.max(2.2, layer.lw * scaleFactor);
      oCtx.lineCap = 'round';
      oCtx.lineJoin = 'round';
      oCtx.stroke();
    }
  } else if (style === 'mirror_needles') {
    // 7. Symmetrical Vertical Needles with Soft Feathered Tips
    const count = 84;
    const step = spanW / count;
    const maxHalfH = h * 0.16;
    oCtx.lineWidth = Math.max(1.6, 2.7 * scaleFactor);
    oCtx.lineCap = 'round';

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const col = sampleColor3(c1, cMid, c2, u);
      const halfH = Math.max(
        2.2 * scaleFactor,
        Math.pow(val, 1.08) * maxHalfH * taperEnvelope(u)
      );
      const x = xStart + (i + 0.5) * step;

      const vGrad = oCtx.createLinearGradient(x, -halfH, x, halfH);
      vGrad.addColorStop(0, rgbStr(col, 0.28));
      vGrad.addColorStop(0.5, rgbStr(lerpColor(col, [255, 255, 255], 0.25), 0.96));
      vGrad.addColorStop(1, rgbStr(col, 0.28));

      oCtx.strokeStyle = vGrad;
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'silk_aura') {
    // 8. Soft Feathered Silk Aurora Curtain
    const count = 120;
    const step = spanW / count;
    const maxHalfH = h * 0.175;
    oCtx.lineWidth = Math.max(2.0, step * 1.15);
    oCtx.lineCap = 'round';

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const col = sampleColor3(c1, cMid, c2, u);
      const halfH = Math.max(
        3.5 * scaleFactor,
        Math.pow(val, 1.08) * maxHalfH * taperEnvelope(u)
      );
      const x = xStart + i * step;

      const vGrad = oCtx.createLinearGradient(x, -halfH, x, halfH);
      vGrad.addColorStop(0, rgbStr(col, 0));
      vGrad.addColorStop(0.25, rgbStr(col, 0.44));
      vGrad.addColorStop(0.5, rgbStr(lerpColor(col, [255, 255, 255], 0.32), 0.85));
      vGrad.addColorStop(0.75, rgbStr(col, 0.44));
      vGrad.addColorStop(1, rgbStr(col, 0));

      oCtx.strokeStyle = vGrad;
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'prism_peaks') {
    // 9. Inner-Glow Gradient Pill Capsules (Image 2: True pitch/beat-synced capsules without artificial timer cadence)
    const count = 39;
    const step = spanW / count;
    const barW = Math.max(5.5 * scaleFactor, step * 0.64);
    const maxHalfH = h * 0.175;
    oCtx.lineCap = 'round';
    oCtx.lineWidth = barW;

    const coreCol = lerpColor(c1, [255, 255, 255], 0.28);

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const halfH = Math.max(
        barW * 0.42,
        Math.pow(val, 1.08) * maxHalfH * taperEnvelope(u)
      );
      const x = xStart + (i + 0.5) * step;

      const vGrad = oCtx.createLinearGradient(x, -halfH, x, halfH);
      vGrad.addColorStop(0, rgbStr(c2, 0.76));
      vGrad.addColorStop(0.26, rgbStr(cMid, 0.94));
      vGrad.addColorStop(0.5, rgbStr(coreCol, 1.0));
      vGrad.addColorStop(0.74, rgbStr(cMid, 0.94));
      vGrad.addColorStop(1, rgbStr(c2, 0.76));

      oCtx.strokeStyle = vGrad;
      oCtx.beginPath();
      oCtx.moveTo(x, -halfH);
      oCtx.lineTo(x, halfH);
      oCtx.stroke();
    }
  } else if (style === 'brush_spectrum') {
    // 10. Painterly Soft Brush Spectrum Band (Pure pitch spectrum without fake timer ripple)
    const count = 110;
    const step = spanW / count;
    const maxHalfH = h * 0.155;

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, false);
      const col = sampleColor3(c1, cMid, c2, u);
      const halfH = Math.max(
        2 * scaleFactor,
        Math.pow(val, 1.08) * maxHalfH * taperEnvelope(u)
      );
      const x = xStart + i * step;

      const vGrad = oCtx.createLinearGradient(x, -halfH, x, halfH);
      vGrad.addColorStop(0, rgbStr(col, 0.18));
      vGrad.addColorStop(0.5, rgbStr(lerpColor(col, [255, 255, 255], 0.28), 0.9));
      vGrad.addColorStop(1, rgbStr(col, 0.18));

      oCtx.fillStyle = vGrad;
      oCtx.fillRect(x, -halfH, Math.max(1.8, step * 0.9), halfH * 2);
    }
  } else if (style === 'harmonic_waves') {
    // 11. Overlapping Harmonic Ribbons (Driven by Low, Mid, and High musical pitch regions without fake phase scrolling)
    const pts = 68;
    const maxAmp = h * 0.155;
    const bands = [
      { bandOffset: 0.0, bandScale: 0.45, dir: 1, col: c1, fillAlpha: 0.26 },
      { bandOffset: 0.25, bandScale: 0.5, dir: -1, col: cMid, fillAlpha: 0.26 },
      { bandOffset: 0.5, bandScale: 0.45, dir: 1, col: c2, fillAlpha: 0.26 },
    ];

    for (const b of bands) {
      const top: Array<[number, number]> = [];
      const bot: Array<[number, number]> = [];
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const dist = Math.abs(u - 0.5) * 2;
        const subBandU = Math.min(0.95, b.bandOffset + (1 - dist) * b.bandScale);
        const val = sampleSpec(specCol, subBandU);
        const amp = Math.pow(val, 1.08) * maxAmp * taperEnvelope(u);
        top.push([x, b.dir * amp]);
        bot.push([x, -b.dir * amp * 0.62]);
      }

      oCtx.beginPath();
      drawSmoothCurve(oCtx, top);
      for (let i = bot.length - 1; i >= 0; i--) oCtx.lineTo(bot[i][0], bot[i][1]);
      oCtx.closePath();
      oCtx.fillStyle = rgbStr(b.col, b.fillAlpha);
      oCtx.fill();

      oCtx.beginPath();
      drawSmoothCurve(oCtx, top);
      oCtx.strokeStyle = rgbStr(b.col, 0.92);
      oCtx.lineWidth = Math.max(1.8, 2.5 * scaleFactor);
      oCtx.lineCap = 'round';
      oCtx.lineJoin = 'round';
      oCtx.stroke();
    }
  } else if (style === 'dot_mountains') {
    // 12. Glowing Laser Waveform + Bokeh Sparkles (Image 3: Phase-locked to true musical spectrum, zero fake scrolling)
    const maxAmp = h * 0.175;

    // Layer A: Soft out-of-focus bokeh circles in background (glowing brighter when that frequency band hits)
    const bokehCount = 20;
    for (let b = 0; b < bokehCount; b++) {
      const bu = (b + 0.5) / bokehCount;
      const bVal = sampleMusicalSpec(specCol, bu, true);
      const bx = xStart + bu * spanW;
      const by = Math.sin(b * 2.3) * maxAmp * 0.45;
      const br = (11 + (b % 4) * 7.0) * scaleFactor * (0.8 + bVal * 0.45);
      const bCol = sampleColor3(c1, cMid, c2, bu);
      oCtx.fillStyle = rgbStr(bCol, 0.08 + bVal * 0.16);
      oCtx.beginPath();
      oCtx.arc(bx, by, br, 0, Math.PI * 2);
      oCtx.fill();
    }

    // Layer B: Glowing horizontal center laser beam
    const beamGrad = oCtx.createLinearGradient(xStart, 0, xEnd, 0);
    beamGrad.addColorStop(0, rgbStr(c1, 0));
    beamGrad.addColorStop(0.12, rgbStr(c1, 0.68));
    beamGrad.addColorStop(0.5, rgbStr(lerpColor(cMid, [255, 255, 255], 0.55), 0.92));
    beamGrad.addColorStop(0.88, rgbStr(c2, 0.68));
    beamGrad.addColorStop(1, rgbStr(c2, 0));
    oCtx.strokeStyle = beamGrad;
    oCtx.lineWidth = Math.max(1.6, 2.6 * scaleFactor);
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    oCtx.lineTo(xEnd, 0);
    oCtx.stroke();

    // Layer C: Stationary-carrier laser waveform driven 100% by the real audio spectrum at each point
    const pts = 96;
    const waveCoords: Array<[number, number, number]> = [];
    for (let i = 0; i < pts; i++) {
      const u = i / (pts - 1);
      const x = xStart + u * spanW;
      const val = sampleMusicalSpec(specCol, u, true);
      // Stationary alternating harmonic carrier (NO framePhase!) so peaks only move when the music hits
      const carrier = Math.sin(i * 1.55) * 0.75 + Math.cos(i * 0.78) * 0.25;
      const y = carrier * Math.pow(val, 1.08) * maxAmp * taperEnvelope(u);
      waveCoords.push([x, y, u]);

      // Soft vertical light flare on active peaks
      if (Math.abs(y) > maxAmp * 0.2) {
        const flareH = Math.abs(y) * 1.28;
        const flareCol = sampleColor3(c1, cMid, c2, u);
        const fGrad = oCtx.createLinearGradient(x, -flareH, x, flareH);
        fGrad.addColorStop(0, rgbStr(flareCol, 0));
        fGrad.addColorStop(0.5, rgbStr(lerpColor(flareCol, [255, 255, 255], 0.35), 0.28));
        fGrad.addColorStop(1, rgbStr(flareCol, 0));
        oCtx.strokeStyle = fGrad;
        oCtx.lineWidth = Math.max(1.2, 2.0 * scaleFactor);
        oCtx.beginPath();
        oCtx.moveTo(x, -flareH);
        oCtx.lineTo(x, flareH);
        oCtx.stroke();
      }
    }

    // Outer colored laser glow stroke (smooth Bezier curve)
    oCtx.beginPath();
    drawSmoothCurve(oCtx, waveCoords);
    oCtx.strokeStyle = makeSpanGrad(0.92);
    oCtx.lineWidth = Math.max(3.0, 4.8 * scaleFactor);
    oCtx.lineJoin = 'round';
    oCtx.lineCap = 'round';
    oCtx.stroke();

    // Inner white-hot core stroke (smooth Bezier curve)
    oCtx.beginPath();
    drawSmoothCurve(oCtx, waveCoords);
    oCtx.strokeStyle = 'rgba(242, 250, 255, 0.92)';
    oCtx.lineWidth = Math.max(1.2, 1.8 * scaleFactor);
    oCtx.stroke();

    // Layer D: Sparkle particles pulsing cleanly with local audio energy
    const sparkCount = 40;
    for (let s = 0; s < sparkCount; s++) {
      const su = (s + 0.3) / sparkCount;
      const sx = xStart + su * spanW;
      const sVal = sampleMusicalSpec(specCol, su, true);
      const sy = Math.sin(s * 3.7) * maxAmp * (0.06 + sVal * 0.55) * taperEnvelope(su);
      const sr = Math.max(1.2, (1.2 + sVal * 2.2) * scaleFactor);
      const sCol = sampleColor3(c1, cMid, c2, su);

      oCtx.fillStyle = rgbStr(sCol, 0.35 + sVal * 0.55);
      oCtx.beginPath();
      oCtx.arc(sx, sy, sr * 1.6, 0, Math.PI * 2);
      oCtx.fill();

      oCtx.fillStyle = `rgba(255, 255, 255, ${0.45 + sVal * 0.5})`;
      oCtx.beginPath();
      oCtx.arc(sx, sy, sr * 0.62, 0, Math.PI * 2);
      oCtx.fill();
    }
  } else if (style === 'double_flame') {
    // 13. Mirrored LED Square Matrix with Center Gap (Image 4: True 52-column spectrum analyzer with smooth fractional tips)
    const cols = 52;
    const stepX = spanW / cols;
    const cellW = Math.max(3.2 * scaleFactor, stepX * 0.68);
    const cellH = Math.max(3.0 * scaleFactor, cellW * 0.86);
    const gapY = Math.max(1.4 * scaleFactor, cellH * 0.28);
    const centerGap = Math.max(4.0 * scaleFactor, cellH * 0.85);
    const maxHalfRows = 10;

    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const val = sampleMusicalSpec(specCol, u, false);
      const exactRows = Math.max(
        0.5,
        Math.min(maxHalfRows, Math.pow(val, 1.08) * maxHalfRows * taperEnvelope(u))
      );
      const activeRows = Math.max(1, Math.ceil(exactRows));
      const x = xStart + i * stepX + (stepX - cellW) / 2;

      for (let r = 0; r < activeRows; r++) {
        const vFrac = r / Math.max(1, maxHalfRows - 1);
        const isTip = r === activeRows - 1;
        const tipAlpha = isTip ? Math.max(0.18, exactRows - Math.floor(exactRows) || 1) : 1;
        // Vertical 3-color mix from center gap (c1) -> middle (cMid) -> outer tip (c2)
        const rowCol = sampleColor3(c1, cMid, c2, vFrac);
        const yTop = -centerGap / 2 - (r + 1) * cellH - r * gapY;
        const yBot = centerGap / 2 + r * (cellH + gapY);

        oCtx.fillStyle = rgbStr(rowCol, 0.94 * tipAlpha);
        oCtx.fillRect(x, yTop, cellW, cellH);

        oCtx.fillStyle = rgbStr(rowCol, 0.86 * tipAlpha);
        oCtx.fillRect(x, yBot, cellW, cellH);
      }
    }
  } else if (style === 'triple_sine') {
    // 14. Three Intertwined Glowing Sine Ribbons (Synced to Low, Mid, and High pitch bands without fake timer spin)
    const pts = 72;
    const maxAmp = h * 0.145;
    const ribbons = [
      { phase: 0.0, bandShift: 0.0, col: c1, lw: 3.8 },
      { phase: 2.1, bandShift: 0.28, col: cMid, lw: 3.4 },
      { phase: 4.2, bandShift: 0.55, col: c2, lw: 3.6 },
    ];

    for (const r of ribbons) {
      const coords: Array<[number, number]> = [];
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const bandU = Math.min(0.95, u * 0.45 + r.bandShift);
        const val = sampleSpec(specCol, bandU);
        const y =
          Math.sin(u * Math.PI * 4.5 + r.phase) *
          Math.pow(val, 1.08) *
          maxAmp *
          taperEnvelope(u);
        coords.push([x, y]);
      }
      oCtx.beginPath();
      drawSmoothCurve(oCtx, coords);
      oCtx.strokeStyle = rgbStr(r.col, 0.94);
      oCtx.lineWidth = Math.max(2.2, r.lw * scaleFactor);
      oCtx.lineCap = 'round';
      oCtx.lineJoin = 'round';
      oCtx.stroke();
    }
  } else if (style === 'seismic_line') {
    // 15. Equalizer Bars with Floating Peak Caps & Water Reflection (Image 5: True 18-band equalizer without fake pulse timer)
    const count = 18;
    const step = spanW / count;
    const barW = Math.max(6 * scaleFactor, step * 0.58);
    const capH = Math.max(3.2 * scaleFactor, barW * 0.15);
    const maxBarH = h * 0.16;
    const lineThickness = Math.max(2.2 * scaleFactor, 3.2 * scaleFactor);

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const col = sampleColor3(c1, cMid, c2, u);
      const barH = Math.max(
        4 * scaleFactor,
        Math.pow(val, 1.08) * maxBarH * taperEnvelope(u)
      );
      const capGap = Math.max(5 * scaleFactor, (5 + val * 14) * scaleFactor);
      const x = xStart + i * step + (step - barW) / 2;

      // Upper main equalizer bar with soft top glow gradient
      const barGrad = oCtx.createLinearGradient(0, -lineThickness / 2 - barH, 0, -lineThickness / 2);
      barGrad.addColorStop(0, rgbStr(lerpColor(col, [255, 255, 255], 0.18), 0.94));
      barGrad.addColorStop(1, rgbStr(col, 0.98));
      oCtx.fillStyle = barGrad;
      oCtx.fillRect(x, -lineThickness / 2 - barH, barW, barH);

      // Upper floating peak-hold cap
      oCtx.fillStyle = rgbStr(lerpColor(col, [255, 255, 255], 0.25), 0.96);
      oCtx.fillRect(x, -lineThickness / 2 - barH - capGap - capH, barW, capH);

      // Lower mirrored water reflection bar
      const reflBarH = barH * 0.88;
      const reflGrad = oCtx.createLinearGradient(0, lineThickness / 2, 0, lineThickness / 2 + reflBarH);
      reflGrad.addColorStop(0, rgbStr(col, 0.38));
      reflGrad.addColorStop(1, rgbStr(col, 0.08));
      oCtx.fillStyle = reflGrad;
      oCtx.fillRect(x, lineThickness / 2, barW, reflBarH);

      // Lower mirrored floating peak-hold cap
      oCtx.fillStyle = rgbStr(col, 0.24);
      oCtx.fillRect(x, lineThickness / 2 + reflBarH + capGap * 0.85, barW, capH);
    }

    // Continuous glowing horizontal center line across the full span
    oCtx.fillStyle = makeSpanGrad(0.98);
    oCtx.fillRect(xStart, -lineThickness / 2, spanW, lineThickness);
  } else if (style === 'dj_dual_deck') {
    // 16. DJ Stereo Dual-Deck Fluid Waveform (Rekordbox/Serato-inspired smooth stereo mirror waves)
    const pts = 84;
    const maxAmp = h * 0.155;
    const phase = framePhase * 0.045;
    const topDeck: Array<[number, number]> = [];
    const botDeck: Array<[number, number]> = [];

    for (let i = 0; i < pts; i++) {
      const u = i / (pts - 1);
      const x = xStart + u * spanW;
      const val = sampleMusicalSpec(specCol, u, true);
      const waveMotion = 0.84 + 0.16 * Math.sin(u * Math.PI * 3.0 - phase);
      const amp = Math.pow(val, 1.04) * maxAmp * taperEnvelope(u) * waveMotion;
      topDeck.push([x, -amp]);
      botDeck.push([x, amp * 0.86]);
    }

    // Upper stereo deck translucent gradient fill
    const topFill = oCtx.createLinearGradient(0, -maxAmp, 0, 0);
    topFill.addColorStop(0, rgbStr(c1, 0.72));
    topFill.addColorStop(1, rgbStr(cMid, 0.14));
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    drawSmoothCurve(oCtx, topDeck);
    oCtx.lineTo(xEnd, 0);
    oCtx.closePath();
    oCtx.fillStyle = topFill;
    oCtx.fill();

    // Lower stereo deck translucent gradient fill
    const botFill = oCtx.createLinearGradient(0, 0, 0, maxAmp);
    botFill.addColorStop(0, rgbStr(cMid, 0.14));
    botFill.addColorStop(1, rgbStr(c2, 0.68));
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    drawSmoothCurve(oCtx, botDeck);
    oCtx.lineTo(xEnd, 0);
    oCtx.closePath();
    oCtx.fillStyle = botFill;
    oCtx.fill();

    // Silky glowing outer contour strokes
    oCtx.lineCap = 'round';
    oCtx.lineJoin = 'round';
    oCtx.lineWidth = Math.max(2.2, 3.4 * scaleFactor);
    oCtx.strokeStyle = makeSpanGrad(0.95);
    oCtx.beginPath();
    drawSmoothCurve(oCtx, topDeck);
    oCtx.stroke();

    oCtx.lineWidth = Math.max(1.8, 2.8 * scaleFactor);
    oCtx.strokeStyle = makeSpanGrad(0.82);
    oCtx.beginPath();
    drawSmoothCurve(oCtx, botDeck);
    oCtx.stroke();

    // Crisp luminous center cue rail
    oCtx.strokeStyle = rgbStr(lerpColor(cMid, [255, 255, 255], 0.55), 0.9);
    oCtx.lineWidth = Math.max(1.4, 2.0 * scaleFactor);
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    oCtx.lineTo(xEnd, 0);
    oCtx.stroke();
  } else if (style === 'dj_club_eq') {
    // 17. DJ Smooth Velvet Club Equalizer with Floating Luminous Peak Orbs
    const count = 28;
    const step = spanW / count;
    const barW = Math.max(6 * scaleFactor, step * 0.54);
    const maxBarH = h * 0.175;
    const baseY = maxBarH * 0.25;
    oCtx.lineCap = 'round';

    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const val = sampleMusicalSpec(specCol, u, true);
      const col = sampleColor3(c1, cMid, c2, u);
      const hiCol = lerpColor(col, [255, 255, 255], 0.48);
      const bh = Math.max(barW * 0.65, Math.pow(val, 1.04) * maxBarH * taperEnvelope(u));
      const x = xStart + (i + 0.5) * step;
      const yTop = baseY - bh;

      // Soft bottom reflection fade
      const reflGrad = oCtx.createLinearGradient(x, baseY, x, baseY + bh * 0.38);
      reflGrad.addColorStop(0, rgbStr(col, 0.34));
      reflGrad.addColorStop(1, rgbStr(col, 0));
      oCtx.strokeStyle = reflGrad;
      oCtx.lineWidth = barW;
      oCtx.beginPath();
      oCtx.moveTo(x, baseY + 3 * scaleFactor);
      oCtx.lineTo(x, baseY + bh * 0.38);
      oCtx.stroke();

      // Main silky rounded bar
      const vGrad = oCtx.createLinearGradient(x, yTop, x, baseY);
      vGrad.addColorStop(0, rgbStr(hiCol, 0.98));
      vGrad.addColorStop(0.45, rgbStr(col, 0.92));
      vGrad.addColorStop(1, rgbStr(lerpColor(col, [10, 15, 30], 0.35), 0.72));
      oCtx.strokeStyle = vGrad;
      oCtx.lineWidth = barW;
      oCtx.beginPath();
      oCtx.moveTo(x, baseY);
      oCtx.lineTo(x, yTop);
      oCtx.stroke();

      // Floating glowing orb above each column
      const orbGap = Math.max(6 * scaleFactor, (7 + val * 12) * scaleFactor);
      const orbR = Math.max(2.0, barW * 0.32);
      oCtx.fillStyle = rgbStr(hiCol, 0.92);
      oCtx.beginPath();
      oCtx.arc(x, yTop - orbGap, orbR, 0, Math.PI * 2);
      oCtx.fill();
    }
  } else if (style === 'dj_liquid_plasma') {
    // 18. DJ Liquid Plasma Silk Waves (3 smooth gliding translucent layers)
    const pts = 76;
    const maxAmp = h * 0.165;
    const phase = framePhase * 0.038;
    const layers = [
      { speed: 1.0, freq: 2.6, shift: 0.0, bandShift: 0.0, col: c1, alpha: 0.32, strokeA: 0.92 },
      { speed: -0.75, freq: 3.4, shift: 1.6, bandShift: 0.25, col: cMid, alpha: 0.28, strokeA: 0.88 },
      { speed: 0.6, freq: 4.2, shift: 3.2, bandShift: 0.5, col: c2, alpha: 0.24, strokeA: 0.9 },
    ];

    for (const lyr of layers) {
      const topPts: Array<[number, number]> = [];
      const botPts: Array<[number, number]> = [];
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const bandU = Math.min(0.95, Math.abs(u - 0.5) * 1.1 + lyr.bandShift);
        const val = sampleSpec(specCol, bandU);
        const swell = 0.72 + 0.28 * Math.sin(u * Math.PI * lyr.freq + phase * lyr.speed + lyr.shift);
        const amp = Math.pow(val, 1.02) * maxAmp * taperEnvelope(u) * swell;
        topPts.push([x, -amp]);
        botPts.push([x, amp * 0.76]);
      }

      oCtx.beginPath();
      drawSmoothCurve(oCtx, topPts);
      for (let i = botPts.length - 1; i >= 0; i--) {
        oCtx.lineTo(botPts[i][0], botPts[i][1]);
      }
      oCtx.closePath();
      oCtx.fillStyle = rgbStr(lyr.col, lyr.alpha);
      oCtx.fill();

      oCtx.lineCap = 'round';
      oCtx.lineJoin = 'round';
      oCtx.strokeStyle = rgbStr(lerpColor(lyr.col, [255, 255, 255], 0.28), lyr.strokeA);
      oCtx.lineWidth = Math.max(2.0, 2.8 * scaleFactor);
      oCtx.beginPath();
      drawSmoothCurve(oCtx, topPts);
      oCtx.stroke();
    }
  } else if (style === 'dj_pulse_horizon') {
    // 19. DJ Sub-Bass Pulse Horizon (wide liquid dome with mirrored lake shimmer)
    const pts = 90;
    const maxAmp = h * 0.18;
    const phase = framePhase * 0.032;
    const upper: Array<[number, number]> = [];
    const lower: Array<[number, number]> = [];

    for (let i = 0; i < pts; i++) {
      const u = i / (pts - 1);
      const x = xStart + u * spanW;
      const val = sampleMusicalSpec(specCol, u, true);
      const flow = 0.88 + 0.12 * Math.cos(u * Math.PI * 4.0 - phase);
      const dome = Math.pow(val, 1.03) * maxAmp * taperEnvelope(u) * flow;
      upper.push([x, -dome]);
      lower.push([x, dome * 0.45]);
    }

    const skyGrad = oCtx.createLinearGradient(0, -maxAmp, 0, 0);
    skyGrad.addColorStop(0, rgbStr(c1, 0.82));
    skyGrad.addColorStop(0.5, rgbStr(cMid, 0.46));
    skyGrad.addColorStop(1, rgbStr(c2, 0.08));
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    drawSmoothCurve(oCtx, upper);
    oCtx.lineTo(xEnd, 0);
    oCtx.closePath();
    oCtx.fillStyle = skyGrad;
    oCtx.fill();

    const waterGrad = oCtx.createLinearGradient(0, 0, 0, maxAmp * 0.45);
    waterGrad.addColorStop(0, rgbStr(cMid, 0.38));
    waterGrad.addColorStop(1, rgbStr(c2, 0.02));
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    drawSmoothCurve(oCtx, lower);
    oCtx.lineTo(xEnd, 0);
    oCtx.closePath();
    oCtx.fillStyle = waterGrad;
    oCtx.fill();

    oCtx.lineCap = 'round';
    oCtx.lineJoin = 'round';
    oCtx.strokeStyle = makeSpanGrad(0.98);
    oCtx.lineWidth = Math.max(2.6, 3.8 * scaleFactor);
    oCtx.beginPath();
    drawSmoothCurve(oCtx, upper);
    oCtx.stroke();

    // Horizon glow line
    const hGrad = oCtx.createLinearGradient(xStart, 0, xEnd, 0);
    hGrad.addColorStop(0, rgbStr(c1, 0));
    hGrad.addColorStop(0.15, rgbStr(c1, 0.9));
    hGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
    hGrad.addColorStop(0.85, rgbStr(c2, 0.9));
    hGrad.addColorStop(1, rgbStr(c2, 0));
    oCtx.strokeStyle = hGrad;
    oCtx.lineWidth = Math.max(2.0, 2.8 * scaleFactor);
    oCtx.beginPath();
    oCtx.moveTo(xStart, 0);
    oCtx.lineTo(xEnd, 0);
    oCtx.stroke();
  } else if (style === 'dj_vinyl_arc') {
    // 20. DJ Vinyl Groove Ribbon Arcs (sweeping fluid stereo ribbons with luminous beads)
    const pts = 80;
    const maxAmp = h * 0.145;
    const phase = framePhase * 0.04;
    const strands = [
      { mult: 1.0, phaseOff: 0.0, bandShift: 0.0, col: c1, lw: 3.4 },
      { mult: 0.78, phaseOff: 1.35, bandShift: 0.22, col: cMid, lw: 2.8 },
      { mult: 0.62, phaseOff: 2.7, bandShift: 0.45, col: c2, lw: 2.4 },
    ];

    for (let sIdx = 0; sIdx < strands.length; sIdx++) {
      const sCfg = strands[sIdx];
      const coords: Array<[number, number]> = [];
      for (let i = 0; i < pts; i++) {
        const u = i / (pts - 1);
        const x = xStart + u * spanW;
        const bandU = Math.min(0.95, u * 0.52 + sCfg.bandShift);
        const val = sampleSpec(specCol, bandU);
        const carrier = Math.sin(u * Math.PI * 3.5 + phase + sCfg.phaseOff);
        const y = carrier * Math.pow(val, 1.02) * maxAmp * sCfg.mult * taperEnvelope(u);
        coords.push([x, y]);
      }

      oCtx.lineCap = 'round';
      oCtx.lineJoin = 'round';
      oCtx.strokeStyle = rgbStr(sCfg.col, 0.92);
      oCtx.lineWidth = Math.max(2.0, sCfg.lw * scaleFactor);
      oCtx.beginPath();
      drawSmoothCurve(oCtx, coords);
      oCtx.stroke();

      // Subtle glowing groove beads along the primary strand
      if (sIdx === 0) {
        const beadCol = lerpColor(c1, [255, 255, 255], 0.52);
        oCtx.fillStyle = rgbStr(beadCol, 0.92);
        for (let b = 4; b < coords.length - 4; b += 7) {
          oCtx.beginPath();
          oCtx.arc(coords[b][0], coords[b][1], Math.max(2.2, 3.6 * scaleFactor), 0, Math.PI * 2);
          oCtx.fill();
        }
      }
    }
  }

  oCtx.restore();

  // 3. 3-Layer Soft Atmospheric Neon Bloom ("ฟุ้งและนุ่มนวล") scaled by user opacity
  // Layer 3A: Wide Dreamy Atmospheric Aura (low-res glowCanvas upscaled)
  const gCtx = glowCanvas.getContext('2d')!;
  gCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  gCtx.save();
  const wideBlurPx = Math.max(4, Math.round(18 * (glowCanvas.width / w) * scaleFactor * 3));
  gCtx.filter = `blur(${wideBlurPx}px)`;
  gCtx.drawImage(overlayCanvas, 0, 0, glowCanvas.width, glowCanvas.height);
  gCtx.restore();

  // Layer 3B: Medium Soft Neon Halo (workCanvas - half-res for 4x faster GPU/CPU blur)
  const wCtx = workCanvas.getContext('2d')!;
  wCtx.clearRect(0, 0, workCanvas.width, workCanvas.height);
  wCtx.save();
  const medBlurPx = Math.max(2, Math.round(11 * (workCanvas.width / w) * scaleFactor));
  wCtx.filter = `blur(${medBlurPx}px)`;
  wCtx.drawImage(overlayCanvas, 0, 0, workCanvas.width, workCanvas.height);
  wCtx.restore();

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'lighter';
  // Wide atmospheric bloom
  targetCtx.globalAlpha = 0.92 * wfLayout.opacity;
  targetCtx.drawImage(glowCanvas, 0, 0, w, h);
  // Medium silky halo
  targetCtx.globalAlpha = 0.68 * wfLayout.opacity;
  targetCtx.drawImage(workCanvas, 0, 0, w, h);
  // Softly feathered core waveform
  targetCtx.globalAlpha = 0.88 * wfLayout.opacity;
  targetCtx.drawImage(overlayCanvas, 0, 0, w, h);
  targetCtx.restore();
}
