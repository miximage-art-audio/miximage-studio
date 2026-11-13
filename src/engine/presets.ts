import midnightSynth from '../assets/images/artwork_midnight_synth_1794603085399.jpg';
import vinylEclipse from '../assets/images/artwork_vinyl_eclipse_1794603085426.jpg';
import tokyoRain from '../assets/images/artwork_tokyo_rain_1794603085551.jpg';

export type AspectRatioKey = '1:1' | '2:3' | '3:2' | '4:5' | '5:4' | '16:9' | '9:16';
export type WaveformStyle = 'neon_bars' | 'smooth_wave' | 'circular_core';
export type ColorThemeKey = 'cyberpunk' | 'gold_fire' | 'ice_blue' | 'emerald';
export type FitMode = 'cover' | 'blur_pad';
export type FpsOption = 30 | 60;

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
    key: 'neon_bars',
    label: 'แท่งนีออนสมมาตร',
    description: 'สเปกตรัม 64 ย่าน ขยับขึ้น 100% สะท้อนล่าง 35%',
  },
  {
    key: 'smooth_wave',
    label: 'คลื่นน้ำไหลต่อเนื่อง',
    description: 'เส้นโค้งมนไล่เฉดสีโปร่งแสง พริ้วไหวทันสมัย',
  },
  {
    key: 'circular_core',
    label: 'วงแหวนพลังงาน 360°',
    description: 'วงแหวนแผ่รัศมีกลางจอ ขยายหดตามแรงกระแทกเบส',
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

export const DEMO_ARTWORKS: DemoArtwork[] = [
  {
    id: 'midnight-synth',
    title: 'Analog Synth Studio',
    aspectHint: '16:9',
    src: midnightSynth,
  },
  {
    id: 'vinyl-eclipse',
    title: 'Vinyl Eclipse Cover',
    aspectHint: '1:1',
    src: vinylEclipse,
  },
  {
    id: 'tokyo-rain',
    title: 'Tokyo Rain Reflections',
    aspectHint: '9:16',
    src: tokyoRain,
  },
];
