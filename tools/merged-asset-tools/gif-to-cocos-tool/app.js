const $ = (selector) => document.querySelector(selector);

const elements = {
  supportLine: $("#supportLine"),
  dropZone: $("#dropZone"),
  gifInput: $("#gifInput"),
  pngFolderInput: $("#pngFolderInput"),
  fileName: $("#fileName"),
  folderInput: $("#folderInput"),
  clipInput: $("#clipInput"),
  widthInput: $("#widthInput"),
  heightInput: $("#heightInput"),
  autoCropSelect: $("#autoCropSelect"),
  cropPaddingInput: $("#cropPaddingInput"),
  fitSelect: $("#fitSelect"),
  loopSelect: $("#loopSelect"),
  alphaSelect: $("#alphaSelect"),
  frameRateInput: $("#frameRateInput"),
  pngFrameRateInput: $("#pngFrameRateInput"),
  convertBtn: $("#convertBtn"),
  downloadBtn: $("#downloadBtn"),
  downloadSequenceBtn: $("#downloadSequenceBtn"),
  previewCanvas: $("#previewCanvas"),
  statusText: $("#statusText"),
  progressText: $("#progressText"),
  frameRange: $("#frameRange"),
  frameText: $("#frameText"),
  filmStrip: $("#filmStrip"),
  sourceSize: $("#sourceSize"),
  outputSize: $("#outputSize"),
  frameCount: $("#frameCount"),
  durationText: $("#durationText"),
  sourceBytes: $("#sourceBytes"),
  cocosBytes: $("#cocosBytes"),
  treeFolder: $("#treeFolder"),
  treeAnim: $("#treeAnim"),
  treeAnimMeta: $("#treeAnimMeta"),
  treeClipFolder: $("#treeClipFolder"),
  treeFrame: $("#treeFrame"),
  treeFrameMeta: $("#treeFrameMeta"),
  messageBox: $("#messageBox"),
};

const state = {
  file: null,
  pngFiles: [],
  frames: [],
  cocosZipBlob: null,
  sequenceZipBlob: null,
  sourceWidth: 0,
  sourceHeight: 0,
  outputWidth: 0,
  outputHeight: 0,
  selectedFrame: 0,
  objectUrls: [],
  isBusy: false,
  fileKind: "",
  settingsSignature: "",
  sourceBytes: 0,
};

const CRC_TABLE = makeCrcTable();
const MAX_VIDEO_FRAMES = 1200;
const MAX_PNG_FRAMES = 1200;
const naturalFileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function setMessage(text, type = "") {
  elements.messageBox.textContent = text;
  elements.messageBox.classList.toggle("is-ok", type === "ok");
  elements.messageBox.classList.toggle("is-error", type === "error");
}

function sanitizeName(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|#%{}^~[\]`;]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function getSettings() {
  const width = clampNumber(parseInt(elements.widthInput.value, 10), 1, 4096, 664);
  const height = clampNumber(parseInt(elements.heightInput.value, 10), 1, 4096, 688);
  elements.widthInput.value = String(width);
  elements.heightInput.value = String(height);

  const folder = sanitizeName(elements.folderInput.value, "Dog");
  const clip = sanitizeName(elements.clipInput.value, "dog_idle");
  const cropPadding = clampNumber(parseInt(elements.cropPaddingInput.value, 10), 0, 512, 12);
  const frameRate = clampNumber(parseInt(elements.frameRateInput.value, 10), 1, 60, 12);
  const pngFrameRate = clampNumber(parseInt(elements.pngFrameRateInput.value, 10), 1, 60, 30);
  elements.folderInput.value = folder;
  elements.clipInput.value = clip;
  elements.cropPaddingInput.value = String(cropPadding);
  elements.frameRateInput.value = String(frameRate);
  elements.pngFrameRateInput.value = String(pngFrameRate);
  updateCropControlState();

  return {
    folder,
    clip,
    width,
    height,
    autoCrop: elements.autoCropSelect.value === "on",
    cropPadding,
    fit: elements.fitSelect.value,
    loop: elements.loopSelect.value === "loop",
    alphaMode: elements.alphaSelect.value,
    frameRate,
    pngFrameRate,
  };
}

function updateCropControlState() {
  elements.cropPaddingInput.disabled = elements.autoCropSelect.value !== "on";
}

function updateFileKindControls() {
  const isPng = state.fileKind === "png";
  elements.widthInput.disabled = false;
  elements.heightInput.disabled = false;
  elements.autoCropSelect.disabled = false;
  elements.fitSelect.disabled = false;
  elements.alphaSelect.disabled = state.fileKind === "mp4" || isPng;
  elements.frameRateInput.disabled = state.fileKind !== "mp4";
  elements.pngFrameRateInput.disabled = !isPng;
  updateCropControlState();
}

function makeSettingsSignature(settings) {
  return JSON.stringify({
    folder: settings.folder,
    clip: settings.clip,
    width: settings.width,
    height: settings.height,
    autoCrop: settings.autoCrop,
    cropPadding: settings.cropPadding,
    fit: settings.fit,
    loop: settings.loop,
    alphaMode: settings.alphaMode,
    frameRate: settings.frameRate,
    pngFrameRate: settings.pngFrameRate,
  });
}

function currentOutputMatchesSettings() {
  return Boolean(
    (state.cocosZipBlob || state.sequenceZipBlob) &&
      state.settingsSignature &&
      state.settingsSignature === makeSettingsSignature(getSettings())
  );
}

function markOutputStale(message, options = {}) {
  if (currentOutputMatchesSettings()) return;
  state.settingsSignature = "";
  state.cocosZipBlob = null;
  state.sequenceZipBlob = null;
  elements.downloadBtn.disabled = true;
  elements.downloadSequenceBtn.disabled = true;
  if (options.clearCanvas) clearCanvas();
  if (state.file) setMessage(message);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function updateTree() {
  const settings = getSettings();
  elements.outputSize.textContent = `${settings.width}x${settings.height}`;
  elements.treeFolder.textContent = settings.folder;
  elements.treeAnim.textContent = `${settings.clip}.anim`;
  elements.treeAnimMeta.textContent = `${settings.clip}.anim.meta`;
  elements.treeClipFolder.textContent = settings.clip;
  elements.treeFrame.textContent = `${settings.clip}_000.png`;
  elements.treeFrameMeta.textContent = `${settings.clip}_000.png.meta`;
}

function resetOutput() {
  state.frames = [];
  state.cocosZipBlob = null;
  state.sequenceZipBlob = null;
  state.selectedFrame = 0;
  state.outputWidth = 0;
  state.outputHeight = 0;
  state.settingsSignature = "";
  revokeUrls();
  elements.downloadBtn.disabled = true;
  elements.downloadSequenceBtn.disabled = true;
  elements.frameRange.disabled = true;
  elements.frameRange.max = "0";
  elements.frameRange.value = "0";
  elements.frameText.textContent = "0 / 0";
  elements.frameCount.textContent = "0";
  elements.durationText.textContent = "0.00s";
  elements.sourceSize.textContent = "-";
  elements.sourceBytes.textContent = "-";
  elements.cocosBytes.textContent = "-";
  elements.progressText.textContent = "0%";
  elements.filmStrip.innerHTML = "";
  clearCanvas();
}

function clearCanvas() {
  const settings = getSettings();
  const canvas = elements.previewCanvas;
  canvas.width = settings.width;
  canvas.height = settings.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  elements.convertBtn.disabled = isBusy || !state.file;
  elements.downloadBtn.disabled = isBusy || !state.cocosZipBlob;
  elements.downloadSequenceBtn.disabled = isBusy || !state.sequenceZipBlob;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function revokeUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function makeDirectoryMeta() {
  return {
    ver: "1.2.0",
    importer: "directory",
    imported: true,
    uuid: uuid(),
    files: [],
    subMetas: {},
    userData: {},
  };
}

function makePngMeta(baseUuid, displayName, width, height, pivotX = 0.5, pivotY = 0) {
  const normalizedPivotX = clampNumber(pivotX, 0, 1, 0.5);
  const normalizedPivotY = clampNumber(pivotY, 0, 1, 0);
  const left = -width * normalizedPivotX;
  const right = width * (1 - normalizedPivotX);
  const bottom = -height * normalizedPivotY;
  const top = height * (1 - normalizedPivotY);
  return {
    ver: "1.0.26",
    importer: "image",
    imported: true,
    uuid: baseUuid,
    files: [".json", ".png"],
    subMetas: {
      "6c48a": {
        importer: "texture",
        uuid: `${baseUuid}@6c48a`,
        displayName,
        id: "6c48a",
        name: "texture",
        userData: {
          wrapModeS: "clamp-to-edge",
          wrapModeT: "clamp-to-edge",
          minfilter: "linear",
          magfilter: "linear",
          mipfilter: "none",
          anisotropy: 0,
          isUuid: true,
          imageUuidOrDatabaseUri: baseUuid,
          visible: false,
        },
        ver: "1.0.22",
        imported: true,
        files: [".json"],
        subMetas: {},
      },
      f9941: {
        importer: "sprite-frame",
        uuid: `${baseUuid}@f9941`,
        displayName,
        id: "f9941",
        name: "spriteFrame",
        userData: {
          trimType: "none",
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
          packable: true,
          pixelsToUnit: 100,
          pivotX: normalizedPivotX,
          pivotY: normalizedPivotY,
          meshType: 0,
          vertices: {
            rawPosition: [left, bottom, 0, right, bottom, 0, left, top, 0, right, top, 0],
            indexes: [0, 1, 2, 2, 1, 3],
            uv: [0, height, width, height, 0, 0, width, 0],
            nuv: [0, 0, 1, 0, 0, 1, 1, 1],
            minPos: [left, bottom, 0],
            maxPos: [right, top, 0],
          },
          isUuid: true,
          imageUuidOrDatabaseUri: `${baseUuid}@6c48a`,
          atlasUuid: "",
        },
        ver: "1.0.12",
        imported: true,
        files: [".json"],
        subMetas: {},
      },
    },
    userData: {
      hasAlpha: true,
      type: "sprite-frame",
      fixAlphaTransparencyArtifacts: false,
      redirect: `${baseUuid}@f9941`,
    },
  };
}

function makeAnimClip(clipName, frameUuids, durationsMs, loop) {
  let cursor = 0;
  const times = frameUuids.map((_, index) => {
    const time = roundSeconds(cursor / 1000);
    cursor += Math.max(16, durationsMs[index] || 100);
    return time;
  });
  const duration = Math.max(roundSeconds(cursor / 1000), 1 / 60);

  return [
    {
      __type__: "cc.AnimationClip",
      _name: clipName,
      _objFlags: 0,
      __editorExtras__: { embeddedPlayerGroups: [] },
      _native: "",
      sample: 60,
      speed: 1,
      wrapMode: loop ? 2 : 1,
      enableTrsBlending: false,
      _duration: duration,
      _hash: 500763545,
      _tracks: [{ __id__: 1 }],
      _exoticAnimation: null,
      _events: [],
      _embeddedPlayers: [],
      _additiveSettings: { __id__: 6 },
      _auxiliaryCurveEntries: [],
    },
    {
      __type__: "cc.animation.ObjectTrack",
      _binding: {
        __type__: "cc.animation.TrackBinding",
        path: { __id__: 2 },
        proxy: null,
      },
      _channel: { __id__: 4 },
    },
    {
      __type__: "cc.animation.TrackPath",
      _paths: [{ __id__: 3 }, "spriteFrame"],
    },
    {
      __type__: "cc.animation.ComponentPath",
      component: "cc.Sprite",
    },
    {
      __type__: "cc.animation.Channel",
      _curve: { __id__: 5 },
    },
    {
      __type__: "cc.ObjectCurve",
      _times: times,
      _values: frameUuids.map((frameUuid) => ({
        __uuid__: frameUuid,
        __expectedType__: "cc.SpriteFrame",
      })),
    },
    {
      __type__: "cc.AnimationClipAdditiveSettings",
      enabled: false,
      refClip: null,
    },
  ];
}

function makeAnimMeta(clipName) {
  return {
    ver: "2.0.3",
    importer: "animation-clip",
    imported: true,
    uuid: uuid(),
    files: [".cconb"],
    subMetas: {},
    userData: { name: clipName },
  };
}

function roundSeconds(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function drawFrameToCanvas(frame, canvas, settings) {
  const ctx = canvas.getContext("2d", { alpha: true });
  canvas.width = settings.width;
  canvas.height = settings.height;
  ctx.clearRect(0, 0, settings.width, settings.height);

  const sourceW = frame.displayWidth || frame.codedWidth;
  const sourceH = frame.displayHeight || frame.codedHeight;
  let drawW = settings.width;
  let drawH = settings.height;
  let drawX = 0;
  let drawY = 0;

  if (settings.fit !== "stretch") {
    const scale =
      settings.fit === "cover"
        ? Math.max(settings.width / sourceW, settings.height / sourceH)
        : Math.min(settings.width / sourceW, settings.height / sourceH);
    drawW = Math.round(sourceW * scale);
    drawH = Math.round(sourceH * scale);
    drawX = Math.round((settings.width - drawW) / 2);
    drawY = Math.round((settings.height - drawH) / 2);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame, drawX, drawY, drawW, drawH);
}

async function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 生成失败"));
    }, "image/png");
  });
}

async function canvasToOptimizedPngBlob(canvas, fallbackBlob = null) {
  const browserBlob = await canvasToBlob(canvas);
  let smallest = fallbackBlob && fallbackBlob.size < browserBlob.size ? fallbackBlob : browserBlob;

  try {
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const encoded = await encodeLosslessPng(imageData);
    if (encoded.length < smallest.size) smallest = new Blob([encoded], { type: "image/png" });
  } catch (error) {
    console.warn("无损 PNG 深度优化不可用，已回退到浏览器 PNG 编码。", error);
  }

  return smallest;
}

async function encodeLosslessPng(imageData) {
  if (typeof CompressionStream !== "function") throw new Error("当前浏览器不支持流式压缩");
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

  return {
    bitDepth: 8,
    colorType,
    bytesPerPixel: channels,
    rowLength,
    raw,
    extraChunks: [],
  };
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

  return {
    bitDepth,
    colorType: 3,
    bytesPerPixel: 1,
    rowLength,
    raw,
    extraChunks,
  };
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
      const filteredValues = [
        value,
        (value - left) & 0xff,
        (value - up) & 0xff,
        (value - Math.floor((left + up) / 2)) & 0xff,
        (value - paethPredictor(left, up, upperLeft)) & 0xff,
      ];

      for (let filter = 0; filter < 5; filter++) {
        const filteredValue = filteredValues[filter];
        candidates[filter][x] = filteredValue;
        scores[filter] += filteredValue < 128 ? filteredValue : 256 - filteredValue;
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
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width, false);
  headerView.setUint32(4, height, false);
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
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function finalizeFramesForExport(frames, settings, cropBounds) {
  const hasCommonSize = frames.every(
    (frame) => (frame.width || settings.width) === settings.width && (frame.height || settings.height) === settings.height
  );
  const bounds =
    settings.autoCrop && cropBounds && hasCommonSize
      ? makeCenterPreservingCropBounds(cropBounds, settings.width, settings.height, settings.cropPadding)
      : { minX: 0, minY: 0, maxX: settings.width - 1, maxY: settings.height - 1 };
  const cropWidth = bounds.maxX - bounds.minX + 1;
  const cropHeight = bounds.maxY - bounds.minY + 1;
  const shouldCrop = hasCommonSize && (cropWidth < settings.width || cropHeight < settings.height);
  elements.statusText.textContent = shouldCrop
    ? `无损裁剪并压缩到 ${cropWidth}×${cropHeight}`
    : "正在进行极致无损 PNG 压缩";
  const optimizedFrames = [];
  const cropCanvas = document.createElement("canvas");
  const cropContext = cropCanvas.getContext("2d", { alpha: true });

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const source = await loadFrameImage(frame.blob);
    const frameWidth = frame.width || settings.width;
    const frameHeight = frame.height || settings.height;
    const frameBounds = shouldCrop
      ? bounds
      : { minX: 0, minY: 0, maxX: frameWidth - 1, maxY: frameHeight - 1 };
    const outputWidth = frameBounds.maxX - frameBounds.minX + 1;
    const outputHeight = frameBounds.maxY - frameBounds.minY + 1;
    cropCanvas.width = outputWidth;
    cropCanvas.height = outputHeight;
    cropContext.clearRect(0, 0, outputWidth, outputHeight);
    cropContext.drawImage(
      source,
      frameBounds.minX,
      frameBounds.minY,
      outputWidth,
      outputHeight,
      0,
      0,
      outputWidth,
      outputHeight
    );
    closeFrameImage(source);

    const footPivot = findFootPivot(cropCanvas);
    const blob = await canvasToOptimizedPngBlob(cropCanvas, shouldCrop ? null : frame.blob);
    optimizedFrames.push({
      ...frame,
      blob,
      width: outputWidth,
      height: outputHeight,
      pivotX: footPivot.pivotX,
      pivotY: footPivot.pivotY,
    });

    elements.progressText.textContent = `${Math.round(((index + 1) / frames.length) * 100)}%`;
    elements.statusText.textContent = `无损优化第 ${index + 1} / ${frames.length} 帧`;
    if ((index + 1) % 4 === 0) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  return {
    frames: attachFrameUrls(optimizedFrames, cropWidth, cropHeight),
    width: shouldCrop ? cropWidth : optimizedFrames[0]?.width || settings.width,
    height: shouldCrop ? cropHeight : optimizedFrames[0]?.height || settings.height,
  };
}

function attachFrameUrls(frames, width, height) {
  return frames.map((frame) => {
    const url = URL.createObjectURL(frame.blob);
    state.objectUrls.push(url);
    return {
      ...frame,
      url,
      width: frame.width || width,
      height: frame.height || height,
    };
  });
}

async function loadFrameImage(blob) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(blob);
  }

  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("PNG 裁剪读取失败。"));
    };
    image.src = url;
  });
}

function closeFrameImage(image) {
  if (typeof image.close === "function") image.close();
}

async function processGif(file) {
  const settings = getSettings();
  const buffer = await file.arrayBuffer();
  const sourceCanvas = document.createElement("canvas");
  const outputCanvas = document.createElement("canvas");
  const frames = [];
  const delays = [];
  let cropBounds = null;

  await decodeGifFrames(buffer, async ({ data, width, height, delayMs, index, totalHint }) => {
    if (index === 0) {
      state.sourceWidth = width;
      state.sourceHeight = height;
      elements.sourceSize.textContent = `${state.sourceWidth}x${state.sourceHeight}`;
      sourceCanvas.width = width;
      sourceCanvas.height = height;
    }

    drawRgbaToOutputCanvas(data, width, height, sourceCanvas, outputCanvas, settings);
    if (settings.autoCrop) {
      cropBounds = mergeBounds(cropBounds, findCanvasAlphaBounds(outputCanvas));
    }
    const blob = await canvasToBlob(outputCanvas);
    const baseUuid = uuid();
    const frameName = `${settings.clip}_${String(index).padStart(3, "0")}`;

    frames.push({ blob, name: frameName, uuid: baseUuid, spriteUuid: `${baseUuid}@f9941`, delayMs, width: settings.width, height: settings.height });
    delays.push(delayMs);

    const percent = totalHint ? Math.round(((index + 1) / totalHint) * 100) : Math.min(99, index + 1);
    elements.progressText.textContent = `${percent}%`;
    elements.statusText.textContent = `生成第 ${index + 1} 帧`;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

  if (!frames.length) {
    throw new Error("没有解析到 GIF 帧。");
  }

  const finalized = await finalizeFramesForExport(frames, settings, cropBounds);
  const exportSettings = { ...settings, width: finalized.width, height: finalized.height };
  const cocosFiles = await buildCocosFiles(exportSettings, finalized.frames, delays);
  const sequenceFiles = await buildSequenceFrameFiles(finalized.frames);
  const cocosZipBlob = await createZip(cocosFiles);
  const sequenceZipBlob = await createZip(sequenceFiles);
  const totalDuration = delays.reduce((sum, delay) => sum + delay, 0) / 1000;

  return { inputSettings: settings, settings: exportSettings, frames: finalized.frames, cocosZipBlob, sequenceZipBlob, totalDuration };
}

async function processMp4(file) {
  const settings = getSettings();
  const video = document.createElement("video");
  const videoUrl = URL.createObjectURL(file);
  const sourceCanvas = document.createElement("canvas");
  const outputCanvas = document.createElement("canvas");
  const frames = [];
  const delays = [];
  let cropBounds = null;

  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await loadVideoMetadata(video, videoUrl);
    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = await getFiniteVideoDuration(video);

    if (!width || !height || duration <= 0) {
      throw new Error("无法读取 MP4 的尺寸或时长。");
    }

    const frameInterval = 1 / settings.frameRate;
    const totalFrames = Math.max(1, Math.ceil(duration * settings.frameRate));
    if (totalFrames > MAX_VIDEO_FRAMES) {
      throw new Error(
        `当前 MP4 按 ${settings.frameRate} FPS 会导出 ${totalFrames} 帧，超过 ${MAX_VIDEO_FRAMES} 帧上限。请调低抽帧 FPS 或先剪短视频。`
      );
    }

    state.sourceWidth = width;
    state.sourceHeight = height;
    elements.sourceSize.textContent = `${width}x${height}`;
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
    const delayMs = Math.max(16, Math.round(1000 / settings.frameRate));

    for (let index = 0; index < totalFrames; index += 1) {
      const time = Math.min(index * frameInterval, Math.max(0, duration - 0.001));
      await seekVideoFrame(video, time);

      sourceContext.clearRect(0, 0, width, height);
      sourceContext.drawImage(video, 0, 0, width, height);
      drawSourceCanvasToOutputCanvas(sourceCanvas, width, height, outputCanvas, settings);
      if (settings.autoCrop) {
        cropBounds = mergeBounds(cropBounds, findCanvasAlphaBounds(outputCanvas));
      }

      const blob = await canvasToBlob(outputCanvas);
      const baseUuid = uuid();
      const frameName = `${settings.clip}_${String(index).padStart(3, "0")}`;
      frames.push({
        blob,
        name: frameName,
        uuid: baseUuid,
        spriteUuid: `${baseUuid}@f9941`,
        delayMs,
        width: settings.width,
        height: settings.height,
      });
      delays.push(delayMs);

      elements.progressText.textContent = `${Math.round(((index + 1) / totalFrames) * 100)}%`;
      elements.statusText.textContent = `抽取第 ${index + 1} / ${totalFrames} 帧`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  } finally {
    URL.revokeObjectURL(videoUrl);
    video.removeAttribute("src");
    video.load();
  }

  if (!frames.length) {
    throw new Error("没有从 MP4 中抽取到帧。");
  }

  const finalized = await finalizeFramesForExport(frames, settings, cropBounds);
  const exportSettings = { ...settings, width: finalized.width, height: finalized.height };
  const cocosFiles = await buildCocosFiles(exportSettings, finalized.frames, delays);
  const sequenceFiles = await buildSequenceFrameFiles(finalized.frames);
  const cocosZipBlob = await createZip(cocosFiles);
  const sequenceZipBlob = await createZip(sequenceFiles);
  const totalDuration = delays.reduce((sum, delay) => sum + delay, 0) / 1000;

  return {
    inputSettings: settings,
    settings: exportSettings,
    frames: finalized.frames,
    cocosZipBlob,
    sequenceZipBlob,
    totalDuration,
  };
}

async function findCommonFrameAlphaBounds(frames, width, height) {
  const hasCommonSize = frames.every(
    (frame) => (frame.width || width) === width && (frame.height || height) === height
  );
  if (!hasCommonSize) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  let combinedBounds = null;

  for (let index = 0; index < frames.length; index++) {
    const source = await loadFrameImage(frames[index].blob);
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    closeFrameImage(source);
    combinedBounds = mergeBounds(combinedBounds, findCanvasAlphaBounds(canvas));
    elements.progressText.textContent = `${Math.round(((index + 1) / frames.length) * 30)}%`;
    elements.statusText.textContent = `分析透明边界 ${index + 1} / ${frames.length}`;
    if ((index + 1) % 8 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  return combinedBounds;
}

async function resizePngFrames(frames, settings) {
  const alreadySized = frames.every(
    (frame) => frame.width === settings.width && frame.height === settings.height
  );
  if (alreadySized) return frames;

  const sourceCanvas = document.createElement("canvas");
  const outputCanvas = document.createElement("canvas");
  const sourceContext = sourceCanvas.getContext("2d", { alpha: true });
  const resizedFrames = [];

  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const source = await loadFrameImage(frame.blob);
    sourceCanvas.width = frame.width;
    sourceCanvas.height = frame.height;
    sourceContext.clearRect(0, 0, frame.width, frame.height);
    sourceContext.drawImage(source, 0, 0, frame.width, frame.height);
    closeFrameImage(source);
    drawSourceCanvasToOutputCanvas(sourceCanvas, frame.width, frame.height, outputCanvas, settings);
    const blob = await canvasToBlob(outputCanvas);
    resizedFrames.push({ ...frame, blob, width: settings.width, height: settings.height });
    elements.progressText.textContent = `${Math.round(((index + 1) / frames.length) * 25)}%`;
    elements.statusText.textContent = `调整尺寸 ${index + 1} / ${frames.length}`;
    if ((index + 1) % 4 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  return resizedFrames;
}

async function processPngSequence(files) {
  const sortedFiles = [...files]
    .filter((file) => /\.png$/i.test(file.name) || file.type === "image/png")
    .sort((a, b) => naturalFileNameCollator.compare(a.name, b.name));

  if (!sortedFiles.length) throw new Error("所选内容中没有 PNG 文件。");
  if (sortedFiles.length > MAX_PNG_FRAMES) {
    throw new Error(`PNG 序列共 ${sortedFiles.length} 帧，超过 ${MAX_PNG_FRAMES} 帧上限。`);
  }

  elements.statusText.textContent = `正在读取 ${sortedFiles.length} 个 PNG`;
  const sizes = await Promise.all(sortedFiles.map((file) => readPngSize(file)));
  const firstSize = sizes[0];
  const isFirstGeneration = state.sourceWidth <= 0 || state.sourceHeight <= 0;
  if (isFirstGeneration) {
    elements.widthInput.value = String(firstSize.width);
    elements.heightInput.value = String(firstSize.height);
  }
  const settings = getSettings();
  const delayMs = Math.max(16, Math.round(1000 / settings.pngFrameRate));
  const usedNames = new Set();
  const frames = sortedFiles.map((file, index) => {
    let name = sanitizeName(file.name, `${settings.clip}_${String(index).padStart(3, "0")}`);
    if (usedNames.has(name)) name = `${name}_${String(index).padStart(3, "0")}`;
    usedNames.add(name);
    const baseUuid = uuid();
    return {
      blob: file,
      name,
      uuid: baseUuid,
      spriteUuid: `${baseUuid}@f9941`,
      delayMs,
      width: sizes[index].width,
      height: sizes[index].height,
    };
  });
  const delays = frames.map(() => delayMs);
  const outputFrames = await resizePngFrames(frames, settings);
  const cropBounds = settings.autoCrop
    ? await findCommonFrameAlphaBounds(outputFrames, settings.width, settings.height)
    : null;
  const finalized = await finalizeFramesForExport(outputFrames, settings, cropBounds);
  const exportSettings = { ...settings, width: finalized.width, height: finalized.height };

  state.sourceWidth = firstSize.width;
  state.sourceHeight = firstSize.height;
  elements.sourceSize.textContent = `${firstSize.width}x${firstSize.height}`;
  elements.statusText.textContent = `正在打包 ${finalized.frames.length} 帧 Cocos 资源`;
  const cocosFiles = await buildCocosFiles(exportSettings, finalized.frames, delays);
  const cocosZipBlob = await createZip(cocosFiles);

  return {
    inputSettings: settings,
    settings: exportSettings,
    frames: finalized.frames,
    cocosZipBlob,
    sequenceZipBlob: null,
    totalDuration: delays.reduce((sum, delay) => sum + delay, 0) / 1000,
  };
}

async function readPngSize(file) {
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (header.length < 24 || !signature.every((value, index) => header[index] === value)) {
    throw new Error(`${file.name} 不是有效 PNG 文件。`);
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (!width || !height) throw new Error(`${file.name} 的尺寸无效。`);
  return { width, height };
}

function loadVideoMetadata(video, url) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("MP4 无法读取，请确认视频编码为浏览器支持的 H.264。"));
    };

    video.addEventListener("loadedmetadata", done);
    video.addEventListener("error", fail);
    video.src = url;
    video.load();
  });
}

async function getFiniteVideoDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

  const recovered = await new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("durationchange", done);
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", done);
    };
    const done = () => {
      if (settled) return;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        settled = true;
        cleanup();
        resolve(video.duration);
      }
    };
    const timeout = setTimeout(() => {
      settled = true;
      cleanup();
      resolve(0);
    }, 2500);

    video.addEventListener("durationchange", done);
    video.addEventListener("seeked", done);
    video.addEventListener("error", done);
    try {
      video.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      settled = true;
      cleanup();
      resolve(0);
    }
  });

  if (recovered > 0) await seekVideoFrame(video, 0);
  return recovered;
}

function seekVideoFrame(video, time) {
  return new Promise((resolve, reject) => {
    const safeTime = Math.min(Math.max(time, 0), Math.max(0, video.duration - 0.001));
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("MP4 抽帧超时，请确认文件可正常播放。"));
    }, 15000);
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener("seeked", done);
      video.removeEventListener("loadeddata", done);
      video.removeEventListener("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("MP4 抽帧失败。"));
    };

    if (Math.abs(video.currentTime - safeTime) < 0.001 && video.readyState >= 2) {
      requestAnimationFrame(done);
      return;
    }

    video.addEventListener("seeked", done);
    video.addEventListener("loadeddata", done);
    video.addEventListener("error", fail);
    video.currentTime = safeTime;
  });
}

function drawRgbaToOutputCanvas(data, width, height, sourceCanvas, outputCanvas, settings) {
  const sourceContext = sourceCanvas.getContext("2d", { alpha: true });
  sourceContext.putImageData(new ImageData(data, width, height), 0, 0);
  drawSourceCanvasToOutputCanvas(sourceCanvas, width, height, outputCanvas, settings);
}

function drawSourceCanvasToOutputCanvas(sourceCanvas, width, height, outputCanvas, settings) {
  const outputContext = outputCanvas.getContext("2d", { alpha: true });
  outputCanvas.width = settings.width;
  outputCanvas.height = settings.height;
  outputContext.clearRect(0, 0, settings.width, settings.height);

  let drawW = settings.width;
  let drawH = settings.height;
  let drawX = 0;
  let drawY = 0;

  if (settings.fit !== "stretch") {
    const scale =
      settings.fit === "cover"
        ? Math.max(settings.width / width, settings.height / height)
        : Math.min(settings.width / width, settings.height / height);
    drawW = Math.round(width * scale);
    drawH = Math.round(height * scale);
    drawX = Math.round((settings.width - drawW) / 2);
    drawY = Math.round((settings.height - drawH) / 2);
  }

  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(sourceCanvas, drawX, drawY, drawW, drawH);
}

async function decodeGifFrames(buffer, onFrame) {
  const reader = new GifReader(new Uint8Array(buffer));
  const signature = reader.readString(6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("不是有效 GIF 文件。");
  }

  const width = reader.readUint16();
  const height = reader.readUint16();
  const packed = reader.readByte();
  const hasGlobalColorTable = (packed & 0x80) !== 0;
  const globalColorTableSize = 1 << ((packed & 0x07) + 1);
  const backgroundIndex = reader.readByte();
  reader.readByte();

  const globalColorTable = hasGlobalColorTable ? reader.readColorTable(globalColorTableSize) : null;
  const canvasData = new Uint8ClampedArray(width * height * 4);
  const backgroundColor = globalColorTable ? globalColorTable[backgroundIndex] : null;
  let gce = defaultGraphicControl();
  let pendingDisposal = null;
  let frameIndex = 0;
  const totalHint = estimateGifFrameCount(reader.bytes);
  let firstFrameBounds = null;

  while (!reader.eof()) {
    const block = reader.readByte();
    if (block === 0x3b) break;

    if (block === 0x21) {
      const label = reader.readByte();
      if (label === 0xf9) {
        const blockSize = reader.readByte();
        const gcePacked = reader.readByte();
        const delay = reader.readUint16();
        const transparentIndex = reader.readByte();
        reader.readByte();
        if (blockSize !== 4) reader.skip(blockSize - 4);
        gce = {
          disposal: (gcePacked >> 2) & 0x07,
          transparentIndex: (gcePacked & 0x01) !== 0 ? transparentIndex : null,
          delayMs: Math.max(16, delay ? delay * 10 : 100),
        };
      } else {
        reader.readSubBlocks();
      }
      continue;
    }

    if (block !== 0x2c) {
      throw new Error(`无法解析 GIF block: 0x${block.toString(16)}`);
    }

    if (pendingDisposal) {
      applyDisposal(canvasData, width, pendingDisposal, backgroundColor);
      pendingDisposal = null;
    }

    const left = reader.readUint16();
    const top = reader.readUint16();
    const frameWidth = reader.readUint16();
    const frameHeight = reader.readUint16();
    const imagePacked = reader.readByte();
    const hasLocalColorTable = (imagePacked & 0x80) !== 0;
    const interlaced = (imagePacked & 0x40) !== 0;
    const localColorTableSize = 1 << ((imagePacked & 0x07) + 1);
    const colorTable = hasLocalColorTable ? reader.readColorTable(localColorTableSize) : globalColorTable;
    if (!colorTable) throw new Error("GIF 缺少颜色表。");

    const minCodeSize = reader.readByte();
    const compressed = reader.readSubBlocks();
    const pixels = lzwDecode(minCodeSize, compressed, frameWidth * frameHeight);
    const restore = gce.disposal === 3 ? copyArea(canvasData, width, left, top, frameWidth, frameHeight) : null;

    drawIndexedFrame({
      canvasData,
      canvasWidth: width,
      canvasHeight: height,
      pixels,
      colorTable,
      left,
      top,
      frameWidth,
      frameHeight,
      interlaced,
      transparentIndex: gce.transparentIndex,
    });

    if (frameIndex === 0) {
      firstFrameBounds = expandBounds(findAlphaBounds(canvasData, width, height), width, height, Math.round(Math.max(width, height) * 0.035));
    }
    if (getSettings().alphaMode === "first-frame" && firstFrameBounds) {
      clearOutsideBounds(canvasData, width, height, firstFrameBounds);
    }

    await onFrame({
      data: canvasData,
      width,
      height,
      delayMs: gce.delayMs,
      index: frameIndex,
      totalHint,
    });

    pendingDisposal = {
      disposal: gce.disposal,
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      restore,
    };
    gce = defaultGraphicControl();
    frameIndex++;
  }
}

function defaultGraphicControl() {
  return { disposal: 0, transparentIndex: null, delayMs: 100 };
}

function findAlphaBounds(data, width, height) {
  const bounds = findVisibleAlphaBounds(data, width, height);
  if (bounds) return bounds;
  return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
}

function findCanvasAlphaBounds(canvas) {
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return findVisibleAlphaBounds(image.data, canvas.width, canvas.height);
}

function findFootPivot(canvas) {
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const alphaThreshold = 8;
  let minY = canvas.height;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > alphaThreshold) {
        minY = Math.min(minY, y);
        maxY = y;
      }
    }
  }

  if (maxY < 0) return { pivotX: 0.5, pivotY: 0 };

  const visibleHeight = maxY - minY + 1;
  const bandHeight = clampNumber(Math.round(visibleHeight * 0.035), 2, 16, 4);
  const bandTop = Math.max(minY, maxY - bandHeight + 1);
  let footMinX = canvas.width;
  let footMaxX = -1;

  for (let y = bandTop; y <= maxY; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > alphaThreshold) {
        footMinX = Math.min(footMinX, x);
        footMaxX = Math.max(footMaxX, x);
      }
    }
  }

  const footCenterX = footMaxX >= footMinX ? (footMinX + footMaxX + 1) / 2 : canvas.width / 2;
  return {
    pivotX: roundSeconds(footCenterX / canvas.width),
    pivotY: roundSeconds((canvas.height - maxY - 1) / canvas.height),
  };
}

function findVisibleAlphaBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX, maxY };
}

function mergeBounds(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function expandBounds(bounds, width, height, padding) {
  return {
    minX: Math.max(0, bounds.minX - padding),
    minY: Math.max(0, bounds.minY - padding),
    maxX: Math.min(width - 1, bounds.maxX + padding),
    maxY: Math.min(height - 1, bounds.maxY + padding),
  };
}

function makeCenterPreservingCropBounds(bounds, width, height, padding) {
  const expanded = expandBounds(bounds, width, height, padding);
  const horizontalMargin = Math.max(0, Math.min(expanded.minX, width - 1 - expanded.maxX));
  const verticalMargin = Math.max(0, Math.min(expanded.minY, height - 1 - expanded.maxY));
  return {
    minX: horizontalMargin,
    minY: verticalMargin,
    maxX: width - 1 - horizontalMargin,
    maxY: height - 1 - verticalMargin,
  };
}

function clearOutsideBounds(data, width, height, bounds) {
  for (let y = 0; y < height; y++) {
    const outsideY = y < bounds.minY || y > bounds.maxY;
    for (let x = 0; x < width; x++) {
      if (outsideY || x < bounds.minX || x > bounds.maxX) {
        const i = (y * width + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
  }
}

function estimateGifFrameCount(bytes) {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x2c) count++;
  }
  return count;
}

class GifReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  eof() {
    return this.offset >= this.bytes.length;
  }

  readByte() {
    if (this.offset >= this.bytes.length) throw new Error("GIF 数据提前结束。");
    return this.bytes[this.offset++];
  }

  readUint16() {
    const a = this.readByte();
    const b = this.readByte();
    return a | (b << 8);
  }

  readString(length) {
    let value = "";
    for (let i = 0; i < length; i++) value += String.fromCharCode(this.readByte());
    return value;
  }

  readColorTable(size) {
    const table = new Array(size);
    for (let i = 0; i < size; i++) {
      table[i] = [this.readByte(), this.readByte(), this.readByte()];
    }
    return table;
  }

  readSubBlocks() {
    const chunks = [];
    let total = 0;
    while (true) {
      const size = this.readByte();
      if (size === 0) break;
      const chunk = this.bytes.slice(this.offset, this.offset + size);
      chunks.push(chunk);
      total += chunk.length;
      this.offset += size;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  skip(count) {
    this.offset += count;
  }
}

function lzwDecode(minCodeSize, data, expectedLength) {
  const maxStackSize = 4096;
  const nullCode = -1;
  const output = new Uint8Array(expectedLength);
  const prefix = new Array(maxStackSize);
  const suffix = new Array(maxStackSize);
  const pixelStack = new Array(maxStackSize + 1);

  const clear = 1 << minCodeSize;
  const endOfInformation = clear + 1;
  let available = clear + 2;
  let oldCode = nullCode;
  let codeSize = minCodeSize + 1;
  let codeMask = (1 << codeSize) - 1;

  for (let code = 0; code < clear; code++) {
    prefix[code] = 0;
    suffix[code] = code;
  }

  let datum = 0;
  let bits = 0;
  let first = 0;
  let top = 0;
  let pi = 0;
  let bi = 0;

  for (let i = 0; i < expectedLength; ) {
    if (top === 0) {
      if (bits < codeSize) {
        if (bi >= data.length) break;
        datum += data[bi] << bits;
        bits += 8;
        bi++;
        continue;
      }

      let code = datum & codeMask;
      datum >>= codeSize;
      bits -= codeSize;

      if (code > available || code === endOfInformation) break;

      if (code === clear) {
        codeSize = minCodeSize + 1;
        codeMask = (1 << codeSize) - 1;
        available = clear + 2;
        oldCode = nullCode;
        continue;
      }

      if (oldCode === nullCode) {
        pixelStack[top++] = suffix[code];
        oldCode = code;
        first = code;
        continue;
      }

      const inCode = code;

      if (code === available) {
        pixelStack[top++] = first;
        code = oldCode;
      }

      while (code > clear) {
        pixelStack[top++] = suffix[code];
        code = prefix[code];
      }

      first = suffix[code] & 0xff;
      pixelStack[top++] = first;

      if (available < maxStackSize) {
        prefix[available] = oldCode;
        suffix[available] = first;
        available++;
        if ((available & codeMask) === 0 && available < maxStackSize) {
          codeSize++;
          codeMask += available;
        }
      }

      oldCode = inCode;
    }

    top--;
    output[pi++] = pixelStack[top];
    i++;
  }

  return output;
}

function drawIndexedFrame(options) {
  const rows = options.interlaced
    ? interlaceRows(options.frameHeight)
    : Array.from({ length: options.frameHeight }, (_, row) => row);
  let pixelOffset = 0;

  for (const row of rows) {
    const y = options.top + row;
    for (let x = 0; x < options.frameWidth; x++) {
      const index = options.pixels[pixelOffset++];
      if (index === options.transparentIndex) continue;

      const targetX = options.left + x;
      if (targetX < 0 || targetX >= options.canvasWidth || y < 0 || y >= options.canvasHeight) continue;

      const color = options.colorTable[index] || [0, 0, 0];
      const out = (y * options.canvasWidth + targetX) * 4;
      options.canvasData[out] = color[0];
      options.canvasData[out + 1] = color[1];
      options.canvasData[out + 2] = color[2];
      options.canvasData[out + 3] = 255;
    }
  }
}

function interlaceRows(height) {
  const rows = [];
  for (let y = 0; y < height; y += 8) rows.push(y);
  for (let y = 4; y < height; y += 8) rows.push(y);
  for (let y = 2; y < height; y += 4) rows.push(y);
  for (let y = 1; y < height; y += 2) rows.push(y);
  return rows;
}

function copyArea(data, canvasWidth, left, top, width, height) {
  const copy = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((top + y) * canvasWidth + left) * 4;
    const srcEnd = srcStart + width * 4;
    copy.set(data.slice(srcStart, srcEnd), y * width * 4);
  }
  return copy;
}

function applyDisposal(data, canvasWidth, disposalInfo, backgroundColor) {
  if (disposalInfo.disposal === 2) {
    for (let y = 0; y < disposalInfo.height; y++) {
      for (let x = 0; x < disposalInfo.width; x++) {
        const i = ((disposalInfo.top + y) * canvasWidth + disposalInfo.left + x) * 4;
        if (backgroundColor) {
          data[i] = backgroundColor[0];
          data[i + 1] = backgroundColor[1];
          data[i + 2] = backgroundColor[2];
          data[i + 3] = 0;
        } else {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 0;
        }
      }
    }
  } else if (disposalInfo.disposal === 3 && disposalInfo.restore) {
    restoreArea(data, canvasWidth, disposalInfo);
  }
}

function restoreArea(data, canvasWidth, disposalInfo) {
  for (let y = 0; y < disposalInfo.height; y++) {
    const destStart = ((disposalInfo.top + y) * canvasWidth + disposalInfo.left) * 4;
    const srcStart = y * disposalInfo.width * 4;
    data.set(disposalInfo.restore.slice(srcStart, srcStart + disposalInfo.width * 4), destStart);
  }
}

async function buildCocosFiles(settings, frames, delays) {
  const files = [];
  const root = `${settings.folder}/`;
  const clipFolder = `${root}${settings.clip}/`;
  const stateName = inferClipStateName(settings.clip);
  const deduplicated = await deduplicateCocosFrames(frames);

  files.push({ name: `${settings.folder}.meta`, data: jsonBytes(makeDirectoryMeta()) });
  files.push({ name: `${root}${settings.clip}.meta`, data: jsonBytes(makeDirectoryMeta()) });
  files.push({
    name: `${root}${settings.clip}.anim`,
    data: jsonBytes(makeAnimClip(stateName, deduplicated.animationUuids, delays, settings.loop)),
  });
  files.push({ name: `${root}${settings.clip}.anim.meta`, data: jsonBytes(makeAnimMeta(stateName)) });

  for (const { frame, pngBytes } of deduplicated.uniqueFrames) {
    const frameWidth = frame.width || settings.width;
    const frameHeight = frame.height || settings.height;
    files.push({ name: `${clipFolder}${frame.name}.png`, data: pngBytes });
    files.push({
      name: `${clipFolder}${frame.name}.png.meta`,
      data: jsonBytes(
        makePngMeta(frame.uuid, frame.name, frameWidth, frameHeight, frame.pivotX, frame.pivotY)
      ),
    });
  }

  return files;
}

async function deduplicateCocosFrames(frames) {
  const uniqueFrames = [];
  const byHash = new Map();
  const animationUuids = [];

  for (const frame of frames) {
    const pngBytes = new Uint8Array(await frame.blob.arrayBuffer());
    const hash = await hashBytes(pngBytes);
    let unique = byHash.get(hash);
    if (!unique) {
      unique = { frame, pngBytes };
      byHash.set(hash, unique);
      uniqueFrames.push(unique);
    }
    animationUuids.push(unique.frame.spriteUuid);
  }

  return { uniqueFrames, animationUuids };
}

async function hashBytes(bytes) {
  if (crypto.subtle?.digest) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${bytes.length}:${crc32(bytes)}`;
}

async function buildSequenceFrameFiles(frames) {
  const files = [];
  for (const frame of frames) {
    const pngBytes = new Uint8Array(await frame.blob.arrayBuffer());
    files.push({ name: `${frame.name}.png`, data: pngBytes });
  }
  return files;
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}

function renderPreview(index = 0) {
  if (!state.frames.length) {
    clearCanvas();
    return;
  }

  const frame = state.frames[index];
  const canvas = elements.previewCanvas;
  canvas.width = frame.width || getSettings().width;
  canvas.height = frame.height || getSettings().height;
  const ctx = canvas.getContext("2d");
  const image = new Image();
  image.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
  };
  image.src = frame.url;

  elements.frameRange.value = String(index);
  elements.frameText.textContent = `${index + 1} / ${state.frames.length}`;
  for (const button of elements.filmStrip.querySelectorAll("button")) {
    button.classList.toggle("is-selected", Number(button.dataset.index) === index);
  }
}

function renderFilmStrip() {
  elements.filmStrip.innerHTML = "";
  if (!state.frames.length) return;

  const maxThumbs = 18;
  const step = Math.max(1, Math.ceil(state.frames.length / maxThumbs));
  for (let i = 0; i < state.frames.length; i += step) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(i);
    const canvas = document.createElement("canvas");
    canvas.width = 70;
    canvas.height = 70;
    drawThumbnail(state.frames[i].url, canvas);
    button.appendChild(canvas);
    button.addEventListener("click", () => {
      state.selectedFrame = i;
      renderPreview(i);
    });
    elements.filmStrip.appendChild(button);
  }
}

function drawThumbnail(url, canvas) {
  const context = canvas.getContext("2d");
  const image = new Image();
  image.onload = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
  };
  image.src = url;
}

async function convertCurrentFile() {
  if (!state.file || state.isBusy) return;

  resetOutput();
  updateTree();
  setBusy(true);
  setMessage(
    state.fileKind === "png"
      ? "正在把 PNG 序列打包为 Cocos 资源。"
      : state.fileKind === "mp4"
        ? "正在从 MP4 抽帧并生成 PNG 序列帧和 Cocos 资源。"
        : "正在拆分 GIF 并生成 PNG 序列帧和 Cocos 资源。"
  );

  try {
    const result =
      state.fileKind === "png"
        ? await processPngSequence(state.pngFiles)
        : state.fileKind === "mp4"
          ? await processMp4(state.file)
          : await processGif(state.file);
    state.frames = result.frames;
    state.cocosZipBlob = result.cocosZipBlob;
    state.sequenceZipBlob = result.sequenceZipBlob;
    state.selectedFrame = 0;
    state.outputWidth = result.settings.width;
    state.outputHeight = result.settings.height;
    state.settingsSignature = makeSettingsSignature(result.inputSettings || result.settings);
    elements.sourceBytes.textContent = formatBytes(state.sourceBytes);
    elements.cocosBytes.textContent = formatBytes(result.cocosZipBlob.size);

    elements.frameRange.disabled = false;
    elements.frameRange.max = String(state.frames.length - 1);
    elements.frameCount.textContent = String(state.frames.length);
    elements.durationText.textContent = `${result.totalDuration.toFixed(2)}s`;
    elements.outputSize.textContent = `${state.outputWidth}x${state.outputHeight}`;
    if (state.fileKind === "png" && state.frames[0]) {
      elements.treeFrame.textContent = `${state.frames[0].name}.png`;
      elements.treeFrameMeta.textContent = `${state.frames[0].name}.png.meta`;
    }
    elements.progressText.textContent = "100%";
    const stateName = inferClipStateName(result.settings.clip);
    elements.statusText.textContent = `${result.settings.clip}.anim 已生成 · Clip: ${stateName}`;
    renderFilmStrip();
    renderPreview(0);
    const dimensionSummary = `${state.sourceWidth}×${state.sourceHeight} → ${state.outputWidth}×${state.outputHeight}`;
    const savings =
      state.sourceBytes > 0 && result.cocosZipBlob.size < state.sourceBytes
        ? `，比源文件小 ${Math.round((1 - result.cocosZipBlob.size / state.sourceBytes) * 100)}%`
        : "";
    setMessage(
      `极致无损完成：${dimensionSummary}，Cocos ${formatBytes(result.cocosZipBlob.size)}${savings}，轴心已对齐每帧脚底中心（Clip: ${stateName}）。`,
      "ok"
    );
  } catch (error) {
    console.error(error);
    setMessage(error.message || "转换失败。", "error");
    elements.statusText.textContent = "转换失败";
  } finally {
    setBusy(false);
  }
}

function handleFile(file) {
  if (!file) return;
  const fileKind = getFileKind(file);
  if (!fileKind) {
    setMessage("请选择 GIF 或 MP4 文件。", "error");
    return;
  }

  state.file = file;
  state.pngFiles = [];
  state.sourceBytes = file.size;
  state.fileKind = fileKind;
  updateFileKindControls();
  elements.fileName.textContent = file.name;
  if (!elements.clipInput.dataset.touched) {
    elements.clipInput.value = sanitizeName(file.name, "dog_idle");
  }
  elements.convertBtn.disabled = false;
  convertCurrentFile();
}

function handlePngFiles(fileList) {
  const files = [...fileList]
    .filter((file) => /\.png$/i.test(file.name) || file.type === "image/png")
    .sort((a, b) => naturalFileNameCollator.compare(a.name, b.name));
  if (!files.length) {
    setMessage("所选内容中没有 PNG 文件。", "error");
    return;
  }

  const sequenceName = inferPngSequenceName(files);
  state.file = files[0];
  state.pngFiles = files;
  state.sourceBytes = files.reduce((sum, file) => sum + file.size, 0);
  state.sourceWidth = 0;
  state.sourceHeight = 0;
  state.fileKind = "png";
  updateFileKindControls();
  elements.fileName.textContent = `${sequenceName} · ${files.length} 个 PNG`;
  if (!elements.folderInput.dataset.touched) elements.folderInput.value = sequenceName;
  if (!elements.clipInput.dataset.touched) elements.clipInput.value = sequenceName;
  elements.convertBtn.disabled = false;
  convertCurrentFile();
}

function inferPngSequenceName(files) {
  const relativePath = files[0]?.webkitRelativePath || "";
  const folderName = relativePath.split("/").filter(Boolean)[0];
  if (folderName) return sanitizeName(folderName, "png_sequence");
  const fileName = files[0]?.name.replace(/\.[^.]+$/, "").replace(/[_\-\s]*\d+$/, "");
  return sanitizeName(fileName, "png_sequence");
}

function getFileKind(file) {
  if (/\.gif$/i.test(file.name) || file.type === "image/gif") return "gif";
  if (/\.mp4$/i.test(file.name) || file.type === "video/mp4") return "mp4";
  if (/\.png$/i.test(file.name) || file.type === "image/png") return "png";
  return "";
}

function downloadZip() {
  if (!state.cocosZipBlob) return;
  const settings = getSettings();
  downloadBlob(state.cocosZipBlob, `${settings.folder}_${settings.clip}_cocos.zip`);
}

function downloadSequenceZip() {
  if (!state.sequenceZipBlob) return;
  const settings = getSettings();
  downloadBlob(state.sequenceZipBlob, `${settings.clip}_frames.zip`);
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

function inferClipStateName(clipName) {
  const normalized = String(clipName || "").trim();
  if (/(^|[_\-\s])(idle|stand)([_\-\s]|$)|待机|站立/i.test(normalized)) return "idle";
  if (/(^|[_\-\s])(run|running)([_\-\s]|$)|跑步|奔跑|跑/i.test(normalized)) return "run";
  return normalized;
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const directories = new Set();
  const normalizedFiles = files.map((file) => {
    const name = file.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const parts = name.split("/").filter(Boolean);
    let directory = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      directory += `${parts[index]}/`;
      directories.add(directory);
    }
    return { ...file, name, isDirectory: false };
  });
  const entries = [
    ...[...directories].map((name) => ({ name, data: new Uint8Array(), isDirectory: true })),
    ...normalizedFiles,
  ];
  let offset = 0;

  for (const file of entries) {
    const nameBytes = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
    const compressed = file.isDirectory ? null : await deflateRaw(data);
    const useDeflate = Boolean(compressed && compressed.length < data.length);
    const payload = useDeflate ? compressed : data;
    const compressionMethod = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const dosTime = getDosTime(new Date());
    const dosDate = getDosDate(new Date());

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, compressionMethod, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, payload);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, compressionMethod, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, payload.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, file.isDirectory ? 0x10 : 0, true);
    central.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + payload.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
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
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosTime(date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function getDosDate(date) {
  return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function bindEvents() {
  elements.gifInput.addEventListener("change", (event) => {
    const files = [...event.target.files];
    if (files.length && files.every((file) => getFileKind(file) === "png")) handlePngFiles(files);
    else handleFile(files[0]);
    event.target.value = "";
  });
  elements.pngFolderInput.addEventListener("change", (event) => {
    handlePngFiles(event.target.files);
    event.target.value = "";
  });
  elements.convertBtn.addEventListener("click", convertCurrentFile);
  elements.downloadBtn.addEventListener("click", downloadZip);
  elements.downloadSequenceBtn.addEventListener("click", downloadSequenceZip);

  elements.frameRange.addEventListener("input", () => {
    state.selectedFrame = Number(elements.frameRange.value);
    renderPreview(state.selectedFrame);
  });

  for (const input of [elements.folderInput, elements.clipInput]) {
    input.addEventListener("input", () => {
      input.dataset.touched = "true";
      updateTree();
      markOutputStale("资源名已变更，重新生成后下载。");
    });
  }

  for (const input of [
    elements.widthInput,
    elements.heightInput,
    elements.autoCropSelect,
    elements.cropPaddingInput,
    elements.fitSelect,
    elements.loopSelect,
    elements.alphaSelect,
    elements.frameRateInput,
    elements.pngFrameRateInput,
  ]) {
    input.addEventListener("change", () => {
      updateTree();
      markOutputStale("输出设置已变更，重新生成后下载。", { clearCanvas: true });
    });
  }

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

  elements.dropZone.addEventListener("drop", (event) => {
    const files = [...event.dataTransfer.files];
    const pngFiles = files.filter((file) => getFileKind(file) === "png");
    if (pngFiles.length && pngFiles.length === files.length) handlePngFiles(pngFiles);
    else handleFile(files[0]);
  });
}

function init() {
  updateTree();
  updateFileKindControls();
  clearCanvas();
  bindEvents();
}

init();
