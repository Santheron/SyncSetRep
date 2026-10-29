// Program screens paint the dark surface even when the phone theme is light.
// Primary buttons on that surface use the dark pair. The light pair is for a
// screen whose background is actually light.

export type ButtonSurface = 'dark' | 'light';

export type ButtonPalette = {
  surface: ButtonSurface;
  background: string;
  label: string;
  icon: string;
};

const DARK_SURFACE: ButtonPalette = {
  surface: 'dark',
  background: '#C6FF4D',
  label: '#111111',
  icon: '#111111',
};

const LIGHT_SURFACE: ButtonPalette = {
  surface: 'light',
  background: '#111111',
  label: '#F4F4F5',
  icon: '#F4F4F5',
};

export function buttonPaletteForSurface(surface: ButtonSurface): ButtonPalette {
  return surface === 'light' ? LIGHT_SURFACE : DARK_SURFACE;
}

function linearChannel(value: number): number {
  const channel = value / 255;
  if (channel <= 0.04045) {
    return channel / 12.92;
  }
  return ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const body = hex.replace('#', '');
  const full = body.length === 3 ? body.split('').map((part) => part + part).join('') : body;
  const red = linearChannel(Number.parseInt(full.slice(0, 2), 16));
  const green = linearChannel(Number.parseInt(full.slice(2, 4), 16));
  const blue = linearChannel(Number.parseInt(full.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
