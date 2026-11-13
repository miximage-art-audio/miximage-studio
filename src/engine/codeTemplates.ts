import {
  AspectRatioKey,
  ColorThemeKey,
  FitMode,
  FpsOption,
  WaveformStyle,
} from './presets';

export interface CloudWorkflowDefaults {
  ratio: AspectRatioKey;
  style: WaveformStyle;
  theme: ColorThemeKey;
  bass: number;
  fit: FitMode;
  fps: FpsOption;
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

    # คำนวณพลังงานคลื่นเสียงในแต่ละช่วงเวลา
    stft = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # 1. สกัดเฉพาะย่านความถี่เบส 20Hz - 150Hz
    bass_idx = np.where((freqs >= 20) & (freqs <= 150))[0]
    bass_raw = np.mean(stft[bass_idx, :], axis=0)
    if np.max(bass_raw) > 0:
        bass_raw = bass_raw / np.max(bass_raw)

    # ปรับความนุ่มนวลแบบ Attack/Release ให้จังหวะกระแทกคมชัดแต่ไม่สั่นมั่ว
    bass_env = np.zeros_like(bass_raw)
    attack, release = 0.65, 0.18
    for i in range(1, len(bass_raw)):
        if bass_raw[i] > bass_env[i - 1]:
            bass_env[i] = attack * bass_raw[i] + (1 - attack) * bass_env[i - 1]
        else:
            bass_env[i] = release * bass_raw[i] + (1 - release) * bass_env[i - 1]
    bass_env = np.power(bass_env, 1.4)

    # 2. สกัดสเปกตรัมความถี่ 64 แท่ง (30Hz - 12,000Hz) สำหรับวาดคลื่นเสียง
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

    # โหมด blur_pad: สร้างพื้นหลังเบลอฟุ้งและลดความสว่างลง 55% เพื่อขับภาพหลักให้เด่น
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

    # สร้างแรงสั่นสะเทือนแกน X/Y เฉพาะช่วงที่เบสกระแทกเกิน 45%
    shake_px = int(bass_val * 14 * intensity_mult) if bass_val > 0.45 else 0
    dx = np.random.randint(-shake_px, shake_px + 1) if shake_px > 0 else 0
    dy = np.random.randint(-shake_px, shake_px + 1) if shake_px > 0 else 0

    M = cv2.getRotationMatrix2D((w / 2 + dx, h / 2 + dy), 0, zoom)
    frame = cv2.warpAffine(base_img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    # เร่งความสว่างของภาพเล็กน้อยในเสี้ยววินาทีที่เบสลงหนัก
    if bass_val > 0.3:
        boost = 1.0 + (bass_val - 0.3) * 0.25 * intensity_mult
        frame = np.clip(frame.astype(np.float32) * boost, 0, 255).astype(np.uint8)

    return frame


def draw_waveform(frame, spec_col, bass_val, style, theme_name):
    """
    วาดกราฟิกคลื่นเสียง 3 สไตล์ พร้อมสร้างเอฟเฟกต์แสงฟุ้งเรืองแสง (Neon Bloom)
    """
    h, w = frame.shape[:2]
    overlay = np.zeros_like(frame)
    c1, c2 = COLOR_THEMES.get(theme_name, COLOR_THEMES["cyberpunk"])
    n_bars = len(spec_col)

    if style == "neon_bars":
        # สไตล์ที่ 1: แท่งคลื่นสมมาตรเรืองแสงด้านล่างหน้าจอ
        bar_area_w = int(w * 0.82)
        start_x = (w - bar_area_w) // 2
        base_y = int(h * 0.84)
        max_bar_h = int(h * 0.16)
        step = bar_area_w / n_bars
        bar_w = max(2, int(step * 0.6))

        for i, val in enumerate(spec_col):
            ratio = i / max(1, n_bars - 1)
            color = tuple(int(c1[c] * (1 - ratio) + c2[c] * ratio) for c in range(3))
            bh = max(4, int((val ** 1.3) * max_bar_h * (1.0 + bass_val * 0.35)))
            x = int(start_x + i * step)
            cv2.rectangle(overlay, (x, base_y - bh), (x + bar_w, base_y + int(bh * 0.35)), color, -1, cv2.LINE_AA)

    elif style == "smooth_wave":
        # สไตล์ที่ 2: คลื่นน้ำไหลต่อเนื่องไล่เฉดสีโปร่งแสง
        base_y = int(h * 0.84)
        max_amp = int(h * 0.15)
        xs = np.linspace(int(w * 0.08), int(w * 0.92), n_bars)
        amps = (spec_col ** 1.25) * max_amp * (1.0 + bass_val * 0.3)

        pts_top = np.column_stack((xs, base_y - amps)).astype(np.int32)
        pts_bot = np.column_stack((xs[::-1], base_y + amps[::-1] * 0.45)).astype(np.int32)
        poly = np.vstack((pts_top, pts_bot))
        cv2.fillPoly(overlay, [poly], c2, cv2.LINE_AA)
        cv2.polylines(overlay, [pts_top], False, c1, 4, cv2.LINE_AA)

    elif style == "circular_core":
        # สไตล์ที่ 3: วงแหวนพลังงานคลื่นเสียงตรงกลางภาพที่เต้นขยายตามจังหวะเบส
        cx, cy = w // 2, h // 2
        base_r = int(min(w, h) * 0.18 * (1.0 + bass_val * 0.22))
        max_len = int(min(w, h) * 0.16)
        angles = np.linspace(0, 2 * np.pi, n_bars, endpoint=False)

        for i, angle in enumerate(angles):
            ratio = i / max(1, n_bars - 1)
            color = tuple(int(c1[c] * (1 - ratio) + c2[c] * ratio) for c in range(3))
            length = max(4, int((spec_col[i] ** 1.3) * max_len))
            x1 = int(cx + np.cos(angle) * base_r)
            y1 = int(cy + np.sin(angle) * base_r)
            x2 = int(cx + np.cos(angle) * (base_r + length))
            y2 = int(cy + np.sin(angle) * (base_r + length))
            cv2.line(overlay, (x1, y1), (x2, y2), color, 4, cv2.LINE_AA)
        cv2.circle(overlay, (cx, cy), base_r, c1, 3, cv2.LINE_AA)

    # สร้างแสงเรืองแสงรอบคลื่นเสียงด้วย Gaussian Blur ซ้อน 2 ชั้น
    glow = cv2.GaussianBlur(overlay, (0, 0), sigmaX=15, sigmaY=15)
    combined = cv2.addWeighted(frame, 1.0, glow, 0.85, 0)
    combined = cv2.addWeighted(combined, 1.0, overlay, 0.95, 0)
    return combined


def main():
    parser = argparse.ArgumentParser(description="ระบบเรนเดอร์วิดีโอซิ้งเบสและคลื่นเสียงอัตโนมัติ")
    parser.add_argument("--image", required=True, help="ที่อยู่ไฟล์รูปภาพ")
    parser.add_argument("--audio", required=True, help="ที่อยู่ไฟล์เสียง")
    parser.add_argument("--output", default="output_bass_sync.mp4", help="ชื่อไฟล์วิดีโอผลลัพธ์")
    parser.add_argument("--ratio", default="16:9", choices=list(ASPECT_RATIOS.keys()), help="อัตราส่วนภาพ")
    parser.add_argument("--style", default="neon_bars", choices=["neon_bars", "smooth_wave", "circular_core"], help="รูปแบบคลื่นเสียง")
    parser.add_argument("--theme", default="cyberpunk", choices=list(COLOR_THEMES.keys()), help="โทนสีคลื่นเสียง")
    parser.add_argument("--bass", type=float, default=1.0, help="ความแรงการกระตุกตามเบส")
    parser.add_argument("--fit", default="cover", choices=["cover", "blur_pad"], help="โหมดการจัดวางภาพ")
    parser.add_argument("--fps", type=int, default=30, help="จำนวนเฟรมต่อวินาที")
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
        frame = draw_waveform(frame, s_col, b_val, args.style, args.theme)
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
  const bassChoice = [0.5, 1.0, 1.5, 2.0].reduce((prev, curr) =>
    Math.abs(curr - defaults.bass) < Math.abs(prev - defaults.bass) ? curr : prev
  ).toFixed(1);

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
        description: '2. เลือกรูปแบบคลื่นเสียง (neon_bars = แท่งนีออน, smooth_wave = คลื่นน้ำไหล, circular_core = วงแหวนกลางจอ)'
        required: true
        default: '${defaults.style}'
        type: choice
        options:
          - 'neon_bars'
          - 'smooth_wave'
          - 'circular_core'
      color_theme:
        description: '3. เลือกโทนสีคลื่นเสียง (cyberpunk = ฟ้าชมพู, gold_fire = ทองส้ม, ice_blue = ขาวน้ำเงิน, emerald = เขียวมรกต)'
        required: true
        default: '${defaults.theme}'
        type: choice
        options:
          - 'cyberpunk'
          - 'gold_fire'
          - 'ice_blue'
          - 'emerald'
      bass_intensity:
        description: '4. เลือกความแรงภาพกระตุกตามเบส (0.5 = เบา, 1.0 = มาตรฐาน, 1.5 = แรง, 2.0 = โหด)'
        required: true
        default: '${bassChoice}'
        type: choice
        options:
          - '0.5'
          - '1.0'
          - '1.5'
          - '2.0'
      fit_mode:
        description: '5. เลือกการจัดวางรูปภาพ (cover = ขยายเต็มจอ, blur_pad = พื้นหลังเบลอวางภาพเต็มใบ)'
        required: true
        default: '${defaults.fit}'
        type: choice
        options:
          - 'cover'
          - 'blur_pad'
      fps:
        description: '6. เลือกความลื่นไหลของภาพ (30 หรือ 60 เฟรมต่อวินาที)'
        required: true
        default: '${defaults.fps}'
        type: choice
        options:
          - '30'
          - '60'

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
            --fps "\${{ inputs.fps }}"

      - name: อัปโหลดไฟล์วิดีโอที่เรนเดอร์เสร็จแล้วให้ดาวน์โหลด
        uses: actions/upload-artifact@v4
        with:
          name: miximage-video-\${{ inputs.waveform_style }}-\${{ inputs.fps }}fps
          path: miximage_render.mp4
          retention-days: 7
`;
}
