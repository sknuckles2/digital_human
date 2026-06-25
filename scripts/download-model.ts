/**
 * 下载 Live2D 示例模型 (Shizuku)
 * 运行: npm run download-model
 *
 * 从 Live2D 官方示例仓库下载免费模型
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '..', 'public', 'live2d-models', 'shizuku');

// Shizuku 模型文件列表（Live2D 官方免费示例）
const FILES: Record<string, string | null> = {
  'shizuku.model3.json': null,
  'shizuku.moc3': null,
  'shizuku.physics3.json': null,
  'shizuku.cdi3.json': null,
};

const BASE_URL = 'https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Res/Shizuku/';

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`  ↓ Download: ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const buffer = await resp.arrayBuffer();
  writeFileSync(dest, Buffer.from(buffer));
  console.log(`  ✓ Saved: ${dest}`);
}

async function main() {
  console.log('=== Download Live2D Sample Model (Shizuku) ===\n');

  // 创建目录
  if (!existsSync(MODELS_DIR)) {
    mkdirSync(MODELS_DIR, { recursive: true });
  }

  const files: { url: string; dest: string }[] = [
    {
      url: `${BASE_URL}Shizuku.model3.json`,
      dest: join(MODELS_DIR, 'shizuku.model3.json'),
    },
    {
      url: `${BASE_URL}Shizuku.moc3`,
      dest: join(MODELS_DIR, 'shizuku.moc3'),
    },
    {
      url: `${BASE_URL}Shizuku.physics3.json`,
      dest: join(MODELS_DIR, 'shizuku.physics3.json'),
    },
    {
      url: `${BASE_URL}Shizuku.cdi3.json`,
      dest: join(MODELS_DIR, 'shizuku.cdi3.json'),
    },
  ];

  // 模型3.json 中引用的贴图文件
  const textures = [
    'Shizuku.2048/texture_00.png',
    'Shizuku.2048/texture_01.png',
  ];

  for (const t of textures) {
    const texDir = join(MODELS_DIR, 'Shizuku.2048');
    if (!existsSync(texDir)) {
      mkdirSync(texDir, { recursive: true });
    }
    files.push({
      url: `${BASE_URL}${t}`,
      dest: join(texDir, t.split('/')[1]),
    });
  }

  // 并行下载
  const results = await Promise.allSettled(
    files.map((f) => downloadFile(f.url, f.dest))
  );

  let success = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') success++;
    else {
      fail++;
      console.error(`  ✗ Failed: ${r.reason}`);
    }
  }

  console.log(`\n=== Done: ${success} succeeded, ${fail} failed ===`);
  if (success > 0) {
    console.log('\nModel downloaded to: public/live2d-models/shizuku/');
    console.log('Start the dev server and it will be ready.');
  }
}

// 也下载 Cubism Core SDK
const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
const CORE_DEST = join(__dirname, '..', 'public', 'live2dcubismcore.min.js');

async function downloadCore(): Promise<boolean> {
  console.log('\n=== Download Live2D Cubism 4 Core SDK ===\n');
  try {
    const resp = await fetch(CORE_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    writeFileSync(CORE_DEST, Buffer.from(buffer));
    const size = (buffer.byteLength / 1024).toFixed(1);
    console.log(`  ✓ Saved (${size} KB): ${CORE_DEST}`);
    return true;
  } catch (err: any) {
    console.warn(`  ✗ Cubism Core download failed: ${err.message}`);
    console.warn('  Please manually download: https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js');
    return false;
  }
}

main().then(() => downloadCore()).catch(console.error);
