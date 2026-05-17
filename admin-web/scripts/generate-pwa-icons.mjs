/**
 * SVG → PNG 일괄 변환 (PWA용 아이콘 생성).
 *
 * 입력: public/icon-app.svg
 * 출력: public/icon-192.png, public/icon-512.png, public/apple-icon.png
 *
 * 실행: node scripts/generate-pwa-icons.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'public', 'icon-app.svg');

const targets = [
  { out: 'icon-192.png', size: 192 },
  { out: 'icon-512.png', size: 512 },
  // iOS: 180x180 권장. 둥근 모서리는 OS가 처리하므로 정사각형 PNG로.
  { out: 'apple-icon.png', size: 180 },
  // maskable 용 (안드로이드 적응형 아이콘) — safe zone 안에 핵심 콘텐츠.
  // 현재 SVG가 이미 safe zone 안에 들어가도록 설계됨.
  { out: 'icon-maskable-512.png', size: 512 },
];

for (const t of targets) {
  const dest = join(root, 'public', t.out);
  await sharp(src).resize(t.size, t.size).png().toFile(dest);
  console.log(`✓ ${t.out} (${t.size}x${t.size})`);
}
console.log('Done.');
