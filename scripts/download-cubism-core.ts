/**
 * 下载 Live2D Cubism 4 Core SDK
 * 运行: npm run download-all
 *
 * live2dcubismcore.js 是 pixi-live2d-display 运行所需的底层 SDK
 * 来自 Live2D 官方: https://www.live2d.com/download/cubism-sdk/download-web/
 */
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const DEST = join(PUBLIC_DIR, 'live2dcubismcore.min.js');

// 官方 CDN 地址（Live2D 官方网站）
const CDN_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';

// 备用 CDN（jsdelivr 通过 npm 包同步）
const FALLBACK_URL = 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Core/live2dcubismcore.min.js';

async function download(url: string, dest: string): Promise<boolean> {
  console.log(`  ↓ Download: ${url}`);
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.log(`     HTTP ${resp.status}, skipping`);
      return false;
    }
    const buffer = await resp.arrayBuffer();
    writeFileSync(dest, Buffer.from(buffer));
    const size = (buffer.byteLength / 1024).toFixed(1);
    console.log(`  ✓ Saved (${size} KB): ${dest}`);
    return true;
  } catch (err: any) {
    console.log(`    Failed: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Download Live2D Cubism 4 Core SDK ===\n');

  if (!existsSync(PUBLIC_DIR)) {
    const { mkdirSync } = await import('fs');
    mkdirSync(PUBLIC_DIR, { recursive: true });
  }

  // 尝试主地址
  let ok = await download(CDN_URL, DEST);

  // 主地址失败则尝试备用
  if (!ok) {
    console.log('\n  Primary URL failed, trying fallback...');
    ok = await download(FALLBACK_URL, DEST);
  }

  if (ok) {
    console.log('\n✅ Cubism Core downloaded!');
  } else {
    console.log('\n❌ All download URLs failed.');
    console.log('Please manually download live2dcubismcore.min.js:');
    console.log('  1. Open https://www.live2d.com/en/download/cubism-sdk/download-web/');
    console.log('  2. Agree to the license and download Cubism SDK for Web');
    console.log('  3. Extract and copy live2dcubismcore.min.js from the Core/ directory');
    console.log('  4. Place it at public/live2dcubismcore.min.js');
  }
}

main().catch(console.error);
