const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

const MB_LIMIT = 5_000_000;

const presets = [
  { name: 'good-zip', imageQuality: 45, alphaQuality: 70, audioBitrate: '40k' },
  { name: 'balanced', imageQuality: 35, alphaQuality: 55, audioBitrate: '24k' },
  { name: 'strict', imageQuality: 23, alphaQuality: 38, audioBitrate: '14k' },
  { name: 'very-strict', imageQuality: 20, alphaQuality: 32, audioBitrate: '12k' },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function pretty(bytes) {
  return `${(bytes / 1_000_000).toFixed(3)} MB`;
}

function collectFiles(root, predicate) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (!predicate || predicate(fullPath)) files.push(fullPath);
    }
  }
  return files;
}

function dirSize(root) {
  return collectFiles(root).reduce((sum, file) => sum + fs.statSync(file).size, 0);
}

function copyBuild(inputDir, outputDir) {
  const outputName = path.basename(outputDir).toLowerCase();
  const parent = path.dirname(outputDir).toLowerCase();
  if (!outputName.includes('5mb') || !parent.endsWith(`${path.sep}build`)) {
    throw new Error(`Refusing to replace unsafe output folder: ${outputDir}`);
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.cpSync(inputDir, outputDir, { recursive: true });
}

async function compressPngs(outputDir, preset) {
  const pngFiles = collectFiles(outputDir, (file) => file.toLowerCase().endsWith('.png'));
  let converted = 0;
  let saved = 0;

  for (const file of pngFiles) {
    const before = fs.statSync(file).size;
    const webp = await sharp(file, { limitInputPixels: false })
      .webp({
        quality: preset.imageQuality,
        alphaQuality: preset.alphaQuality,
        effort: 6,
        smartSubsample: true,
      })
      .toBuffer();

    if (webp.length < before) {
      fs.writeFileSync(file, webp);
      converted += 1;
      saved += before - webp.length;
    }
  }

  return { count: pngFiles.length, converted, saved };
}

function compressAudio(outputDir, preset) {
  const m4aFiles = collectFiles(outputDir, (file) => file.toLowerCase().endsWith('.m4a'));
  let converted = 0;
  let saved = 0;

  for (const file of m4aFiles) {
    const before = fs.statSync(file).size;
    const tmp = `${file}.tmp.m4a`;
    fs.rmSync(tmp, { force: true });
    const result = childProcess.spawnSync(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-vn',
      '-ac',
      '1',
      '-b:a',
      preset.audioBitrate,
      '-movflags',
      '+faststart',
      tmp,
    ], { encoding: 'utf8' });

    if (result.status === 0 && fs.existsSync(tmp)) {
      const after = fs.statSync(tmp).size;
      if (after > 0 && after < before) {
        fs.renameSync(tmp, file);
        converted += 1;
        saved += before - after;
        continue;
      }
    }
    fs.rmSync(tmp, { force: true });
  }

  return { count: m4aFiles.length, converted, saved };
}

function stripSplash(outputDir) {
  const settingsPath = path.join(outputDir, 'src', 'settings.json');
  if (!fs.existsSync(settingsPath)) return 0;
  const before = fs.statSync(settingsPath).size;
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!settings.splashScreen) return 0;
  settings.splashScreen.totalTime = 0;
  settings.splashScreen.logo = { type: 'none' };
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  return Math.max(0, before - fs.statSync(settingsPath).size);
}

function zipFolder(sourceDir, zipPath) {
  fs.rmSync(zipPath, { force: true });
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -CompressionLevel Optimal`,
  ].join('\n');
  const result = childProcess.spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Compress-Archive failed');
  }
  return fs.statSync(zipPath).size;
}

async function runPreset(inputDir, outputDir, zipPath, preset) {
  copyBuild(inputDir, outputDir);
  const png = await compressPngs(outputDir, preset);
  const audio = compressAudio(outputDir, preset);
  const splashSaved = stripSplash(outputDir);
  const folderBytes = dirSize(outputDir);
  const zipBytes = zipFolder(outputDir, zipPath);

  return { preset, png, audio, splashSaved, folderBytes, zipBytes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args.project || path.join(__dirname, '..', '..'));
  const inputDir = path.resolve(args.input || path.join(projectRoot, 'build', 'web-mobile'));
  const outputDir = path.resolve(args.output || path.join(projectRoot, 'build', 'web-mobile-zip-5mb'));
  const zipPath = path.resolve(args.zip || path.join(projectRoot, 'build', 'web-mobile-5mb.zip'));

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Cannot find build folder: ${inputDir}`);
  }

  console.log(`Input:  ${inputDir}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Zip:    ${zipPath}`);
  console.log(`Before: ${pretty(dirSize(inputDir))}`);

  let finalResult = null;
  for (const preset of presets) {
    console.log(`\nTrying preset: ${preset.name}`);
    const result = await runPreset(inputDir, outputDir, zipPath, preset);
    console.log(`Folder: ${pretty(result.folderBytes)} | Zip: ${pretty(result.zipBytes)}`);
    console.log(`PNG converted: ${result.png.converted}/${result.png.count}`);
    console.log(`Audio converted: ${result.audio.converted}/${result.audio.count}`);
    finalResult = result;
    if (result.zipBytes <= MB_LIMIT) break;
  }

  if (!finalResult || finalResult.zipBytes > MB_LIMIT) {
    throw new Error(`Zip is still over 5MB: ${pretty(finalResult.zipBytes)}`);
  }

  console.log(`\nDone. Final zip: ${zipPath}`);
  console.log(`Final zip size: ${pretty(finalResult.zipBytes)}`);
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exitCode = 1;
});
