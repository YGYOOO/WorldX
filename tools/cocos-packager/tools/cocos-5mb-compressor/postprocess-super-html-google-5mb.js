const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const childProcess = require('child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

const MB_LIMIT = 5_000_000;

const presets = [
  { name: 'balanced', imageQuality: 35, alphaQuality: 55, audioBitrate: '24k' },
  { name: 'strict', imageQuality: 23, alphaQuality: 38, audioBitrate: '14k' },
  { name: 'very-strict', imageQuality: 20, alphaQuality: 32, audioBitrate: '12k' },
  { name: 'tiny', imageQuality: 16, alphaQuality: 24, audioBitrate: '10k' },
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

function assertSafeBuildPath(target, projectRoot, label) {
  const resolved = path.resolve(target);
  const buildRoot = path.resolve(projectRoot, 'build');
  if (!resolved.startsWith(`${buildRoot}${path.sep}`)) {
    throw new Error(`Refusing unsafe ${label} outside build folder: ${resolved}`);
  }
  return resolved;
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function extractEmbeddedZip(html) {
  const match = html.match(/window\.__zip\s*=\s*"([A-Za-z0-9+/=]+)"/);
  if (!match) throw new Error('Cannot find window.__zip in index.html');
  return Buffer.from(match[1], 'base64');
}

function inflateRawOrStore(method, data) {
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported zip compression method: ${method}`);
}

function extractZipBuffer(zipBuffer, outputDir) {
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw new Error(`Bad zip local header at ${offset}`);
    }

    const flags = zipBuffer.readUInt16LE(offset + 6);
    if (flags & 0x08) {
      throw new Error('Zip data descriptors are not supported by this compressor');
    }

    const method = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const nameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraLength = zipBuffer.readUInt16LE(offset + 28);
    const name = zipBuffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const safeName = name.replace(/\\/g, '/');

    if (safeName.includes('..')) throw new Error(`Unsafe zip entry: ${safeName}`);
    if (!safeName.endsWith('/')) {
      const outPath = path.join(outputDir, safeName);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, inflateRawOrStore(method, zipBuffer.slice(dataStart, dataEnd)));
    }

    offset = dataEnd;
  }
}

function readZipEntry(zipBuffer, entryName) {
  const wanted = entryName.replace(/\\/g, '/');
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const signature = zipBuffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw new Error(`Bad zip local header at ${offset}`);
    }

    const flags = zipBuffer.readUInt16LE(offset + 6);
    if (flags & 0x08) {
      throw new Error('Zip data descriptors are not supported by this compressor');
    }

    const method = zipBuffer.readUInt16LE(offset + 8);
    const compressedSize = zipBuffer.readUInt32LE(offset + 18);
    const nameLength = zipBuffer.readUInt16LE(offset + 26);
    const extraLength = zipBuffer.readUInt16LE(offset + 28);
    const name = zipBuffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8').replace(/\\/g, '/');
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (name === wanted) {
      return inflateRawOrStore(method, zipBuffer.slice(dataStart, dataEnd));
    }

    offset = dataEnd;
  }
  return null;
}

function findInputHtml(inputDir) {
  const inputHtmlPath = path.join(inputDir, 'index.html');
  if (fs.existsSync(inputHtmlPath)) {
    return {
      html: fs.readFileSync(inputHtmlPath, 'utf8'),
      source: inputHtmlPath,
    };
  }

  const preferredZip = path.join(inputDir, 'savedog_google.zip');
  const zipPath = fs.existsSync(preferredZip)
    ? preferredZip
    : collectFiles(inputDir, (file) => file.toLowerCase().endsWith('.zip'))[0];

  if (!zipPath) {
    throw new Error(`Cannot find index.html or a google zip in: ${inputDir}`);
  }

  const htmlBuffer = readZipEntry(fs.readFileSync(zipPath), 'index.html');
  if (!htmlBuffer) {
    throw new Error(`Cannot find index.html inside zip: ${zipPath}`);
  }

  return {
    html: htmlBuffer.toString('utf8'),
    source: `${zipPath}!index.html`,
  };
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function createZip(entries) {
  const parts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const input = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const deflated = zlib.deflateRawSync(input, { level: 9 });
    const useStore = deflated.length >= input.length;
    const compressed = useStore ? input : deflated;
    const method = useStore ? 0 : 8;
    const crc = crc32(input);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(input.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(input.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDir, end]);
}

function zipDirectory(root) {
  const entries = collectFiles(root).map((file) => ({
    name: path.relative(root, file).replace(/\\/g, '/'),
    data: fs.readFileSync(file),
  }));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return createZip(entries);
}

function replaceEmbeddedZip(html, zipBuffer) {
  const base64 = zipBuffer.toString('base64');
  return html.replace(/window\.__zip\s*=\s*"[A-Za-z0-9+/=]+"/, `window.__zip = "${base64}"`);
}

function setOrientation(html, orientation) {
  return html.replace(
    /(<meta\s+name="ad\.orientation"\s+content=")[^"]*(")/,
    `$1${orientation}$2`,
  );
}

function writeOuterZip(zipPath, html) {
  fs.writeFileSync(zipPath, createZip([{ name: 'index.html', data: Buffer.from(html, 'utf8') }]));
}

function makeDataUrl(mime, buffer) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

let dataUrlObfuscationIndices = [21, 30];

function setDataUrlObfuscationIndices(indices) {
  const next = [];
  for (const value of indices) {
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && !next.includes(index)) next.push(index);
  }
  for (const fallback of [21, 30]) {
    if (!next.includes(fallback)) next.push(fallback);
  }
  dataUrlObfuscationIndices = next;
}

function detectRuntimeObfuscationIndices(outputDir) {
  const indices = [];
  const jsFiles = collectFiles(outputDir, (file) => file.toLowerCase().endsWith('.js'));
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:window\.)?(?:oasjidx|_my)\s*=\s*(\d+)/g)) {
      indices.push(Number(match[1]));
    }
  }
  setDataUrlObfuscationIndices(indices);
  return dataUrlObfuscationIndices;
}

async function compressPngBuffer(buffer, preset) {
  return sharp(buffer, { limitInputPixels: false })
    .webp({
      quality: preset.imageQuality,
      alphaQuality: preset.alphaQuality,
      effort: 6,
      smartSubsample: true,
    })
    .toBuffer();
}

async function compressLoosePngs(outputDir, preset) {
  const pngFiles = collectFiles(outputDir, (file) => file.toLowerCase().endsWith('.png'));
  let converted = 0;
  let saved = 0;
  let skipped = 0;

  for (const file of pngFiles) {
    const before = fs.statSync(file).size;
    const input = fs.readFileSync(file);
    let webp;
    try {
      webp = await compressPngBuffer(input, preset);
    } catch (error) {
      const text = input.toString('utf8');
      const parsed = parseDataUrl(text);
      if (!parsed) {
        skipped += 1;
        console.warn(`Skip loose PNG: ${file} (${error.message})`);
        continue;
      }
      if (parsed.mime === 'image/webp') {
        const nextValue = makeDataUrl(parsed.mime, parsed.data);
        if (nextValue !== text) fs.writeFileSync(file, nextValue);
        continue;
      }
      try {
        webp = await compressPngBuffer(parsed.data, preset);
        const nextValue = makeDataUrl('image/webp', webp);
        if (Buffer.byteLength(nextValue) < before) {
          fs.writeFileSync(file, nextValue);
          converted += 1;
          saved += before - Buffer.byteLength(nextValue);
        }
        continue;
      } catch (dataUrlError) {
        skipped += 1;
        console.warn(`Skip loose PNG data URL: ${file} (${dataUrlError.message})`);
        continue;
      }
    }
    if (webp.length < before) {
      const nextValue = makeDataUrl('image/webp', webp);
      fs.writeFileSync(file, nextValue);
      converted += 1;
      saved += before - Buffer.byteLength(nextValue);
    }
  }

  return { count: pngFiles.length, converted, saved, skipped };
}

function parseDataUrl(value) {
  const cleanValue = cleanDataUrl(value);
  const comma = cleanValue.indexOf(',');
  if (comma === -1 || !cleanValue.startsWith('data:')) return null;
  const header = cleanValue.slice(5, comma);
  const mime = header.split(';')[0];
  return {
    mime,
    prefix: `data:${header},`,
    data: Buffer.from(cleanValue.slice(comma + 1), 'base64'),
  };
}

function parseDataUrlSyntax(value) {
  const comma = value.indexOf(',');
  if (comma === -1 || !value.startsWith('data:')) return null;
  const header = value.slice(5, comma);
  const mime = header.split(';')[0];
  const payload = value.slice(comma + 1);
  if (!/;base64$/i.test(header)) return null;
  if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
  return {
    comma,
    header,
    mime,
    payload,
    data: Buffer.from(payload, 'base64'),
  };
}

function knownMimeMagicMatches(mime, data) {
  if (mime === 'image/png') {
    return data.length >= 8 && data.slice(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (mime === 'image/jpeg') {
    return data.length >= 2 && data[0] === 0xff && data[1] === 0xd8;
  }
  if (mime === 'image/webp') {
    return data.length >= 12
      && data.slice(0, 4).toString('ascii') === 'RIFF'
      && data.slice(8, 12).toString('ascii') === 'WEBP';
  }
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') {
    return data.length >= 12 && data.slice(4, 8).toString('ascii') === 'ftyp';
  }
  if (mime === 'audio/mpeg') {
    return data.length >= 3
      && (data.slice(0, 3).toString('ascii') === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0));
  }
  return null;
}

function dataUrlLooksUsable(parts) {
  const magic = knownMimeMagicMatches(parts.mime, parts.data);
  return magic === null ? true : magic;
}

function removeCharAt(value, index) {
  return `${value.slice(0, index)}${value.slice(index + 1)}`;
}

function cleanDataUrl(value) {
  if (!value.startsWith('data:')) return value;
  const original = parseDataUrlSyntax(value);
  if (original && dataUrlLooksUsable(original)) return value;

  const originalMime = original ? original.mime : null;
  const candidates = [...dataUrlObfuscationIndices];
  if (original) candidates.push(original.comma + 9, original.comma + 8);

  for (const index of candidates) {
    if (!Number.isInteger(index) || index < 0 || index >= value.length) continue;
    const deobfuscated = removeCharAt(value, index);
    const parts = parseDataUrlSyntax(deobfuscated);
    if (!parts) continue;
    if (originalMime && parts.mime !== originalMime) continue;
    if (dataUrlLooksUsable(parts)) return deobfuscated;
  }

  if (original && knownMimeMagicMatches(original.mime, original.data) === false) {
    const maxIndex = Math.min(value.length - 1, original.comma + 72);
    for (let index = original.comma + 1; index <= maxIndex; index += 1) {
      const deobfuscated = removeCharAt(value, index);
      const parts = parseDataUrlSyntax(deobfuscated);
      if (parts && parts.mime === original.mime && dataUrlLooksUsable(parts)) return deobfuscated;
    }
  }

  const comma = value.indexOf(',');
  if (comma !== -1) {
    const normalizedHeader = `${value.slice(0, comma).replace(/;base64\d+$/i, ';base64')}${value.slice(comma)}`;
    const normalizedParts = parseDataUrlSyntax(normalizedHeader);
    if (normalizedParts && dataUrlLooksUsable(normalizedParts)) return normalizedHeader;
  }
  return value;
}

async function compressResDataUrls(outputDir, preset) {
  const resPath = path.join(outputDir, '__res');
  if (!fs.existsSync(resPath)) return { count: 0, converted: 0, saved: 0, splashSaved: 0 };

  const before = fs.statSync(resPath).size;
  const res = JSON.parse(fs.readFileSync(resPath, 'utf8'));
  let count = 0;
  let converted = 0;
  let skipped = 0;
  let normalized = 0;
  let imageSaved = 0;
  let splashSaved = 0;

  for (const [key, value] of Object.entries(res)) {
    if (typeof value !== 'string' || !value.startsWith('data:')) continue;
    const parsed = parseDataUrl(value);
    if (!parsed) continue;

    if (!key.toLowerCase().endsWith('.png')) {
      const nextValue = makeDataUrl(parsed.mime, parsed.data);
      if (nextValue !== value) {
        res[key] = nextValue;
        normalized += 1;
      }
      continue;
    }

    count += 1;
    if (parsed.mime === 'image/webp') {
      const normalizedValue = makeDataUrl(parsed.mime, parsed.data);
      if (normalizedValue !== value) {
        res[key] = normalizedValue;
        normalized += 1;
      }
      continue;
    }

    let webp;
    try {
      webp = await compressPngBuffer(parsed.data, preset);
    } catch (error) {
      skipped += 1;
      console.warn(`Skip __res PNG: ${key} (${error.message})`);
      const normalizedValue = makeDataUrl(parsed.mime, parsed.data);
      if (normalizedValue !== value) {
        res[key] = normalizedValue;
        normalized += 1;
      }
      continue;
    }
    const nextValue = makeDataUrl('image/webp', webp);
    if (Buffer.byteLength(nextValue) < Buffer.byteLength(value)) {
      res[key] = nextValue;
      converted += 1;
      imageSaved += Buffer.byteLength(value) - Buffer.byteLength(nextValue);
    } else {
      const normalizedValue = makeDataUrl(parsed.mime, parsed.data);
      if (normalizedValue !== value) {
        res[key] = normalizedValue;
        normalized += 1;
      }
    }
  }

  if (typeof res['src/settings.json'] === 'string') {
    const originalSettings = res['src/settings.json'];
    try {
      const settings = JSON.parse(originalSettings);
      if (settings.splashScreen) {
        settings.splashScreen.totalTime = 0;
        settings.splashScreen.logo = { type: 'none' };
        res['src/settings.json'] = JSON.stringify(settings);
        splashSaved = Math.max(0, Buffer.byteLength(originalSettings) - Buffer.byteLength(res['src/settings.json']));
      }
    } catch {
      // Leave malformed settings untouched.
    }
  }

  fs.writeFileSync(resPath, JSON.stringify(res));
  return {
    count,
    converted,
    skipped,
    normalized,
    saved: imageSaved,
    splashSaved,
    before,
    after: fs.statSync(resPath).size,
  };
}

function compressAudio(outputDir, preset) {
  const audioFiles = collectFiles(outputDir, (file) => file.toLowerCase().endsWith('.m4a'));
  let converted = 0;
  let saved = 0;

  for (const file of audioFiles) {
    const before = fs.statSync(file).size;
    const original = fs.readFileSync(file);
    const originalText = original.toString('utf8');
    const dataUrl = originalText.startsWith('data:') ? parseDataUrl(originalText) : null;
    const inputFile = dataUrl ? `${file}.input.m4a` : file;
    const tmp = `${file}.tmp.m4a`;
    fs.rmSync(tmp, { force: true });
    if (dataUrl) {
      fs.rmSync(inputFile, { force: true });
      fs.writeFileSync(inputFile, dataUrl.data);
    }

    const result = childProcess.spawnSync(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputFile,
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
      const nextPayload = dataUrl
        ? Buffer.from(makeDataUrl(dataUrl.mime, fs.readFileSync(tmp)), 'utf8')
        : fs.readFileSync(tmp);
      if (after > 0 && nextPayload.length < before) {
        fs.writeFileSync(file, nextPayload);
        converted += 1;
        saved += before - nextPayload.length;
        fs.rmSync(tmp, { force: true });
        if (dataUrl) fs.rmSync(inputFile, { force: true });
        continue;
      }
    }
    fs.rmSync(tmp, { force: true });
    if (dataUrl) fs.rmSync(inputFile, { force: true });
  }

  return { count: audioFiles.length, converted, saved };
}

function normalizeLooseDataUrls(outputDir) {
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.mp3', '.m4a', '.ogg', '.wav', '.cconb']);
  const files = collectFiles(outputDir, (file) => exts.has(path.extname(file).toLowerCase()));
  let normalized = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.startsWith('data:')) continue;
    const parsed = parseDataUrl(text);
    if (!parsed) continue;
    const nextValue = makeDataUrl(parsed.mime, parsed.data);
    if (nextValue !== text) {
      fs.writeFileSync(file, nextValue);
      normalized += 1;
    }
  }

  return { count: files.length, normalized };
}

function patchRuntimeObfuscation(outputDir) {
  const indexPath = path.join(outputDir, 'index.js');
  if (!fs.existsSync(indexPath)) return false;
  const before = fs.readFileSync(indexPath, 'utf8');
  const after = before
    .replace(/window\.oasjidx\s*=\s*\d+/g, 'window.oasjidx=0')
    .replace(/window\._my\s*=\s*\d+/g, 'window._my=0');
  if (after !== before) {
    fs.writeFileSync(indexPath, after);
    return true;
  }
  return false;
}

function copyDir(inputDir, outputDir) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.cpSync(inputDir, outputDir, { recursive: true });
}

async function runPreset({ preset, inputHtml, templateHtml, workDir, outputDir }) {
  resetDir(workDir);
  extractZipBuffer(extractEmbeddedZip(inputHtml), workDir);
  const obfuscationIndices = detectRuntimeObfuscationIndices(workDir);
  const runtimePatched = patchRuntimeObfuscation(workDir);

  const loosePng = await compressLoosePngs(workDir, preset);
  const res = await compressResDataUrls(workDir, preset);
  const audio = compressAudio(workDir, preset);
  const looseDataUrls = normalizeLooseDataUrls(workDir);
  const innerZip = zipDirectory(workDir);

  resetDir(outputDir);
  const htmlBoth = replaceEmbeddedZip(setOrientation(templateHtml, 'portrait,landscape'), innerZip);
  const htmlLandscape = replaceEmbeddedZip(setOrientation(templateHtml, 'landscape'), innerZip);
  const htmlPortrait = replaceEmbeddedZip(setOrientation(templateHtml, 'portrait'), innerZip);

  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlBoth);
  writeOuterZip(path.join(outputDir, 'savedog_google.zip'), htmlBoth);
  writeOuterZip(path.join(outputDir, 'savedog_google_landscape.zip'), htmlLandscape);
  writeOuterZip(path.join(outputDir, 'savedog_google_portrait.zip'), htmlPortrait);

  const sizes = {
    index: fs.statSync(path.join(outputDir, 'index.html')).size,
    google: fs.statSync(path.join(outputDir, 'savedog_google.zip')).size,
    landscape: fs.statSync(path.join(outputDir, 'savedog_google_landscape.zip')).size,
    portrait: fs.statSync(path.join(outputDir, 'savedog_google_portrait.zip')).size,
    dir: dirSize(outputDir),
    innerZip: innerZip.length,
  };

  return { preset, loosePng, res, audio, looseDataUrls, runtimePatched, obfuscationIndices, sizes };
}

function reportResult(result) {
  console.log(`Folder: ${pretty(result.sizes.dir)}`);
  console.log(`Index:  ${pretty(result.sizes.index)}`);
  console.log(`Zip:    ${pretty(result.sizes.google)}`);
  console.log(`Land:   ${pretty(result.sizes.landscape)}`);
  console.log(`Port:   ${pretty(result.sizes.portrait)}`);
  console.log(`Inner:  ${pretty(result.sizes.innerZip)}`);
  console.log(`Loose PNG converted: ${result.loosePng.converted}/${result.loosePng.count}, skipped ${result.loosePng.skipped || 0}, saved ${pretty(result.loosePng.saved)}`);
  console.log(`__res PNG converted: ${result.res.converted}/${result.res.count}, skipped ${result.res.skipped || 0}, normalized ${result.res.normalized || 0}, saved ${pretty(result.res.saved)}`);
  console.log(`Loose data URLs normalized: ${result.looseDataUrls.normalized}/${result.looseDataUrls.count}`);
  console.log(`Runtime obfuscation disabled: ${result.runtimePatched ? 'yes' : 'no'}`);
  console.log(`Data URL obfuscation indices: ${result.obfuscationIndices.join(', ')}`);
  console.log(`Splash saved: ${pretty(result.res.splashSaved || 0)}`);
  console.log(`Audio converted: ${result.audio.converted}/${result.audio.count}, saved ${pretty(result.audio.saved)}`);
}

function allSubmitZipsUnderLimit(result) {
  return result.sizes.index <= MB_LIMIT
    && result.sizes.google <= MB_LIMIT
    && result.sizes.landscape <= MB_LIMIT
    && result.sizes.portrait <= MB_LIMIT;
}

function backupAndReplace(inputDir, outputDir, projectRoot) {
  const source = assertSafeBuildPath(inputDir, projectRoot, 'inputDir');
  const output = assertSafeBuildPath(outputDir, projectRoot, 'outputDir');
  const parent = path.dirname(source);
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  let backup = path.join(parent, `google-original-before-5mb-${stamp}`);
  let index = 2;
  while (fs.existsSync(backup)) {
    backup = path.join(parent, `google-original-before-5mb-${stamp}-${index}`);
    index += 1;
  }
  fs.renameSync(source, backup);
  copyDir(output, source);
  console.log(`Backup: ${backup}`);
  console.log(`Replaced: ${source}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(args.project || path.join(__dirname, '..', '..'));
  const inputDir = path.resolve(args.input || path.join(projectRoot, 'build', 'super-html', 'google'));
  const outputDir = path.resolve(args.output || path.join(projectRoot, 'build', 'super-html', 'google-5mb'));
  const workDir = path.resolve(args.work || path.join(projectRoot, 'build', 'super-html', '.google-5mb-work'));

  assertSafeBuildPath(inputDir, projectRoot, 'inputDir');
  assertSafeBuildPath(outputDir, projectRoot, 'outputDir');
  assertSafeBuildPath(workDir, projectRoot, 'workDir');

  const input = findInputHtml(inputDir);
  const inputHtml = input.html;
  const templateHtml = inputHtml;
  console.log(`Input:  ${inputDir}`);
  console.log(`Source: ${input.source}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Before: ${pretty(dirSize(inputDir))}`);

  let finalResult = null;
  for (const preset of presets) {
    console.log(`\nTrying preset: ${preset.name}`);
    const result = await runPreset({ preset, inputHtml, templateHtml, workDir, outputDir });
    reportResult(result);
    finalResult = result;
    if (allSubmitZipsUnderLimit(result)) break;
  }

  fs.rmSync(workDir, { recursive: true, force: true });

  if (!finalResult || !allSubmitZipsUnderLimit(finalResult)) {
    throw new Error(`Google output files are still over 5MB after ${finalResult ? finalResult.preset.name : 'no'} preset`);
  }

  if (args.replace) {
    backupAndReplace(inputDir, outputDir, projectRoot);
  }

  console.log('\nDone.');
  console.log(`Final output: ${outputDir}`);
  console.log(`Final preset: ${finalResult.preset.name}`);
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  process.exitCode = 1;
});
