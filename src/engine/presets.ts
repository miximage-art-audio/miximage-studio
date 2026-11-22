export type AspectRatioKey = '1:1' | '2:3' | '3:2' | '4:5' | '5:4' | '16:9' | '9:16';
export type WaveformStyle =
  | 'bars_3d'
  | 'layered_fluid'
  | 'dot_halftone'
  | 'pixel_grid'
  | 'mesh_ribbon'
  | 'smooth_osc'
  | 'mirror_needles'
  | 'silk_aura'
  | 'prism_peaks'
  | 'brush_spectrum'
  | 'harmonic_waves'
  | 'dot_mountains'
  | 'double_flame'
  | 'triple_sine'
  | 'seismic_line';
export type ColorThemeKey = 'cyberpunk' | 'gold_fire' | 'ice_blue' | 'emerald';
export type FitMode = 'cover' | 'blur_pad';
export type FpsOption = 30 | 60;

export interface WaveformLayoutConfig {
  posX: number; // normalized 0.10 .. 0.90 (0.50 = center)
  posY: number; // normalized 0.10 .. 0.90
  scale: number; // 0.40 .. 2.00 (1.00 = default)
  opacity: number; // 0.00 .. 1.00 (1.00 = opaque)
}

export function getDefaultWaveformLayout(_style?: WaveformStyle): WaveformLayoutConfig {
  return {
    posX: 0.5,
    posY: 0.80,
    scale: 1.0,
    opacity: 1.0,
  };
}

export function clampWaveformLayout(config: WaveformLayoutConfig): WaveformLayoutConfig {
  return {
    posX: Math.min(0.9, Math.max(0.1, Number(config.posX.toFixed(3)))),
    posY: Math.min(0.9, Math.max(0.1, Number(config.posY.toFixed(3)))),
    scale: Math.min(2.0, Math.max(0.4, Number(config.scale.toFixed(2)))),
    opacity: Math.min(1.0, Math.max(0.0, Number(config.opacity.toFixed(2)))),
  };
}

export interface AspectRatioSpec {
  key: AspectRatioKey;
  width: number;
  height: number;
  label: string;
  usage: string;
}

export const ASPECT_RATIOS: Record<AspectRatioKey, AspectRatioSpec> = {
  '1:1': {
    key: '1:1',
    width: 1080,
    height: 1080,
    label: '1:1 จัตุรัส',
    usage: 'หน้าปกซิงเกิล, โพสต์ Facebook & Instagram',
  },
  '2:3': {
    key: '2:3',
    width: 1080,
    height: 1620,
    label: '2:3 แนวตั้ง',
    usage: 'โปสเตอร์ดิจิทัล, Pinterest และงานพิมพ์',
  },
  '3:2': {
    key: '3:2',
    width: 1620,
    height: 1080,
    label: '3:2 แนวนอน',
    usage: 'สัดส่วนมาตรฐานกล้อง DSLR / Mirrorless',
  },
  '4:5': {
    key: '4:5',
    width: 1080,
    height: 1350,
    label: '4:5 ฟีดแนวตั้ง',
    usage: 'ฟีดขนาดใหญ่ Facebook & Instagram',
  },
  '5:4': {
    key: '5:4',
    width: 1350,
    height: 1080,
    label: '5:4 กึ่งจัตุรัส',
    usage: 'งานกราฟิกและภาพอาร์ตเวิร์กแนวนอน',
  },
  '16:9': {
    key: '16:9',
    width: 1920,
    height: 1080,
    label: '16:9 ไวด์สกรีน',
    usage: 'YouTube และมิวสิกวิดีโอ Full HD',
  },
  '9:16': {
    key: '9:16',
    width: 1080,
    height: 1920,
    label: '9:16 เต็มจอมือถือ',
    usage: 'TikTok, YouTube Shorts และ Reels',
  },
};

export interface ColorThemeSpec {
  key: ColorThemeKey;
  label: string;
  description: string;
  c1Rgb: [number, number, number];
  c2Rgb: [number, number, number];
  c1Bgr: [number, number, number];
  c2Bgr: [number, number, number];
}

export const COLOR_THEMES: Record<ColorThemeKey, ColorThemeSpec> = {
  cyberpunk: {
    key: 'cyberpunk',
    label: 'Cyberpunk',
    description: 'ฟ้าไซแอน — ชมพูมาเจนตา',
    c1Rgb: [0, 240, 255],
    c2Rgb: [180, 0, 255],
    c1Bgr: [255, 240, 0],
    c2Bgr: [255, 0, 180],
  },
  gold_fire: {
    key: 'gold_fire',
    label: 'Gold Fire',
    description: 'ทองคำ — ส้มเพลิง',
    c1Rgb: [255, 215, 0],
    c2Rgb: [255, 60, 0],
    c1Bgr: [0, 215, 255],
    c2Bgr: [0, 60, 255],
  },
  ice_blue: {
    key: 'ice_blue',
    label: 'Ice Blue',
    description: 'ขาวไอซ์บลู — น้ำเงินเข้ม',
    c1Rgb: [180, 255, 255],
    c2Rgb: [0, 100, 255],
    c1Bgr: [255, 255, 180],
    c2Bgr: [255, 100, 0],
  },
  emerald: {
    key: 'emerald',
    label: 'Emerald',
    description: 'เขียวนีออน — เขียวมรกต',
    c1Rgb: [0, 255, 150],
    c2Rgb: [80, 180, 0],
    c1Bgr: [150, 255, 0],
    c2Bgr: [0, 180, 80],
  },
};

export const WAVEFORM_STYLES: Array<{
  key: WaveformStyle;
  label: string;
  description: string;
}> = [
  {
    key: 'bars_3d',
    label: 'แท่ง 3D อีควอ',
    description: 'แท่งสเปกตรัม 3 มิติพร้อมสันนูนและเงาสะท้อนนุ่มนวล',
  },
  {
    key: 'layered_fluid',
    label: 'คลื่นชั้นฟลูอิด',
    description: 'คลื่นฟลูอิดซ้อน 3 ชั้นไล่เฉดสีนุ่มนวล',
  },
  {
    key: 'dot_halftone',
    label: 'จุดแฮฟโทน',
    description: 'แท่งคลื่นจุดสมมาตรไล่ความเข้มจากแกนกลาง',
  },
  {
    key: 'pixel_grid',
    label: 'บล็อก LED 3D',
    description: 'บล็อกพิกเซลสมมาตรสไตล์สตูดิโอ 3 มิติ',
  },
  {
    key: 'mesh_ribbon',
    label: 'ตาข่ายริบบิ้น 3D',
    description: 'เส้นตาข่ายอนุภาค 3 มิติบิดเกลียวพริ้วไหว',
  },
  {
    key: 'smooth_osc',
    label: 'เส้นคลื่นนุ่ม',
    description: 'เส้นโค้งความถี่ไหลลื่นต่อเนื่อง',
  },
  {
    key: 'mirror_needles',
    label: 'เข็มสมมาตร',
    description: 'เข็มความถี่ละเอียดสมมาตรบน-ล่างคมชัด',
  },
  {
    key: 'silk_aura',
    label: 'ม่านแสงซิลค์',
    description: 'ม่านเส้นแสงฟุ้งนุ่มนวลไล่ขอบโปร่งแสง',
  },
  {
    key: 'prism_peaks',
    label: 'พีระมิดคลื่น',
    description: 'คลื่นทรงผลึกโปร่งแสงซ้อนทับสมมาตร',
  },
  {
    key: 'brush_spectrum',
    label: 'พู่กันความถี่',
    description: 'แถบความถี่ลายพู่กันละเอียดไล่ปลายเรียว',
  },
  {
    key: 'harmonic_waves',
    label: 'คลื่นฮาร์มอนิก',
    description: 'ริบบิ้นฮาร์มอนิกซ้อนหลายชั้นพร้อมขอบเรืองแสง',
  },
  {
    key: 'dot_mountains',
    label: 'ภูเขาจุด 3D',
    description: 'สันเขาจุด 3 มิติไต่ระดับตามสเปกตรัมความถี่',
  },
  {
    key: 'double_flame',
    label: 'เปลวสมมาตร',
    description: 'เปลวคลื่นพลังงานซ้อนสมมาตรทรงพลัง',
  },
  {
    key: 'triple_sine',
    label: 'ริบบิ้น 3 เส้น',
    description: 'เส้นคลื่นไซน์ 3 สายสลับเฟสพริ้วไหว',
  },
  {
    key: 'seismic_line',
    label: 'เส้นซิงก์จังหวะ',
    description: 'เส้นคลื่นซิงก์จังหวะสมมาตรเรียวปลายสองข้าง',
  },
];

export const FIT_MODES: Array<{
  key: FitMode;
  label: string;
  description: string;
}> = [
  {
    key: 'cover',
    label: 'Cover เต็มกรอบ',
    description: 'ขยายและครอปจากจุดกึ่งกลางพอดีกรอบ ไม่มีขอบดำ',
  },
  {
    key: 'blur_pad',
    label: 'Blur Pad ภาพเต็มใบ',
    description: 'พื้นหลังเบลอฟุ้งลดสว่าง 55% + ภาพต้นฉบับเต็มใบตรงกลาง',
  },
];

export const BASS_INTENSITY_PRESETS = [
  { value: 0.0, label: '0.0x ปิด' },
  { value: 0.2, label: '0.2x เบามาก' },
  { value: 0.5, label: '0.5x เบา' },
  { value: 1.0, label: '1.0x มาตรฐาน' },
  { value: 1.5, label: '1.5x แรง' },
  { value: 2.0, label: '2.0x โหด' },
];

export const SUPPORTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.flac',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.wma',
  '.aiff',
];

export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
];

export interface DemoArtwork {
  id: string;
  title: string;
  aspectHint: string;
  src: string;
}
