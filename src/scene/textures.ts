import * as THREE from 'three';
import { CONFIG } from '../config';
import type { CourseColors } from './mapstyle';
import { seeded } from './util';

let c: CourseColors = CONFIG.colors;

/** Course builds recolor their canvas textures through this hook. */
export function setTexturePalette(colors: CourseColors) {
  c = colors;
}
const FONT = '"Helvetica Neue", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif';

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d')! };
}

function finish(canvas: HTMLCanvasElement, repeat = false) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Ribbons map u across the surface and v in metres along the course, so every
 * tiling texture below is authored against that convention.
 */
function speckle(ctx: CanvasRenderingContext2D, size: number, count: number, random: () => number,
  colors: string[], maxScale = 2.4, alpha = [0.02, 0.08]) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.globalAlpha = alpha[0] + random() * (alpha[1] - alpha[0]);
    const s = 0.6 + random() * maxScale;
    ctx.fillRect(random() * size, random() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

/** Lakeside asphalt: aggregate, tar patches, edge lines and a dashed centreline. */
export function asphaltTexture() {
  const w = 512;
  const h = 512;
  const { canvas, ctx } = canvasOf(w, h);
  ctx.fillStyle = c.asphalt;
  ctx.fillRect(0, 0, w, h);
  const random = seeded(4411);
  speckle(ctx, w, 16000, random, ['#2f3438', '#6a7076', '#3b4045'], 2.6, [0.03, 0.12]);
  for (let i = 0; i < 22; i++) {
    const x = random() * w;
    const y = random() * h;
    const r = 20 + random() * 90;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(38,42,46,0.28)');
    gradient.addColorStop(1, 'rgba(38,42,46,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = 'rgba(30,33,36,0.4)';
    ctx.lineWidth = 1 + random() * 3;
    ctx.beginPath();
    let x = random() * w;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < h) {
      y += 30 + random() * 60;
      x += (random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = c.asphaltLine;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(w * 0.045, 0, 7, h);
  ctx.fillRect(w * 0.955 - 7, 0, 7, h);
  ctx.fillStyle = 'rgba(246,242,228,0.62)';
  for (let y = 0; y < h; y += 128) ctx.fillRect(w / 2 - 3, y, 6, 66);
  ctx.globalAlpha = 1;
  return finish(canvas, true);
}

/** Red athletics track with lane lines and a faint brushed surface. */
export function trackTexture() {
  const size = 512;
  const { canvas, ctx } = canvasOf(size, size);
  ctx.fillStyle = c.track;
  ctx.fillRect(0, 0, size, size);
  const random = seeded(8123);
  speckle(ctx, size, 12000, random, ['#a63c2c', '#d4674f', '#b34433'], 2.2, [0.04, 0.13]);
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.02 + random() * 0.035})`;
    ctx.lineWidth = 1;
    const y = random() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (random() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.fillStyle = c.trackLine;
  ctx.globalAlpha = 0.88;
  for (let i = 0; i <= 5; i++) ctx.fillRect((i / 5) * (size - 5), 0, 5, size);
  ctx.globalAlpha = 1;
  return finish(canvas, true);
}

/** Timber boardwalk: plank ends marching along the running direction. */
export function boardwalkTexture() {
  const size = 256;
  const { canvas, ctx } = canvasOf(size, size);
  ctx.fillStyle = c.boardwalk;
  ctx.fillRect(0, 0, size, size);
  const random = seeded(3307);
  const planks = 8;
  for (let i = 0; i < planks; i++) {
    const y = (i / planks) * size;
    const shade = 0.86 + random() * 0.24;
    ctx.fillStyle = `rgba(${Math.round(185 * shade)},${Math.round(138 * shade)},${Math.round(85 * shade)},1)`;
    ctx.fillRect(0, y + 2, size, size / planks - 4);
    for (let j = 0; j < 40; j++) {
      ctx.strokeStyle = `rgba(120,84,48,${0.06 + random() * 0.12})`;
      ctx.lineWidth = 1;
      const gy = y + 4 + random() * (size / planks - 8);
      ctx.beginPath();
      ctx.moveTo(random() * size, gy);
      ctx.lineTo(random() * size, gy + (random() - 0.5) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(70,46,24,0.55)';
    ctx.fillRect(0, y, size, 2);
  }
  ctx.fillStyle = 'rgba(90,60,32,0.5)';
  ctx.fillRect(size * 0.1, 0, 3, size);
  ctx.fillRect(size * 0.9 - 3, 0, 3, size);
  return finish(canvas, true);
}

/** Dry beach sand with a wet band at the waterline. */
export function sandTexture() {
  const size = 256;
  const { canvas, ctx } = canvasOf(size, size);
  ctx.fillStyle = c.sand;
  ctx.fillRect(0, 0, size, size);
  const random = seeded(6673);
  speckle(ctx, size, 9000, random, ['#f3e7c6', '#cdae7d', '#e2cb9b'], 1.8, [0.05, 0.16]);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(200,172,124,${0.08 + random() * 0.14})`;
    ctx.lineWidth = 2 + random() * 5;
    ctx.beginPath();
    const y = random() * size;
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 5);
    ctx.stroke();
  }
  return finish(canvas, true);
}

/** Woven lane-rope texture for the swim channel dividers. */
export function ropeTexture() {
  const { canvas, ctx } = canvasOf(128, 32);
  ctx.fillStyle = c.gate;
  ctx.fillRect(0, 0, 128, 32);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.ellipse(i * 16 + 8, 16, 8, 14, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(canvas, true);
}

/** Radial sprite used for splash, spray and sun glow. */
export function glowTexture() {
  const { canvas, ctx } = canvasOf(128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(232,250,252,0.78)');
  gradient.addColorStop(0.6, 'rgba(190,236,244,0.24)');
  gradient.addColorStop(1, 'rgba(170,228,240,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return finish(canvas);
}

/** Lake chop: height field turned into a normal map so the water reads wet. */
export function rippleNormalTexture(size = 256) {
  const heights = new Float32Array(size * size);
  const random = seeded(2381);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const wx = (i / size) * Math.PI * 2;
    const wy = (j / size) * Math.PI * 2;
    heights[j * size + i] =
      0.2 * Math.sin(wx * 4 + Math.sin(wy * 3) * 1.4)
      + 0.13 * Math.sin(wy * 5 + wx * 2)
      + 0.09 * Math.sin((wx - wy) * 9)
      + 0.12 * (random() - 0.5);
  }
  const { canvas, ctx } = canvasOf(size, size);
  const image = ctx.createImageData(size, size);
  const at = (i: number, j: number) => heights[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (at(i + 1, j) - at(i - 1, j)) * 2.8;
    const dy = (at(i, j + 1) - at(i, j - 1)) * 2.8;
    const length = Math.hypot(dx, dy, 1);
    const offset = (j * size + i) * 4;
    image.data[offset] = (-dx / length * 0.5 + 0.5) * 255;
    image.data[offset + 1] = (-dy / length * 0.5 + 0.5) * 255;
    image.data[offset + 2] = (1 / length * 0.5 + 0.5) * 255;
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

export type BannerStyle = {
  background?: string; ink?: string; accent?: string; stamp?: string; align?: 'left' | 'center';
  aspect?: number;
};

/** Fabric banner for the start pontoon, the crowd barriers and the finish gantry. */
export function bannerTexture(title: string, subtitle: string, style: BannerStyle = {}) {
  const { background = c.ink, ink = c.paper, accent = c.gate, stamp = '', align = 'left' } = style;
  const width = 1024;
  const height = Math.max(72, Math.round(1024 / (style.aspect ?? 1024 / 244)));
  const k = height / 244;
  const { canvas, ctx } = canvasOf(width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, Math.max(4, 16 * k));
  ctx.fillRect(0, height - Math.max(3, 8 * k), width, Math.max(3, 8 * k));
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    const x = width - 210 + i * 34;
    ctx.moveTo(x, 16 * k);
    ctx.lineTo(x + 26, 16 * k);
    ctx.lineTo(x - 30, height - 8 * k);
    ctx.lineTo(x - 56, height - 8 * k);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = align === 'center' ? 'center' : 'left';
  ctx.textBaseline = 'middle';
  const left = align === 'center' ? width / 2 : 58;
  ctx.fillStyle = ink;
  ctx.font = `800 ${Math.round(92 * k)}px ${FONT}`;
  ctx.letterSpacing = `${Math.max(1, 3 * k)}px`;
  ctx.fillText(title, left, height * 0.44);
  ctx.fillStyle = accent;
  ctx.font = `700 ${Math.round(34 * k)}px ${FONT}`;
  ctx.letterSpacing = `${Math.max(1, 5 * k)}px`;
  ctx.fillText(subtitle, left + (align === 'center' ? 0 : 2), height * 0.75);
  if (stamp) {
    ctx.fillStyle = ink;
    ctx.font = `700 ${Math.round(26 * k)}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(stamp, width - 56, height * 0.22);
  }
  return finish(canvas);
}

/** Numbered plate on the side of each timing gate. */
export function gatePlateTexture(index: number, stage: string) {
  const { canvas, ctx } = canvasOf(256, 160);
  ctx.fillStyle = c.ink;
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = index % 2 ? c.gateAlt : c.gate;
  ctx.fillRect(0, 0, 256, 10);
  ctx.fillStyle = c.paper;
  ctx.font = `800 92px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(index).padStart(2, '0'), 128, 76);
  ctx.font = `700 24px ${FONT}`;
  ctx.fillStyle = c.gate;
  ctx.fillText(stage, 128, 136);
  return finish(canvas);
}

/** Named lake section board beside the course. */
export function labelTexture(main: string, sub: string, background = c.ink, ink = c.paper) {
  const { canvas, ctx } = canvasOf(512, 192);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = c.gate;
  ctx.lineWidth = 8;
  ctx.strokeRect(9, 9, 494, 174);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 62px ${FONT}`;
  ctx.fillText(main, 256, 80);
  ctx.font = `600 26px ${FONT}`;
  ctx.fillStyle = c.gate;
  ctx.letterSpacing = '4px';
  ctx.fillText(sub, 256, 140);
  return finish(canvas);
}

/** Warning board used in front of every hazard band. */
export function hazardTexture(main: string, sub: string) {
  const { canvas, ctx } = canvasOf(384, 192);
  ctx.fillStyle = c.gate;
  ctx.fillRect(0, 0, 384, 192);
  ctx.fillStyle = c.ink;
  ctx.fillRect(12, 12, 360, 168);
  ctx.fillStyle = c.gate;
  ctx.beginPath();
  ctx.moveTo(56, 140);
  ctx.lineTo(94, 56);
  ctx.lineTo(132, 140);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c.ink;
  ctx.fillRect(89, 88, 10, 28);
  ctx.fillRect(89, 122, 10, 10);
  ctx.fillStyle = c.paper;
  ctx.font = `800 50px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(main, 154, 84);
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = c.gate;
  ctx.letterSpacing = '3px';
  ctx.fillText(sub, 154, 130);
  return finish(canvas);
}

/** Diagonal hazard chevrons for the transition ramps and the pontoon edges. */
export function chevronTexture(base = c.gate) {
  const { canvas, ctx } = canvasOf(256, 64);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = -2; i < 10; i++) {
    ctx.beginPath();
    const x = i * 36;
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 16, 64);
    ctx.lineTo(x + 46, 0);
    ctx.lineTo(x + 30, 0);
    ctx.closePath();
    ctx.fill();
  }
  return finish(canvas, true);
}

/** Checkered finish line, stretched across the road ribbon. */
export function checkerTexture() {
  const size = 256;
  const { canvas, ctx } = canvasOf(size, size);
  ctx.fillStyle = c.paper;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#15181c';
  const cells = 8;
  const cell = size / cells;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    if ((i + j) % 2) ctx.fillRect(i * cell, j * cell, cell, cell);
  }
  return finish(canvas, true);
}

/**
 * Soft, tileable cloud blobs for the shadow sheet that drifts over the lake.
 * Each blob is drawn wrapped on all sides so the repeat has no visible seam.
 */
export function cloudShadowTexture() {
  const size = 256;
  const { canvas, ctx } = canvasOf(size, size);
  const random = seeded(6151);
  for (let i = 0; i < 9; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 26 + random() * 46;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const gradient = ctx.createRadialGradient(x + dx, y + dy, radius * 0.12, x + dx, y + dy, radius);
        gradient.addColorStop(0, 'rgba(8, 26, 34, 0.4)');
        gradient.addColorStop(0.55, 'rgba(8, 26, 34, 0.16)');
        gradient.addColorStop(1, 'rgba(8, 26, 34, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return finish(canvas, true);
}
