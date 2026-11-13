import {
  AspectRatioKey,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformLayoutConfig,
  WaveformStyle,
} from './presets';

export interface CloudWorkflowDefaults {
  ratio: AspectRatioKey;
  style: WaveformStyle;
  theme: ColorThemeKey;
  bass: number;
  fit: FitMode;
  fps: FpsOption;
  layout?: WaveformLayoutConfig;
}

export function generateRequirementsTxt(): string {
  return `numpy>=1.24.0
scipy>=1.10.0
librosa>=0.10.1
opencv-python-headless>=4.8.0
soundfile>=0.12.1
`;
}

export function generateRenderEnginePy(): string {
  return `import argparse
import os
import subprocess
import numpy as np
import cv2
import librosa
from scipy.ndimage import gaussian_filter1d

# ตารางกำหนดความละเอียดพิกเซล (กว้าง x สูง) สำหรับอัตราส่วนภาพทั้ง 7 ขนาด
ASPECT_RATIOS = {
    "1:1": (1080, 1080),
    "2:3": (1080, 1620),
    "3:2": (1620, 1080),
    "4:5": (1080, 1350),
    "5:4": (1350, 1080),
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
}

# ชุดโทนสีสำหรับคลื่นเสียง (ระบบสี BGR ของ OpenCV)
COLOR_THEMES = {
    "cyberpunk": ((255, 240, 0), (255, 0, 180)),   # ฟ้าไซแอน ไล่เฉดไป ชมพูมาเจนตา
    "gold_fire": ((0, 215, 255), (0, 60, 255)),    # สีทองคำ ไล่เฉดไป ส้มเพลิง
    "ice_blue": ((255, 255, 180), (255, 100, 0)),  # ขาวไอซ์บลู ไล่เฉดไป น้ำเงินเข้ม
    "emerald": ((150, 255, 0), (0, 180, 80)),      # เขียวนีออน ไล่เฉดไป เขียวมรกต
}

ALL_WAVEFORM_STYLES = [
    "neon_bars",
    "smooth_wave",
    "circular_core",
    "mirror_horizon",
    "pulse_rings",
    "particle_burst",
    "dual_ribbon",
    "matrix_blocks",
]


def convert_to_wav(input_audio_path, temp_wav="temp_decoded.wav"):
    """
    แปลงไฟล์เสียงทุกประเภท (.mp3, .wav, .flac, .m4a, .aac, .ogg, .opus, .wma, .aiff)
    ให้เป็นไฟล์ WAV มาตรฐานชั่วคราวด้วย FFmpeg เพื่อความแม่นยำในการวิเคราะห์คลื่นความถี่
    """
    cmd = [
        "ffmpeg", "-y", "-i", input_audio_path,
        "-ac", "1", "-ar", "44100", "-vn", temp_wav
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return temp_wav


def analyze_audio(wav_path, fps, n_bars=64):
    """
    วิเคราะห์ไฟล์เสียงเพื่อแยกย่านความถี่เบส (20Hz - 150Hz) สำหรับสั่งภาพกระตุก
    และแยกสเปกตรัมความถี่ 64 ย่านสำหรับวาดคลื่นเสียง
    """
    y, sr = librosa.load(wav_path, sr=44100, mono=True)
    hop_length = int(sr / fps)
    n_fft = 2048

    stft = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # 1. สกัดเฉพาะย่านความถี่เบส 20Hz - 150Hz
    bass_idx = np.where((freqs >= 20) & (freqs <= 150))[0]
    bass_raw = np.mean(stft[bass_idx, :], axis=0)
    if np.max(bass_raw) > 0:
        bass_raw = bass_raw / np.max(bass_raw)

    bass_env = np.zeros_like(bass_raw)
    attack, release = 0.65, 0.18
    for i in range(1, len(bass_raw)):
        if bass_raw[i] > bass_env[i - 1]:
            bass_env[i] = attack * bass_raw[i] + (1 - attack) * bass_env[i - 1]
        else:
            bass_env[i] = release * bass_raw[i] + (1 - release) * bass_env[i - 1]
    bass_env = np.power(bass_env, 1.4)

    # 2. สกัดสเปกตรัมความถี่ 64 แท่ง (30Hz - 12,000Hz)
    mel_spec = librosa.feature.melspectrogram(
        S=stft**2, sr=sr, n_mels=n_bars, fmin=30, fmax=12000
    )
    mel_db = librosa.power_to_db(mel_spec, ref=np.max)
    mel_norm = (mel_db + 80.0) / 80.0
    mel_norm = np.clip(mel_norm, 0.0, 1.0)
    mel_norm = gaussian_filter1d(mel_norm, sigma=0.9, axis=1)

    return bass_env, mel_norm, len(bass_env)


def prepare_base_image(img_path, target_w, target_h, fit_mode="cover"):
    """
    ปรับขนาดและจัดวางรูปภาพต้นฉบับให้ตรงกับอัตราส่วนที่เลือก
    รองรับทั้งโหมด cover (เต็มกรอบ) และ blur_pad (พื้นหลังเบลอ + ภาพเต็มใบ)
    """
    img = cv2.imread(img_path)
    if img is None:
        raise FileNotFoundError(f"ไม่พบไฟล์รูปภาพที่ระบุ: {img_path}")

    ih, iw = img.shape[:2]
    scale_cover = max(target_w / iw, target_h / ih)
    nw, nh = int(iw * scale_cover), int(ih * scale_cover)
    bg = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LANCZOS4)
    x0, y0 = (nw - target_w) // 2, (nh - target_h) // 2
    cover_crop = bg[y0:y0 + target_h, x0:x0 + target_w].copy()

    if fit_mode == "cover":
        return cover_crop

    blurred_bg = cv2.GaussianBlur(cover_crop, (0, 0), sigmaX=35, sigmaY=35)
    blurred_bg = (blurred_bg * 0.45).astype(np.uint8)

    scale_contain = min(target_w / iw, target_h / ih)
    cw, ch = int(iw * scale_contain), int(ih * scale_contain)
    fg = cv2.resize(img, (cw, ch), interpolation=cv2.INTER_LANCZOS4)
    px, py = (target_w - cw) // 2, (target_h - ch) // 2
    blurred_bg[py:py + ch, px:px + cw] = fg
    return blurred_bg


def apply_bass_transform(base_img, bass_val, intensity_mult):
    """
    สร้างเอฟเฟกต์ภาพกระตุกตามจังหวะเบส (ขยายภาพ + แรงสั่นสะเทือน + แสงวาบ)
    """
    h, w = base_img.shape[:2]
    zoom = 1.0 + (bass_val * 0.10 * intensity_mult)

    shake_px = int(bass_val * 14 * intensity_mult) if bass_val > 0.45 else 0
    dx = np.random.randint(-shake_px, shake_px + 1) if shake_px > 0 else 0
    dy = np.random.randint(-shake_px, shake_px + 1) if shake_px > 0 else 0

    M = cv2.getRotationMatrix2D((w / 2 + dx, h / 2 + dy), 0, zoom)
    frame = cv2.warpAffine(base_img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    if bass_val > 0.3:
        boost = 1.0 + (bass_val - 0.3) * 0.25 * intensity_mult
        frame = np.clip(frame.astype(np.float32) * boost, 0, 255).astype(np.uint8)

    return frame


def lerp_bgr(c1, c2, ratio):
    return tuple(int(c1[c] * (1.0 - ratio) + c2[c] * ratio) for c in range(3))


def draw_waveform(
    frame, spec_col, bass_val, style, theme_name,
    pos_x=0.5, pos_y=0.82, wf_scale=1.0, opacity=1.0, frame_idx=0
):
    """
    วาดกราฟิกคลื่นเสียง 8 สไตล์ พร้อมย้ายตำแหน่ง ปรับขนาด ปรับความโปร่งใส และเอฟเฟกต์ Neon Bloom
    """
    if opacity <= 0.001:
        return frame

    h, w = frame.shape[:2]
    overlay = np.zeros_like(frame)
    c1, c2 = COLOR_THEMES.get(theme_name, COLOR_THEMES["cyberpunk"])
    n_bars = len(spec_col)
    cx, cy = int(w * pos_x), int(h * pos_y)

    if style == "neon_bars":
        bar_area_w = int(w * 0.82 * wf_scale)
        start_x = cx - bar_area_w // 2
        max_bar_h = int(h * 0.16 * wf_scale)
        step = bar_area_w / n_bars
        bar_w = max(2, int(step * 0.6))
        for i, val in enumerate(spec_col):
            color = lerp_bgr(c1, c2, i / max(1, n_bars - 1))
            bh = max(4, int((val ** 1.3) * max_bar_h * (1.0 + bass_val * 0.35)))
            x = int(start_x + i * step)
            cv2.rectangle(overlay, (x, cy - bh), (x + bar_w, cy + int(bh * 0.35)), color, -1, cv2.LINE_AA)

    elif style == "smooth_wave":
        span_w = int(w * 0.84 * wf_scale)
        max_amp = int(h * 0.15 * wf_scale)
        xs = np.linspace(cx - span_w // 2, cx + span_w // 2, n_bars)
        amps = (spec_col ** 1.25) * max_amp * (1.0 + bass_val * 0.3)
        pts_top = np.column_stack((xs, cy - amps)).astype(np.int32)
        pts_bot = np.column_stack((xs[::-1], cy + amps[::-1] * 0.45)).astype(np.int32)
        cv2.fillPoly(overlay, [np.vstack((pts_top, pts_bot))], c2, cv2.LINE_AA)
        cv2.polylines(overlay, [pts_top], False, c1, max(2, int(4 * wf_scale)), cv2.LINE_AA)

    elif style == "circular_core":
        base_r = int(min(w, h) * 0.18 * wf_scale * (1.0 + bass_val * 0.22))
        max_len = int(min(w, h) * 0.16 * wf_scale)
        angles = np.linspace(0, 2 * np.pi, n_bars, endpoint=False)
        for i, angle in enumerate(angles):
            color = lerp_bgr(c1, c2, i / max(1, n_bars - 1))
            length = max(4, int((spec_col[i] ** 1.3) * max_len))
            x1, y1 = int(cx + np.cos(angle) * base_r), int(cy + np.sin(angle) * base_r)
            x2, y2 = int(cx + np.cos(angle) * (base_r + length)), int(cy + np.sin(angle) * (base_r + length))
            cv2.line(overlay, (x1, y1), (x2, y2), color, max(2, int(4 * wf_scale)), cv2.LINE_AA)
        cv2.circle(overlay, (cx, cy), base_r, c1, max(2, int(3 * wf_scale)), cv2.LINE_AA)

    elif style == "mirror_horizon":
        bar_area_w = int(w * 0.84 * wf_scale)
        start_x = cx - bar_area_w // 2
        max_half_h = int(h * 0.13 * wf_scale)
        step = bar_area_w / n_bars
        bar_w = max(2, int(step * 0.58))
        cv2.line(overlay, (start_x, cy), (start_x + bar_area_w, cy), c1, max(2, int(3 * wf_scale)), cv2.LINE_AA)
        for i, val in enumerate(spec_col):
            color = lerp_bgr(c1, c2, i / max(1, n_bars - 1))
            hh = max(3, int((val ** 1.28) * max_half_h * (1.0 + bass_val * 0.35)))
            x = int(start_x + i * step)
            cv2.rectangle(overlay, (x, cy - hh), (x + bar_w, cy + hh), color, -1, cv2.LINE_AA)

    elif style == "pulse_rings":
        min_dim = min(w, h) * wf_scale
        slices = [(0, 18, 0.12, 0.045, c1), (18, 42, 0.21, 0.055, lerp_bgr(c1, c2, 0.5)), (42, 64, 0.30, 0.05, c2)]
        for r_idx, (s, e, br, amp_s, col) in enumerate(slices):
            pts = []
            pulse_r = min_dim * br * (1.0 + bass_val * (0.22 - r_idx * 0.04))
            for p in range(72):
                ang = (p / 72.0) * 2 * np.pi
                b_idx = int(s + (p / 72.0) * (e - s)) % n_bars
                rad = pulse_r + (spec_col[b_idx] ** 1.2) * (min_dim * amp_s)
                pts.append([int(cx + np.cos(ang) * rad), int(cy + np.sin(ang) * rad)])
            cv2.polylines(overlay, [np.array(pts, dtype=np.int32)], True, col, max(2, int(3 * wf_scale)), cv2.LINE_AA)

    elif style == "particle_burst":
        min_dim = min(w, h) * wf_scale
        inner_r = int(min_dim * 0.11 * (1.0 + bass_val * 0.24))
        max_dist = min_dim * 0.24
        cv2.circle(overlay, (cx, cy), inner_r, c1, max(2, int(3 * wf_scale)), cv2.LINE_AA)
        for i, val in enumerate(spec_col):
            color = lerp_bgr(c1, c2, i / max(1, n_bars - 1))
            ang = (i * 2 * np.pi) / n_bars + frame_idx * 0.012
            dist = inner_r + (val ** 1.25) * max_dist * (1.0 + bass_val * 0.25)
            x1, y1 = int(cx + np.cos(ang) * inner_r), int(cy + np.sin(ang) * inner_r)
            x2, y2 = int(cx + np.cos(ang) * dist), int(cy + np.sin(ang) * dist)
            cv2.line(overlay, (x1, y1), (x2, y2), color, max(1, int(2 * wf_scale)), cv2.LINE_AA)
            cv2.circle(overlay, (x2, y2), max(3, int((3.5 + val * 6.5) * wf_scale)), color, -1, cv2.LINE_AA)

    elif style == "dual_ribbon":
        span_w = int(w * 0.86 * wf_scale)
        max_amp = int(h * 0.14 * wf_scale)
        xs = np.linspace(cx - span_w // 2, cx + span_w // 2, n_bars)
        for sign, col in [(-1.0, c1), (1.0, c2)]:
            pts = []
            for i, val in enumerate(spec_col):
                mod = np.sin(i * 0.35 + frame_idx * 0.15 * sign)
                y = cy + sign * (val ** 1.15) * max_amp * (0.65 + 0.35 * mod) * (1.0 + bass_val * 0.32)
                pts.append([int(xs[i]), int(y)])
            cv2.polylines(overlay, [np.array(pts, dtype=np.int32)], False, col, max(2, int(4 * wf_scale)), cv2.LINE_AA)

    elif style == "matrix_blocks":
        bar_area_w = int(w * 0.84 * wf_scale)
        start_x = cx - bar_area_w // 2
        max_blocks = 14
        total_h = int(h * 0.22 * wf_scale)
        step = bar_area_w / n_bars
        block_w = max(2, int(step * 0.64))
        cell_step = total_h / max_blocks
        block_h = max(2, int(cell_step * 0.68))
        for i, val in enumerate(spec_col):
            color = lerp_bgr(c1, c2, i / max(1, n_bars - 1))
            count = max(1, min(max_blocks, int(round((val ** 1.2) * max_blocks * (1.0 + bass_val * 0.25)))))
            x = int(start_x + i * step)
            for b in range(count):
                y = int(cy - b * cell_step - block_h)
                col = (255, 255, 255) if b == count - 1 else color
                cv2.rectangle(overlay, (x, y), (x + block_w, y + block_h), col, -1, cv2.LINE_AA)

    glow = cv2.GaussianBlur(overlay, (0, 0), sigmaX=15, sigmaY=15)
    combined = cv2.addWeighted(frame, 1.0, glow, 0.85 * opacity, 0)
    combined = cv2.addWeighted(combined, 1.0, overlay, 0.95 * opacity, 0)
    return combined


def main():
    parser = argparse.ArgumentParser(description="ระบบเรนเดอร์วิดีโอซิ้งเบสและคลื่นเสียงอัตโนมัติ")
    parser.add_argument("--image", required=True, help="ที่อยู่ไฟล์รูปภาพ")
    parser.add_argument("--audio", required=True, help="ที่อยู่ไฟล์เสียง")
    parser.add_argument("--output", default="output_bass_sync.mp4", help="ชื่อไฟล์วิดีโอผลลัพธ์")
    parser.add_argument("--ratio", default="16:9", choices=list(ASPECT_RATIOS.keys()), help="อัตราส่วนภาพ")
    parser.add_argument("--style", default="neon_bars", choices=ALL_WAVEFORM_STYLES, help="รูปแบบคลื่นเสียง")
    parser.add_argument("--theme", default="cyberpunk", choices=list(COLOR_THEMES.keys()), help="โทนสีคลื่นเสียง")
    parser.add_argument("--bass", type=float, default=1.0, help="ความแรงการกระตุกตามเบส")
    parser.add_argument("--fit", default="cover", choices=["cover", "blur_pad"], help="โหมดการจัดวางภาพ")
    parser.add_argument("--fps", type=int, default=30, help="จำนวนเฟรมต่อวินาที")
    parser.add_argument("--pos-x", type=float, default=0.50, help="ตำแหน่งแนวนอนคลื่นเสียง (0.10 - 0.90)")
    parser.add_argument("--pos-y", type=float, default=0.82, help="ตำแหน่งแนวตั้งคลื่นเสียง (0.10 - 0.90)")
    parser.add_argument("--scale", type=float, default=1.0, help="ขนาดคลื่นเสียง (0.40 - 2.00)")
    parser.add_argument("--opacity", type=float, default=1.0, help="ความโปร่งใสคลื่นเสียง (0.00 - 1.00)")
    args = parser.parse_args()

    target_w, target_h = ASPECT_RATIOS[args.ratio]
    print(f"[ขั้นตอนที่ 1/4] กำลังถอดรหัสไฟล์เสียงและวิเคราะห์ย่านเบส (ขนาดภาพ {args.ratio} -> {target_w}x{target_h} พิกเซล)...")
    wav_path = convert_to_wav(args.audio)
    bass_env, mel_spec, total_frames = analyze_audio(wav_path, args.fps)

    print(f"[ขั้นตอนที่ 2/4] กำลังเตรียมภาพพื้นหลังในโหมด '{args.fit}'...")
    base_img = prepare_base_image(args.image, target_w, target_h, args.fit)

    print(f"[ขั้นตอนที่ 3/4] เริ่มเรนเดอร์ภาพทั้งหมด {total_frames} เฟรม ส่งตรงเข้า FFmpeg...")
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{target_w}x{target_h}", "-pix_fmt", "bgr24",
        "-r", str(args.fps), "-i", "-",
        "-i", args.audio,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "320k",
        "-shortest", args.output
    ]
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)
    for f_idx in range(total_frames):
        b_val = bass_env[f_idx]
        s_col = mel_spec[:, f_idx]
        frame = apply_bass_transform(base_img, b_val, args.bass)
        frame = draw_waveform(
            frame, s_col, b_val, args.style, args.theme,
            pos_x=args.pos_x, pos_y=args.pos_y,
            wf_scale=args.scale, opacity=args.opacity, frame_idx=f_idx
        )
        proc.stdin.write(frame.tobytes())

    proc.stdin.close()
    proc.wait()

    if os.path.exists(wav_path):
        os.remove(wav_path)
    print(f"[ขั้นตอนที่ 4/4] เรนเดอร์วิดีโอเสร็จสมบูรณ์ บันทึกไฟล์ไว้ที่: {args.output}")


if __name__ == "__main__":
    main()
`;
}

export function generateCloudRenderYaml(defaults: CloudWorkflowDefaults): string {
  const bassChoices = [0.0, 0.1, 0.2, 0.3, 0.5, 1.0, 1.5, 2.0];
  const bassChoice = bassChoices.reduce((prev, curr) =>
    Math.abs(curr - defaults.bass) < Math.abs(prev - defaults.bass) ? curr : prev
  ).toFixed(1);

  const posX = (defaults.layout?.posX ?? 0.5).toFixed(2);
  const posY = (defaults.layout?.posY ?? 0.82).toFixed(2);
  const scale = (defaults.layout?.scale ?? 1.0).toFixed(2);
  const opacity = (defaults.layout?.opacity ?? 1.0).toFixed(2);

  return `name: ระบบเรนเดอร์วิดีโอซิ้งเบสและคลื่นเสียงบนคลาวด์

on:
  workflow_dispatch:
    inputs:
      aspect_ratio:
        description: '1. เลือกอัตราส่วนภาพ (Aspect Ratio)'
        required: true
        default: '${defaults.ratio}'
        type: choice
        options:
          - '1:1'
          - '2:3'
          - '3:2'
          - '4:5'
          - '5:4'
          - '16:9'
          - '9:16'
      waveform_style:
        description: '2. เลือกรูปแบบคลื่นเสียง (8 สไตล์)'
        required: true
        default: '${defaults.style}'
        type: choice
        options:
          - 'neon_bars'
          - 'smooth_wave'
          - 'circular_core'
          - 'mirror_horizon'
          - 'pulse_rings'
          - 'particle_burst'
          - 'dual_ribbon'
          - 'matrix_blocks'
      color_theme:
        description: '3. เลือกโทนสีคลื่นเสียง'
        required: true
        default: '${defaults.theme}'
        type: choice
        options:
          - 'cyberpunk'
          - 'gold_fire'
          - 'ice_blue'
          - 'emerald'
      bass_intensity:
        description: '4. เลือกความแรงภาพกระตุกตามเบส (0.0 = ปิด, 0.2 = เบามาก, 0.5 = เบา, 1.0 = มาตรฐาน)'
        required: true
        default: '${bassChoice}'
        type: choice
        options:
          - '0.0'
          - '0.1'
          - '0.2'
          - '0.3'
          - '0.5'
          - '1.0'
          - '1.5'
          - '2.0'
      fit_mode:
        description: '5. เลือกการจัดวางรูปภาพ'
        required: true
        default: '${defaults.fit}'
        type: choice
        options:
          - 'cover'
          - 'blur_pad'
      fps:
        description: '6. เลือกความลื่นไหลของภาพ (FPS)'
        required: true
        default: '${defaults.fps}'
        type: choice
        options:
          - '30'
          - '60'
      pos_x:
        description: '7. ตำแหน่งแนวนอนคลื่นเสียง (0.10 - 0.90)'
        required: true
        default: '${posX}'
        type: string
      pos_y:
        description: '8. ตำแหน่งแนวตั้งคลื่นเสียง (0.10 - 0.90)'
        required: true
        default: '${posY}'
        type: string
      waveform_scale:
        description: '9. ขนาดคลื่นเสียง (0.40 - 2.00)'
        required: true
        default: '${scale}'
        type: string
      waveform_opacity:
        description: '10. ความโปร่งใสคลื่นเสียง (0.00 - 1.00)'
        required: true
        default: '${opacity}'
        type: string

jobs:
  render_video:
    runs-on: ubuntu-latest
    steps:
      - name: ดึงไฟล์โค้ดและไฟล์สื่อจาก Repository
        uses: actions/checkout@v4

      - name: ติดตั้ง FFmpeg และระบบถอดรหัสเสียงบนเซิร์ฟเวอร์
        run: |
          sudo apt-get update
          sudo apt-get install -y ffmpeg libsndfile1

      - name: ตั้งค่าสภาพแวดล้อม Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: ติดตั้งไลบรารีประมวลผลเสียงและภาพ
        run: pip install -r requirements.txt

      - name: ค้นหาไฟล์ภาพและไฟล์เสียงอัตโนมัติพร้อมสั่งเรนเดอร์วิดีโอ
        run: |
          IMAGE_FILE=$(find input/ -type f \\( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" -o -iname "*.bmp" \\) | head -n 1)
          AUDIO_FILE=$(find input/ -type f \\( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.opus" -o -iname "*.wma" -o -iname "*.aiff" \\) | head -n 1)
          echo "ไฟล์ภาพที่ตรวจพบ: $IMAGE_FILE"
          echo "ไฟล์เสียงที่ตรวจพบ: $AUDIO_FILE"
          python render_engine.py \\
            --image "$IMAGE_FILE" \\
            --audio "$AUDIO_FILE" \\
            --output "miximage_render.mp4" \\
            --ratio "\${{ inputs.aspect_ratio }}" \\
            --style "\${{ inputs.waveform_style }}" \\
            --theme "\${{ inputs.color_theme }}" \\
            --bass "\${{ inputs.bass_intensity }}" \\
            --fit "\${{ inputs.fit_mode }}" \\
            --fps "\${{ inputs.fps }}" \\
            --pos-x "\${{ inputs.pos_x }}" \\
            --pos-y "\${{ inputs.pos_y }}" \\
            --scale "\${{ inputs.waveform_scale }}" \\
            --opacity "\${{ inputs.waveform_opacity }}"

      - name: อัปโหลดไฟล์วิดีโอที่เรนเดอร์เสร็จแล้วให้ดาวน์โหลด
        uses: actions/upload-artifact@v4
        with:
          name: miximage-video-\${{ inputs.waveform_style }}-\${{ inputs.fps }}fps
          path: miximage_render.mp4
          retention-days: 7
`;
}
