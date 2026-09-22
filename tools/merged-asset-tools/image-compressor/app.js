const $ = (selector) => document.querySelector(selector);

const elements = {
  fileInput: $("#fileInput"),
  dropZone: $("#dropZone"),
  formatSelect: $("#formatSelect"),
  qualityInput: $("#qualityInput"),
  qualityOutput: $("#qualityOutput"),
  downloadAllBtn: $("#downloadAllBtn"),
  clearBtn: $("#clearBtn"),
  fileCount: $("#fileCount"),
  beforeSize: $("#beforeSize"),
  afterSize: $("#afterSize"),
  savedSize: $("#savedSize"),
  statusText: $("#statusText"),
  progressText: $("#progressText"),
  emptyState: $("#emptyState"),
  resultList: $("#resultList"),
};

const state = {
  files: [],
  results: [],
  objectUrls: [],
  isBusy: false,
  generation: 0,
};

const CRC_TABLE = makeCrcTable();
const MAX_FILES = 200;

function getSettings() {
  return {
    format: elements.formatSelect.value,
    quality: Number(elements.qualityInput.value) / 100,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function extensionForMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function mimeForFile(file) {
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (file.type === "image/webp" || /\.webp$/i.test(file.name)) return "image/webp";
  return "image/png";
}

function outputName(fileName, mime) {
  const stem = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${stem}.${extensionForMime(mime)}`;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("浏览器无法生成压缩图片"))),
      type,
      quality
    );
  });
}

async function canvasToOptimizedPngBlob(canvas, originalFile) {
  const browserBlob = await canvasToBlob(canvas, "image/png");
  let smallest = originalFile.size <= browserBlob.size ? originalFile : browserBlob;

  if (typeof CompressionStream !== "function") return smallest;

  try {
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const optimizedBytes = await encodeLosslessPng(imageData);
    if (optimizedBytes.length < smallest.size) {
      smallest = new Blob([optimizedBytes], { type: "image/png" });
    }
  } catch (error) {
    console.warn("PNG 深度无损压缩不可用，已采用较小的原图或浏览器编码结果。", error);
  }

  return smallest;
}

async function encodeLosslessPng(imageData) {
  const candidates = [makeDirectPngCandidate(imageData)];
  const paletteCandidate = makePalettePngCandidate(imageData);
  if (paletteCandidate) candidates.push(paletteCandidate);
  let smallest = null;

  for (const candidate of candidates) {
    const filtered = applyPngFilters(candidate.raw, candidate.rowLength, imageData.height, candidate.bytesPerPixel);
    const compressed = await deflateZlib(filtered);
    const png = assemblePng(
      imageData.width,
      imageData.height,
      candidate.bitDepth,
      candidate.colorType,
      compressed,
      candidate.extraChunks
    );
    if (!smallest || png.length < smallest.length) smallest = png;
  }

  return smallest;
}

function makeDirectPngCandidate(imageData) {
  const { data, width, height } = imageData;
  let opaque = true;
  let grayscale = true;
  for (let index = 0; index < data.length; index += 4) {
    opaque = opaque && data[index + 3] === 255;
    grayscale = grayscale && data[index] === data[index + 1] && data[index] === data[index + 2];
    if (!opaque && !grayscale) break;
  }

  const colorType = grayscale ? (opaque ? 0 : 4) : opaque ? 2 : 6;
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const rowLength = width * channels;
  const raw = new Uint8Array(rowLength * height);
  let output = 0;
  for (let index = 0; index < data.length; index += 4) {
    raw[output++] = data[index];
    if (colorType === 2 || colorType === 6) {
      raw[output++] = data[index + 1];
      raw[output++] = data[index + 2];
    }
    if (colorType === 4 || colorType === 6) raw[output++] = data[index + 3];
  }
  return { bitDepth: 8, colorType, bytesPerPixel: channels, rowLength, raw, extraChunks: [] };
}

function makePalettePngCandidate(imageData) {
  const { data, width, height } = imageData;
  const colors = [];
  const colorIndexes = new Map();
  for (let index = 0; index < data.length; index += 4) {
    const key = rgbaKey(data[index], data[index + 1], data[index + 2], data[index + 3]);
    if (!colorIndexes.has(key)) {
      if (colors.length === 256) return null;
      colorIndexes.set(key, colors.length);
      colors.push([data[index], data[index + 1], data[index + 2], data[index + 3]]);
    }
  }

  const bitDepth = colors.length <= 2 ? 1 : colors.length <= 4 ? 2 : colors.length <= 16 ? 4 : 8;
  const rowLength = Math.ceil((width * bitDepth) / 8);
  const raw = new Uint8Array(rowLength * height);
  const mask = (1 << bitDepth) - 1;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const key = rgbaKey(data[source], data[source + 1], data[source + 2], data[source + 3]);
      const paletteIndex = colorIndexes.get(key) & mask;
      const bitOffset = x * bitDepth;
      raw[rowOffset + (bitOffset >> 3)] |= paletteIndex << (8 - bitDepth - (bitOffset & 7));
    }
  }

  const palette = new Uint8Array(colors.length * 3);
  let lastTransparent = -1;
  for (let index = 0; index < colors.length; index++) {
    palette[index * 3] = colors[index][0];
    palette[index * 3 + 1] = colors[index][1];
    palette[index * 3 + 2] = colors[index][2];
    if (colors[index][3] !== 255) lastTransparent = index;
  }
  const extraChunks = [{ type: "PLTE", data: palette }];
  if (lastTransparent >= 0) {
    const transparency = new Uint8Array(lastTransparent + 1);
    for (let index = 0; index <= lastTransparent; index++) transparency[index] = colors[index][3];
    extraChunks.push({ type: "tRNS", data: transparency });
  }
  return { bitDepth, colorType: 3, bytesPerPixel: 1, rowLength, raw, extraChunks };
}

function rgbaKey(red, green, blue, alpha) {
  return (((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0);
}

function applyPngFilters(raw, rowLength, height, bytesPerPixel) {
  const output = new Uint8Array(height * (rowLength + 1));
  const candidates = Array.from({ length: 5 }, () => new Uint8Array(rowLength));
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLength;
    const previousStart = rowStart - rowLength;
    const scores = [0, 0, 0, 0, 0];
    for (let x = 0; x < rowLength; x++) {
      const value = raw[rowStart + x];
      const left = x >= bytesPerPixel ? raw[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? raw[previousStart + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? raw[previousStart + x - bytesPerPixel] : 0;
      const values = [
        value,
        (value - left) & 0xff,
        (value - up) & 0xff,
        (value - Math.floor((left + up) / 2)) & 0xff,
        (value - paethPredictor(left, up, upperLeft)) & 0xff,
      ];
      for (let filter = 0; filter < 5; filter++) {
        candidates[filter][x] = values[filter];
        scores[filter] += values[filter] < 128 ? values[filter] : 256 - values[filter];
      }
    }
    let bestFilter = 0;
    for (let filter = 1; filter < 5; filter++) {
      if (scores[filter] < scores[bestFilter]) bestFilter = filter;
    }
    const outputStart = y * (rowLength + 1);
    output[outputStart] = bestFilter;
    output.set(candidates[bestFilter], outputStart + 1);
  }
  return output;
}

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const distanceLeft = Math.abs(prediction - left);
  const distanceUp = Math.abs(prediction - up);
  const distanceUpperLeft = Math.abs(prediction - upperLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) return left;
  return distanceUp <= distanceUpperLeft ? up : upperLeft;
}

async function deflateZlib(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function assemblePng(width, height, bitDepth, colorType, compressed, extraChunks) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header[8] = bitDepth;
  header[9] = colorType;
  const chunks = [makePngChunk("IHDR", header)];
  for (const chunk of extraChunks) chunks.push(makePngChunk(chunk.type, chunk.data));
  chunks.push(makePngChunk("IDAT", compressed), makePngChunk("IEND", new Uint8Array()));
  return concatBytes([signature, ...chunks]);
}

function makePngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length, false);
  result.set(typeBytes, 4);
  result.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return result;
}

function concatBytes(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function loadImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name} 无法读取`));
    };
    image.src = url;
  });
}

function closeImage(image) {
  if (typeof image.close === "function") image.close();
}

async function compressFile(file, settings) {
  const image = await loadImage(file);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  closeImage(image);

  const originalMime = mimeForFile(file);
  const targetMime = settings.format === "webp" ? "image/webp" : originalMime;
  const quality = targetMime === "image/png" ? undefined : settings.quality;
  const encoded =
    targetMime === "image/png"
      ? await canvasToOptimizedPngBlob(canvas, file)
      : await canvasToBlob(canvas, targetMime, quality);
  const keptOriginal = encoded === file || encoded.size >= file.size;
  const blob = keptOriginal ? file : encoded;

  return {
    blob,
    name: keptOriginal ? file.name : outputName(file.name, targetMime),
    sourceName: file.name,
    sourceSize: file.size,
    outputSize: blob.size,
    width,
    height,
    mime: keptOriginal ? originalMime : targetMime,
    keptOriginal,
  };
}

async function processFiles() {
  if (!state.files.length) return;
  const generation = ++state.generation;
  const settings = getSettings();
  state.isBusy = true;
  state.results = [];
  revokeUrls();
  renderResults();
  updateActions();
  elements.statusText.textContent = `正在自动压缩 ${state.files.length} 张图片`;

  for (let index = 0; index < state.files.length; index++) {
    if (generation !== state.generation) return;
    try {
      const result = await compressFile(state.files[index], settings);
      const url = URL.createObjectURL(result.blob);
      state.objectUrls.push(url);
      state.results.push({ ...result, url });
    } catch (error) {
      state.results.push({
        name: state.files[index].name,
        sourceName: state.files[index].name,
        sourceSize: state.files[index].size,
        outputSize: state.files[index].size,
        blob: state.files[index],
        width: 0,
        height: 0,
        error: error.message || "处理失败",
      });
    }

    elements.progressText.textContent = `${Math.round(((index + 1) / state.files.length) * 100)}%`;
    renderResults();
    if ((index + 1) % 4 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  if (generation !== state.generation) return;
  state.isBusy = false;
  const saved = totalSourceSize() - totalOutputSize();
  elements.statusText.textContent = `自动压缩完成 · ${state.results.length} 张 · 节省 ${formatBytes(Math.max(0, saved))}`;
  updateSummary();
  updateActions();
}

function totalSourceSize() {
  return state.results.reduce((sum, item) => sum + item.sourceSize, 0);
}

function totalOutputSize() {
  return state.results.reduce((sum, item) => sum + item.outputSize, 0);
}

function updateSummary() {
  const before = totalSourceSize();
  const after = totalOutputSize();
  const percentage = before ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
  elements.fileCount.textContent = String(state.results.length || state.files.length);
  elements.beforeSize.textContent = formatBytes(before || state.files.reduce((sum, file) => sum + file.size, 0));
  elements.afterSize.textContent = formatBytes(after);
  elements.savedSize.textContent = `${percentage}%`;
}

function renderResults() {
  elements.emptyState.hidden = Boolean(state.files.length);
  elements.resultList.innerHTML = "";

  for (const result of state.results) {
    const item = document.createElement("article");
    item.className = "result-item";

    const image = document.createElement("img");
    image.className = "thumb";
    image.alt = "";
    if (result.url) image.src = result.url;

    const copy = document.createElement("div");
    copy.className = "item-copy";
    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = result.name;
    name.title = result.name;
    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = result.error
      ? result.error
      : `${result.width}×${result.height} · ${formatBytes(result.sourceSize)} → ${formatBytes(result.outputSize)}`;
    const saving = document.createElement("div");
    const savedPercent = result.sourceSize
      ? Math.max(0, Math.round((1 - result.outputSize / result.sourceSize) * 100))
      : 0;
    saving.className = `item-saving${savedPercent ? "" : " no-saving"}`;
    saving.textContent = result.error
      ? "已保留原文件"
      : result.keptOriginal
        ? "原图已经更小，已保留原文件"
        : `节省 ${savedPercent}%`;
    copy.append(name, meta, saving);

    const download = document.createElement("button");
    download.type = "button";
    download.className = "item-download";
    download.textContent = "下载";
    download.addEventListener("click", () => downloadBlob(result.blob, result.name));
    item.append(image, copy, download);
    elements.resultList.appendChild(item);
  }

  updateSummary();
}

function handleFiles(fileList) {
  const files = [...fileList].filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name) || /^image\/(png|jpeg|webp)$/.test(file.type));
  if (!files.length) {
    elements.statusText.textContent = "请选择 PNG、JPG、JPEG 或 WebP 图片";
    return;
  }
  if (files.length > MAX_FILES) {
    elements.statusText.textContent = `单次最多处理 ${MAX_FILES} 张图片`;
    return;
  }
  state.files = files;
  elements.progressText.textContent = "0%";
  elements.clearBtn.disabled = false;
  processFiles();
}

function clearAll() {
  state.generation += 1;
  state.files = [];
  state.results = [];
  state.isBusy = false;
  revokeUrls();
  elements.fileInput.value = "";
  elements.statusText.textContent = "等待选择图片";
  elements.progressText.textContent = "0%";
  renderResults();
  updateActions();
}

function revokeUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

function updateActions() {
  elements.downloadAllBtn.disabled = state.isBusy || !state.results.length;
  elements.clearBtn.disabled = state.isBusy || !state.files.length;
  elements.formatSelect.disabled = state.isBusy;
  elements.qualityInput.disabled = state.isBusy;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function downloadAll() {
  if (!state.results.length || state.isBusy) return;
  elements.downloadAllBtn.disabled = true;
  elements.statusText.textContent = "正在打包 ZIP";
  const usedNames = new Set();
  const files = [];
  for (let index = 0; index < state.results.length; index++) {
    const result = state.results[index];
    let name = result.name;
    if (usedNames.has(name.toLowerCase())) {
      const extension = name.match(/\.[^.]+$/)?.[0] || "";
      name = `${name.slice(0, name.length - extension.length)}_${index + 1}${extension}`;
    }
    usedNames.add(name.toLowerCase());
    files.push({ name, data: new Uint8Array(await result.blob.arrayBuffer()) });
  }
  const zip = await createZip(files);
  downloadBlob(zip, `compressed_images_${Date.now()}.zip`);
  elements.statusText.textContent = `已打包 ${files.length} 张压缩图片`;
  elements.downloadAllBtn.disabled = false;
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name.replace(/\\/g, "/"));
    const data = file.data;
    const compressed = await deflateRaw(data);
    const useDeflate = Boolean(compressed && compressed.length < data.length);
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const date = new Date();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, payload);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, method, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, payload.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + payload.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

async function deflateRaw(data) {
  if (!data.length || typeof CompressionStream !== "function") return null;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
      const wrapped = new Uint8Array(await new Response(stream).arrayBuffer());
      return wrapped.length > 6 ? wrapped.slice(2, -4) : null;
    } catch {
      return null;
    }
  }
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index++) crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

elements.fileInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
  event.target.value = "";
});
for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));
elements.qualityInput.addEventListener("input", () => {
  elements.qualityOutput.value = `${elements.qualityInput.value}%`;
});
elements.qualityInput.addEventListener("change", processFiles);
elements.formatSelect.addEventListener("change", processFiles);
elements.downloadAllBtn.addEventListener("click", downloadAll);
elements.clearBtn.addEventListener("click", clearAll);

renderResults();
updateActions();
