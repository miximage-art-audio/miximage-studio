import midnightSynth from '../assets/images/artwork_midnight_synth_1794603085399.jpg';
import vinylEclipse from '../assets/images/artwork_vinyl_eclipse_1794603085426.jpg';
import tokyoRain from '../assets/images/artwork_tokyo_rain_1794603085551.jpg';
import { DemoArtwork } from './presets';

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
