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
    "cyberpunk": ((255, 240, 0), (255, 0, 180)),          # ฟ้าไซแอน - ชมพูมาเจนตา
    "gold_fire": ((0, 215, 255), (0, 60, 255)),           # ทองคำ - ส้มเพลิง
    "ice_blue": ((255, 255, 180), (255, 100, 0)),         # ไอซ์บลู - น้ำเงินเข้ม
    "emerald": ((150, 255, 0), (0, 180, 80)),             # เขียวนีออน - มรกต
    "tt_crimson_cyan": ((86, 30, 255), (255, 229, 0)),    # ทูโทน แดง-ฟ้า
    "tt_gold_violet": ((0, 208, 255), (246, 92, 139)),    # ทูโทน ทอง-ม่วง
    "tt_pink_lime": ((147, 46, 255), (18, 255, 163)),     # ทูโทน ชมพู-มะนาว
    "tt_white_cobalt": ((252, 250, 248), (235, 99, 37)),  # ทูโทน ขาว-น้ำเงิน
    "tt_orange_teal": ((0, 107, 255), (166, 184, 20)),    # ทูโทน ส้ม-เทอร์ควอยซ์
    "gr_sunset_synth": ((11, 190, 255), (110, 0, 255)),   # ไล่เฉด Sunset Synth
    "gr_aurora_dream": ((212, 245, 0), (229, 93, 155)),   # ไล่เฉด Aurora Dream
    "gr_tropical_prism": ((94, 89, 255), (38, 201, 138)), # ไล่เฉด Tropical Prism
    "gr_midnight_velvet": ((248, 189, 56), (249, 121, 232)), # ไล่เฉด Midnight Velvet
    "gr_lava_magma": ((176, 243, 255), (40, 40, 214)),    # ไล่เฉด Lava Magma
}

ALL_WAVEFORM_STYLES = [
    "bars_3d",
    "layered_fluid",
    "dot_halftone",
    "pixel_grid",
    "mesh_ribbon",
    "smooth_osc",
    "mirror_needles",
    "silk_aura",
    "prism_peaks",
    "brush_spectrum",
    "harmonic_waves",
    "dot_mountains",
    "double_flame",
    "triple_sine",
    "seismic_line",
    "dj_dual_deck",
    "dj_club_eq",
    "dj_liquid_plasma",
    "dj_pulse_horizon",
    "dj_vinyl_arc",
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
    attack, release = 0.80, 0.28
    for i in range(1, len(bass_raw)):
        if bass_raw[i] > bass_env[i - 1]:
            bass_env[i] = attack * bass_raw[i] + (1 - attack) * bass_env[i - 1]
        else:
            bass_env[i] = release * bass_raw[i] + (1 - release) * bass_env[i - 1]
    bass_env = gaussian_filter1d(np.power(bass_env, 1.35), sigma=0.55)

    # Onset Flux (พลังงานเบสเฟรมปัจจุบันลบค่าเฉลี่ยย้อนหลัง 8 เฟรม, clamp >= 0)
    onset_flux = np.zeros_like(bass_env)
    for i in range(len(bass_env)):
        win_start = max(0, i - 8)
        prev_avg = float(np.mean(bass_env[win_start:i])) if i > 0 else 0.0
        onset_flux[i] = min(1.0, max(0.0, float(bass_env[i]) - prev_avg))

    # 2. สกัดสเปกตรัมความถี่ 64 แท่ง (30Hz - 12,000Hz) พร้อมกรองความนุ่มนวล
    mel_spec = librosa.feature.melspectrogram(
        S=stft**2, sr=sr, n_mels=n_bars, fmin=30, fmax=12000
    )
    mel_db = librosa.power_to_db(mel_spec, ref=np.max)
    mel_norm = (mel_db + 80.0) / 80.0
    mel_norm = np.clip(mel_norm, 0.0, 1.0)
    mel_norm = gaussian_filter1d(mel_norm, sigma=0.65, axis=1)

    return bass_env, onset_flux, mel_norm, len(bass_env)


def prepare_base_image(img_path, target_w, target_h, fit_mode="center"):
    """
    ปรับขนาดและจัดวางรูปภาพต้นฉบับให้ตรงกับอัตราส่วนที่เลือก
    รองรับโหมด center (วางกึ่งกลางพอดี), cover (เต็มกรอบ) และ blur_pad (พื้นหลังเบลอ + ภาพเต็มใบ)
    """
    img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(f"ไม่พบไฟล์รูปภาพที่ระบุ: {img_path}")

    if img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        bg_dark = np.full((img.shape[0], img.shape[1], 3), (22, 13, 9), dtype=np.float32)
        bgr = (img[:, :, :3].astype(np.float32) * alpha + bg_dark * (1.0 - alpha)).astype(np.uint8)
        img = bgr

    ih, iw = img.shape[:2]
    if fit_mode == "center":
        canvas = np.full((target_h, target_w, 3), (22, 13, 9), dtype=np.uint8)
        scale_center = min((target_w * 0.64) / iw, (target_h * 0.56) / ih)
        cw, ch = max(1, int(iw * scale_center)), max(1, int(ih * scale_center))
        fg = cv2.resize(img, (cw, ch), interpolation=cv2.INTER_LANCZOS4)
        px, py = (target_w - cw) // 2, (target_h - ch) // 2
        canvas[py:py + ch, px:px + cw] = fg
        return canvas

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


def apply_bass_transform(base_img, punch_val, intensity_mult):
    """
    สร้างเอฟเฟกต์ภาพกระตุกตามจังหวะเบสด้วย Onset Flux (ขยายภาพ + แรงสั่นสะเทือน + แสงวาบ)
    """
    h, w = base_img.shape[:2]
    zoom = 1.0 + (punch_val * 0.12 * intensity_mult)

    shake_px = int(punch_val * 12 * intensity_mult) if punch_val > 0.18 else 0
    dx = np.random.randint(-shake_px, shake_px + 1) if shake_px > 0 else 0
    dy = np.random.randint(-shake_px, shake_px + 1) if shake_px > 0 else 0

    M = cv2.getRotationMatrix2D((w / 2 + dx, h / 2 + dy), 0, zoom)
    frame = cv2.warpAffine(base_img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    if punch_val > 0.15:
        boost = 1.0 + (punch_val - 0.15) * 0.30 * intensity_mult
        frame = np.clip(frame.astype(np.float32) * boost, 0, 255).astype(np.uint8)

    return frame


def lerp_bgr(c1, c2, ratio):
    return tuple(int(c1[c] * (1.0 - ratio) + c2[c] * ratio) for c in range(3))


def draw_waveform(
    frame, spec_col, bass_val, style, theme_name,
    pos_x=0.5, pos_y=0.80, wf_scale=1.0, opacity=1.0, frame_idx=0
):
    """
    วาดกราฟิกคลื่นเสียง 15 สไตล์ (แท่ง 3D และคลื่นแนวนอน ไม่มีวงกลม) พร้อมปรับตำแหน่ง ขนาด โปร่งใส และ Neon Bloom
    """
    if opacity <= 0.001:
        return frame

    h, w = frame.shape[:2]
    overlay = np.zeros_like(frame)
    c1, c2 = COLOR_THEMES.get(theme_name, COLOR_THEMES["cyberpunk"])
    c_mid = lerp_bgr(c1, c2, 0.5)
    n_bars = len(spec_col)
    cx, cy = int(w * pos_x), int(h * pos_y)
    span_w = int(w * 0.84 * wf_scale)
    x_start = cx - span_w // 2

    def sample_u(u):
        pos = max(0.0, min(1.0, u)) * (n_bars - 1)
        i0 = int(pos)
        i1 = min(n_bars - 1, i0 + 1)
        t = pos - i0
        return spec_col[i0] * (1.0 - t) + spec_col[i1] * t

    def taper(u):
        return np.sin(max(0.0, min(1.0, u)) * np.pi) * 0.65 + 0.35

    if style == "bars_3d":
        count = 36
        step = span_w / count
        bar_w = max(4, int(step * 0.54))
        dx3 = max(3, int(bar_w * 0.36))
        dy3 = max(2, int(bar_w * 0.26))
        max_h = int(h * 0.17 * wf_scale)
        base_y = cy + int(max_h * 0.15)
        for i in range(count):
            u = i / max(1, count - 1)
            val = sample_u(u)
            col = lerp_bgr(c1, c2, u)
            side_col = tuple(int(v * 0.5) for v in col)
            top_col = tuple(min(255, int(v * 0.45 + 140)) for v in col)
            bh = max(6, int((val ** 1.25) * max_h * (1.0 + bass_val * 0.28)))
            x = int(x_start + i * step + (step - bar_w) * 0.3)
            yt = base_y - bh
            cv2.rectangle(overlay, (x, yt), (x + bar_w, base_y), col, -1, cv2.LINE_AA)
            side_pts = np.array([[x + bar_w, yt], [x + bar_w + dx3, yt - dy3], [x + bar_w + dx3, base_y - dy3], [x + bar_w, base_y]], dtype=np.int32)
            top_pts = np.array([[x, yt], [x + dx3, yt - dy3], [x + bar_w + dx3, yt - dy3], [x + bar_w, yt]], dtype=np.int32)
            cv2.fillPoly(overlay, [side_pts], side_col, cv2.LINE_AA)
            cv2.fillPoly(overlay, [top_pts], top_col, cv2.LINE_AA)

    elif style == "pixel_grid":
        cols = 48
        step_x = span_w / cols
        cell_w = max(3, int(step_x * 0.62))
        cell_h = max(3, int(cell_w * 0.72))
        gap_y = max(2, int(cell_h * 0.32))
        for i in range(cols):
            u = i / max(1, cols - 1)
            col = lerp_bgr(c1, c2, u)
            cnt = max(1, min(8, int(round((sample_u(u) ** 1.18) * 8 * taper(u) * (1.0 + bass_val * 0.25)))))
            x = int(x_start + i * step_x)
            for b in range(cnt):
                off = b * (cell_h + gap_y)
                c = (255, 255, 255) if b == cnt - 1 else col
                cv2.rectangle(overlay, (x, cy - off - cell_h // 2), (x + cell_w, cy - off + cell_h // 2), c, -1, cv2.LINE_AA)
                if b > 0:
                    cv2.rectangle(overlay, (x, cy + off - cell_h // 2), (x + cell_w, cy + off + cell_h // 2), c, -1, cv2.LINE_AA)

    elif style in ("dot_halftone", "dot_mountains"):
        cols = 52
        step_x = span_w / cols
        max_hh = int(h * 0.14 * wf_scale)
        for i in range(cols):
            u = i / max(1, cols - 1)
            col = lerp_bgr(c1, c2, u)
            x = int(x_start + (i + 0.5) * step_x)
            hh = max(6, int((sample_u(u) ** 1.2) * max_hh * taper(u) * (1.0 + bass_val * 0.28)))
            if style == "dot_halftone":
                step_y = max(5, int(6.5 * wf_scale))
                for d in range(0, max(1, hh // step_y) + 1):
                    r = max(1, int(3 * wf_scale * (1.0 - 0.5 * d / max(1, hh // step_y))))
                    cv2.circle(overlay, (x, cy - d * step_y), r, col, -1, cv2.LINE_AA)
                    if d > 0:
                        cv2.circle(overlay, (x, cy + d * step_y), r, col, -1, cv2.LINE_AA)
            else:
                peak_h = max(10, int((max(0.14, sample_u(u)) ** 0.92) * max_hh * 1.15 * taper(u) * (1.0 + bass_val * 0.30)))
                for row in range(10):
                    frac = row / 9.0
                    py = int(cy + max_hh * 0.25 - (frac ** 0.85) * peak_h - frac * 6 * wf_scale)
                    px = int(x + (frac - 0.5) * 16 * wf_scale)
                    cv2.circle(overlay, (px, py), max(1, int((1.8 + frac * 1.4) * wf_scale)), col, -1, cv2.LINE_AA)

    elif style in ("mirror_needles", "silk_aura", "brush_spectrum"):
        cols = 96
        step_x = span_w / cols
        max_hh = int(h * 0.15 * wf_scale)
        lw = max(1, int((step_x * 0.75) if style != "mirror_needles" else 2 * wf_scale))
        for i in range(cols):
            u = i / max(1, cols - 1)
            col = lerp_bgr(c1, c2, u)
            x = int(x_start + i * step_x)
            hh = max(3, int((sample_u(u) ** 1.2) * max_hh * taper(u) * (1.0 + bass_val * 0.28)))
            cv2.line(overlay, (x, cy - hh), (x, cy + hh), col, lw, cv2.LINE_AA)

    else:
        pts_cnt = 72
        max_amp = int(h * 0.145 * wf_scale)
        freq_map = {"smooth_osc": 10.0, "triple_sine": 7.0, "seismic_line": 22.0, "mesh_ribbon": 3.5}
        freq = freq_map.get(style, 5.0)
        if style in ("layered_fluid", "prism_peaks", "harmonic_waves", "double_flame"):
            top_pts, bot_pts = [], []
            for i in range(pts_cnt):
                u = i / (pts_cnt - 1)
                x = int(x_start + u * span_w)
                amp = int((sample_u(u) ** 1.15) * max_amp * taper(u) * (0.72 + 0.28 * np.sin(u * np.pi * freq + frame_idx * 0.11)))
                top_pts.append([x, cy - amp])
                bot_pts.append([x, cy + int(amp * 0.85)])
            poly = np.vstack((np.array(top_pts, dtype=np.int32), np.array(bot_pts[::-1], dtype=np.int32)))
            cv2.fillPoly(overlay, [poly], c_mid, cv2.LINE_AA)
            cv2.polylines(overlay, [np.array(top_pts, dtype=np.int32)], False, c1, max(2, int(3 * wf_scale)), cv2.LINE_AA)
        else:
            for layer_i, col in enumerate([c1, c_mid, c2] if style in ("triple_sine", "mesh_ribbon") else [c1]):
                pts = []
                for i in range(pts_cnt):
                    u = i / (pts_cnt - 1)
                    x = int(x_start + u * span_w)
                    y = int(cy + np.sin(u * np.pi * freq + frame_idx * 0.14 + layer_i * 2.1) * (sample_u(u) ** 1.1) * max_amp * taper(u))
                    pts.append([x, y])
                cv2.polylines(overlay, [np.array(pts, dtype=np.int32)], False, col, max(2, int(3.5 * wf_scale)), cv2.LINE_AA)

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
    parser.add_argument("--style", default="bars_3d", choices=ALL_WAVEFORM_STYLES, help="รูปแบบคลื่นเสียง")
    parser.add_argument("--theme", default="cyberpunk", choices=list(COLOR_THEMES.keys()), help="โทนสีคลื่นเสียง")
    parser.add_argument("--bass", type=float, default=1.0, help="ความแรงการกระตุกตามเบส")
    parser.add_argument("--fit", default="center", choices=["center", "cover", "blur_pad"], help="โหมดการจัดวางภาพ")
    parser.add_argument("--fps", type=int, default=30, help="จำนวนเฟรมต่อวินาที")
    parser.add_argument("--pos-x", type=float, default=0.50, help="ตำแหน่งแนวนอนคลื่นเสียง (0.10 - 0.90)")
    parser.add_argument("--pos-y", type=float, default=0.80, help="ตำแหน่งแนวตั้งคลื่นเสียง (0.10 - 0.90)")
    parser.add_argument("--scale", type=float, default=1.0, help="ขนาดคลื่นเสียง (0.40 - 2.00)")
    parser.add_argument("--opacity", type=float, default=1.0, help="ความโปร่งใสคลื่นเสียง (0.00 - 1.00)")
    args = parser.parse_args()

    target_w, target_h = ASPECT_RATIOS[args.ratio]
    print(f"[ขั้นตอนที่ 1/4] กำลังถอดรหัสไฟล์เสียงและวิเคราะห์ย่านเบส (ขนาดภาพ {args.ratio} -> {target_w}x{target_h} พิกเซล)...")
    wav_path = convert_to_wav(args.audio)
    bass_env, onset_flux, mel_spec, total_frames = analyze_audio(wav_path, args.fps)

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
        o_flux = onset_flux[f_idx]
        s_col = mel_spec[:, f_idx]
        frame = apply_bass_transform(base_img, o_flux, args.bass)
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
        description: '2. เลือกรูปแบบคลื่นเสียง (20 สไตล์)'
        required: true
        default: '${defaults.style}'
        type: choice
        options:
          - 'bars_3d'
          - 'layered_fluid'
          - 'dot_halftone'
          - 'pixel_grid'
          - 'mesh_ribbon'
          - 'smooth_osc'
          - 'mirror_needles'
          - 'silk_aura'
          - 'prism_peaks'
          - 'brush_spectrum'
          - 'harmonic_waves'
          - 'dot_mountains'
          - 'double_flame'
          - 'triple_sine'
          - 'seismic_line'
          - 'dj_dual_deck'
          - 'dj_club_eq'
          - 'dj_liquid_plasma'
          - 'dj_pulse_horizon'
          - 'dj_vinyl_arc'
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
          - 'tt_crimson_cyan'
          - 'tt_gold_violet'
          - 'tt_pink_lime'
          - 'tt_white_cobalt'
          - 'tt_orange_teal'
          - 'gr_sunset_synth'
          - 'gr_aurora_dream'
          - 'gr_tropical_prism'
          - 'gr_midnight_velvet'
          - 'gr_lava_magma'
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
          - 'center'
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
          IMAGE_FILE=$(find input/ -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" -o -iname "*.bmp" \) | head -n 1)
          AUDIO_FILE=$(find input/ -type f \( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.opus" -o -iname "*.wma" -o -iname "*.aiff" \) | head -n 1)
          echo "ไฟล์ภาพที่ตรวจพบ: $IMAGE_FILE"
          echo "ไฟล์เสียงที่ตรวจพบ: $AUDIO_FILE"
          python render_engine.py \
            --image "$IMAGE_FILE" \
            --audio "$AUDIO_FILE" \
            --output "miximage_render.mp4" \
            --ratio "\${{ inputs.aspect_ratio }}" \
            --style "\${{ inputs.waveform_style }}" \
            --theme "\${{ inputs.color_theme }}" \
            --bass "\${{ inputs.bass_intensity }}" \
            --fit "\${{ inputs.fit_mode }}" \
            --fps "\${{ inputs.fps }}" \
            --pos-x "\${{ inputs.pos_x }}" \
            --pos-y "\${{ inputs.pos_y }}" \
            --scale "\${{ inputs.waveform_scale }}" \
            --opacity "\${{ inputs.waveform_opacity }}"

      - name: อัปโหลดไฟล์วิดีโอที่เรนเดอร์เสร็จแล้วให้ดาวน์โหลด
        uses: actions/upload-artifact@v4
        with:
          name: miximage-video-\${{ inputs.waveform_style }}-\${{ inputs.fps }}fps
          path: miximage_render.mp4
          retention-days: 7
`;
}
