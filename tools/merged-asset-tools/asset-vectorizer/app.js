const $ = (selector) => document.querySelector(selector);

const ui = {
  fileInput: $("#fileInput"),
  sampleBtn: $("#sampleBtn"),
  analyzeBtn: $("#analyzeBtn"),
  splitBtn: $("#splitBtn"),
  zipBtn: $("#zipBtn"),
  clearBtn: $("#clearBtn"),
  pickBgBtn: $("#pickBgBtn"),
  previewCanvas: $("#previewCanvas"),
  dropZone: $("#dropZone"),
  emptyState: $("#emptyState"),
  assetList: $("#assetList"),
  imageMeta: $("#imageMeta"),
  statusText: $("#statusText"),
  selectedText: $("#selectedText"),
  assetCount: $("#assetCount"),
  processTime: $("#processTime"),
  bgSwatch: $("#bgSwatch"),
  bgText: $("#bgText"),
  removeEnclosed: $("#removeEnclosed"),
  exportMode: $("#exportMode"),
  controls: {
    tolerance: $("#tolerance"),
    edgeTrim: $("#edgeTrim"),
    innerStroke: $("#innerStroke"),
    mergeGap: $("#mergeGap"),
    minArea: $("#minArea"),
    padding: $("#padding"),
    scale: $("#scale"),
    sharpness: $("#sharpness"),
    feather: $("#feather"),
  },
  outputs: {
    tolerance: $("#toleranceOut"),
    edgeTrim: $("#edgeTrimOut"),
    innerStroke: $("#innerStrokeOut"),
    mergeGap: $("#mergeGapOut"),
    minArea: $("#minAreaOut"),
    padding: $("#paddingOut"),
    scale: $("#scaleOut"),
    sharpness: $("#sharpnessOut"),
    feather: $("#featherOut"),
  },
};

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const processedCanvas = document.createElement("canvas");
const processedCtx = processedCanvas.getContext("2d", { willReadFrequently: true });
const previewCtx = ui.previewCanvas.getContext("2d");

const state = {
  image: null,
  imageName: "",
  imageData: null,
  processedImageData: null,
  bgColor: { r: 255, g: 255, b: 255, a: 255 },
  bgMask: null,
  labels: null,
  components: [],
  groups: [],
  selectedId: null,
  pickingBg: false,
  draw: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    scale: 1,
    dpr: 1,
  },
  settings: {
    tolerance: 32,
    edgeTrim: 1,
    innerStroke: 40,
    removeEnclosed: true,
    mergeGap: 8,
    minArea: 120,
    padding: 12,
    scale: 2,
    sharpness: 22,
    feather: 0,
  },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pad2 = (value) => value.toString(16).padStart(2, "0");

function updateControlText() {
  state.settings.tolerance = Number(ui.controls.tolerance.value);
  state.settings.edgeTrim = Number(ui.controls.edgeTrim.value);
  state.settings.innerStroke = Number(ui.controls.innerStroke.value);
  state.settings.removeEnclosed = ui.removeEnclosed.checked;
  state.settings.mergeGap = Number(ui.controls.mergeGap.value);
  state.settings.minArea = Number(ui.controls.minArea.value);
  state.settings.padding = Number(ui.controls.padding.value);
  state.settings.scale = Number(ui.controls.scale.value);
  state.settings.sharpness = Number(ui.controls.sharpness.value);
  state.settings.feather = Number(ui.controls.feather.value);

  ui.outputs.tolerance.value = state.settings.tolerance;
  ui.outputs.edgeTrim.value = `${state.settings.edgeTrim} px`;
  ui.outputs.innerStroke.value = `${state.settings.innerStroke}%`;
  ui.outputs.mergeGap.value = `${state.settings.mergeGap} px`;
  ui.outputs.minArea.value = state.settings.minArea;
  ui.outputs.padding.value = `${state.settings.padding} px`;
  ui.outputs.scale.value = `${state.settings.scale}x`;
  ui.outputs.sharpness.value = `${state.settings.sharpness}%`;
  ui.outputs.feather.value = `${state.settings.feather} px`;
}

function updateBgUi() {
  const { r, g, b } = state.bgColor;
  const hex = `#${pad2(r)}${pad2(g)}${pad2(b)}`;
  ui.bgSwatch.style.background = hex;
  ui.bgText.textContent = hex;
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function fileToImage(file, name = file.name) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ image, name });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片载入失败"));
    };
    image.src = url;
  });
}

async function loadSample() {
  setStatus("载入示例图...");
  const response = await fetch("sample.png");
  const blob = await response.blob();
  const file = new File([blob], "sample.png", { type: blob.type || "image/png" });
  const result = await fileToImage(file, "sample.png");
  await useImage(result.image, result.name);
}

async function useImage(image, name) {
  state.image = image;
  state.imageName = name;
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  sourceCtx.drawImage(image, 0, 0);
  state.imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  state.processedImageData = null;
  processedCanvas.width = sourceCanvas.width;
  processedCanvas.height = sourceCanvas.height;
  state.bgColor = sampleCornerColor(state.imageData, sourceCanvas.width, sourceCanvas.height);
  state.selectedId = null;
  updateBgUi();
  ui.emptyState.classList.add("is-hidden");
  ui.imageMeta.textContent = `${name} · ${sourceCanvas.width}×${sourceCanvas.height}`;
  renderPreview();
  await analyzeImage();
}

function sampleCornerColor(imageData, width, height) {
  const size = Math.max(2, Math.min(6, Math.floor(Math.min(width, height) / 20)));
  const points = [
    [0, 0],
    [width - size, 0],
    [0, height - size],
    [width - size, height - size],
  ];
  const reds = [];
  const greens = [];
  const blues = [];
  const alphas = [];
  for (const [startX, startY] of points) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = ((startY + y) * width + startX + x) * 4;
        reds.push(imageData.data[offset]);
        greens.push(imageData.data[offset + 1]);
        blues.push(imageData.data[offset + 2]);
        alphas.push(imageData.data[offset + 3]);
      }
    }
  }
  const median = (values) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 255;
  };
  return { r: median(reds), g: median(greens), b: median(blues), a: median(alphas) };
}

function samplePixelColor(imageX, imageY) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const x = clamp(Math.round(imageX), 0, width - 1);
  const y = clamp(Math.round(imageY), 0, height - 1);
  const offset = (y * width + x) * 4;
  const data = state.imageData.data;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3],
  };
}

function intelligentMatte(imageData, width, height, bgColor, settings) {
  const total = width * height;
  const bgMask = new Uint8Array(total);
  const output = new Uint8ClampedArray(imageData.data);
  let transparentPixels = 0;
  for (let index = 0; index < total; index += 1) {
    if (output[index * 4 + 3] < 128) transparentPixels += 1;
  }
  if (transparentPixels / total > 0.1) {
    for (let index = 0; index < total; index += 1) {
      if (output[index * 4 + 3] < 12) bgMask[index] = 1;
    }
    return { imageData: new ImageData(output, width, height), bgMask };
  }
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const nearWhite = bgColor.r + bgColor.g + bgColor.b > 690;
  const effectiveTolerance = nearWhite ? Math.max(settings.tolerance, 42) : settings.tolerance;
  const toleranceSquared = effectiveTolerance * effectiveTolerance;
  const isBackgroundColor = (offset, thresholdSquared = toleranceSquared) => {
    if (output[offset + 3] < 12) return true;
    const dr = output[offset] - bgColor.r;
    const dg = output[offset + 1] - bgColor.g;
    const db = output[offset + 2] - bgColor.b;
    return dr * dr + dg * dg + db * db <= thresholdSquared;
  };
  const pushIfBg = (index) => {
    if (bgMask[index]) return;
    if (!isBackgroundColor(index * 4)) return;
    bgMask[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    pushIfBg(x);
    pushIfBg((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    pushIfBg(y * width);
    pushIfBg(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) pushIfBg(index - 1);
    if (x < width - 1) pushIfBg(index + 1);
    if (y > 0) pushIfBg(index - width);
    if (y < height - 1) pushIfBg(index + width);
  }

  if (settings.removeEnclosed) {
    for (let index = 0; index < total; index += 1) {
      if (!bgMask[index] && isBackgroundColor(index * 4)) bgMask[index] = 1;
    }
  }

  for (let index = 0; index < total; index += 1) {
    if (bgMask[index]) output[index * 4 + 3] = 0;
  }

  const hasTransparentNeighbor = (index, alphaData = output) => {
    const x = index % width;
    const y = (index - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return true;
        if (alphaData[(ny * width + nx) * 4 + 3] === 0) return true;
      }
    }
    return false;
  };

  for (let pass = 0; pass < settings.edgeTrim; pass += 1) {
    const multiplier = 1 + 0.25 * (pass + 1);
    const passToleranceSquared = toleranceSquared * multiplier * multiplier;
    const erase = [];
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      if (output[offset + 3] === 0 || !hasTransparentNeighbor(index)) continue;
      if (isBackgroundColor(offset, passToleranceSquared)) erase.push(index);
    }
    for (const index of erase) {
      bgMask[index] = 1;
      output[index * 4 + 3] = 0;
    }
  }

  const feathered = new Uint8ClampedArray(output);
  const gaussian = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let index = 0; index < total; index += 1) {
    const offset = index * 4;
    if (output[offset + 3] === 0 || !hasTransparentNeighbor(index)) continue;
    const x = index % width;
    const y = (index - x) / width;
    let alphaSum = 0;
    let weightSum = 0;
    let kernelIndex = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        const weight = gaussian[kernelIndex++];
        const alpha = nx < 0 || nx >= width || ny < 0 || ny >= height
          ? 0
          : output[(ny * width + nx) * 4 + 3];
        alphaSum += alpha * weight;
        weightSum += weight;
      }
    }
    feathered[offset + 3] = Math.round(alphaSum / weightSum);
  }

  const strokeStrength = clamp(settings.innerStroke / 100, 0, 1);
  if (strokeStrength > 0) {
    for (let index = 0; index < total; index += 1) {
      const offset = index * 4;
      if (feathered[offset + 3] === 0 || !hasTransparentNeighbor(index, feathered)) continue;
      feathered[offset] = Math.round(feathered[offset] * (1 - strokeStrength));
      feathered[offset + 1] = Math.round(feathered[offset + 1] * (1 - strokeStrength));
      feathered[offset + 2] = Math.round(feathered[offset + 2] * (1 - strokeStrength));
    }
  }

  return { imageData: new ImageData(feathered, width, height), bgMask };
}

function isForeground(index, bgMask, imageData) {
  return !bgMask[index] && imageData.data[index * 4 + 3] > 12;
}

function labelComponents(imageData, bgMask, width, height) {
  const total = width * height;
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  const components = [];
  let label = 0;

  for (let index = 0; index < total; index += 1) {
    if (labels[index] || !isForeground(index, bgMask, imageData)) continue;

    label += 1;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;

    labels[index] = label;
    queue[tail] = index;
    tail += 1;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      const x = current % width;
      const y = (current - x) / width;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      area += 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (labels[next] || !isForeground(next, bgMask, imageData)) continue;
          labels[next] = label;
          queue[tail] = next;
          tail += 1;
        }
      }
    }

    components.push({
      id: label,
      minX,
      minY,
      maxX,
      maxY,
      area,
    });
  }

  return { labels, components };
}

function rectDistance(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX - 1, b.minX - a.maxX - 1));
  const dy = Math.max(0, Math.max(a.minY - b.maxY - 1, b.minY - a.maxY - 1));
  return Math.hypot(dx, dy);
}

function makeDisjointSet(size) {
  const parent = new Int32Array(size);
  const rank = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) parent[i] = i;
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (a, b) => {
    let rootA = find(a);
    let rootB = find(b);
    if (rootA === rootB) return;
    if (rank[rootA] < rank[rootB]) {
      const temp = rootA;
      rootA = rootB;
      rootB = temp;
    }
    parent[rootB] = rootA;
    if (rank[rootA] === rank[rootB]) rank[rootA] += 1;
  };
  return { find, union };
}

function groupComponents(components, mergeGap, minArea) {
  const useful = components.filter((component) => component.area >= 3);
  const dsu = makeDisjointSet(useful.length);

  for (let i = 0; i < useful.length; i += 1) {
    for (let j = i + 1; j < useful.length; j += 1) {
      if (rectDistance(useful[i], useful[j]) <= mergeGap) {
        dsu.union(i, j);
      }
    }
  }

  const grouped = new Map();
  for (let i = 0; i < useful.length; i += 1) {
    const root = dsu.find(i);
    const component = useful[i];
    if (!grouped.has(root)) {
      grouped.set(root, {
        id: 0,
        labels: [],
        labelSet: new Set(),
        minX: component.minX,
        minY: component.minY,
        maxX: component.maxX,
        maxY: component.maxY,
        area: 0,
        partCount: 0,
      });
    }
    const group = grouped.get(root);
    group.labels.push(component.id);
    group.labelSet.add(component.id);
    group.minX = Math.min(group.minX, component.minX);
    group.minY = Math.min(group.minY, component.minY);
    group.maxX = Math.max(group.maxX, component.maxX);
    group.maxY = Math.max(group.maxY, component.maxY);
    group.area += component.area;
    group.partCount += 1;
  }

  return [...grouped.values()]
    .filter((group) => group.area >= minArea)
    .sort((a, b) => (a.minY === b.minY ? a.minX - b.minX : a.minY - b.minY))
    .map((group, index) => ({ ...group, id: index + 1 }));
}

function componentToGroup(component) {
  return {
    id: 0,
    labels: [component.id],
    labelSet: new Set([component.id]),
    minX: component.minX,
    minY: component.minY,
    maxX: component.maxX,
    maxY: component.maxY,
    area: component.area,
    partCount: 1,
  };
}

function sortAndNumberGroups(groups) {
  return groups
    .sort((a, b) => (a.minY === b.minY ? a.minX - b.minX : a.minY - b.minY))
    .map((group, index) => ({ ...group, id: index + 1 }));
}

function updateSplitButton() {
  const selected = state.groups.find((asset) => asset.id === state.selectedId);
  const canSplit = Boolean(selected && selected.partCount > 1);
  ui.splitBtn.disabled = !canSplit;
  ui.splitBtn.title = canSplit
    ? `将选中素材拆成 ${selected.partCount} 个独立元素`
    : "请选择包含多个元素的素材";
}

function splitSelectedAsset() {
  const selected = state.groups.find((asset) => asset.id === state.selectedId);
  if (!selected || selected.partCount <= 1) {
    setStatus("当前素材没有可拆分的独立元素");
    updateSplitButton();
    return;
  }

  const componentById = new Map(state.components.map((component) => [component.id, component]));
  const splitGroups = selected.labels
    .map((label) => componentById.get(label))
    .filter(Boolean)
    .map(componentToGroup);
  if (splitGroups.length <= 1) {
    setStatus("当前素材没有可拆分的独立元素");
    updateSplitButton();
    return;
  }

  const selectedLabel = splitGroups[0].labels[0];
  state.groups = sortAndNumberGroups([
    ...state.groups.filter((asset) => asset.id !== selected.id),
    ...splitGroups,
  ]);
  state.selectedId = state.groups.find((asset) => asset.labels[0] === selectedLabel)?.id ?? null;
  ui.assetCount.textContent = state.groups.length;
  ui.zipBtn.disabled = false;
  setStatus(`已将 ${getAssetName(selected)} 拆成 ${splitGroups.length} 个独立 PNG 元素`);
  renderPreview();
  renderAssets();
}

async function analyzeImage() {
  if (!state.imageData) return;
  updateControlText();
  setStatus("正在分离素材...");
  ui.analyzeBtn.disabled = true;
  ui.splitBtn.disabled = true;
  ui.zipBtn.disabled = true;
  await nextFrame();

  const start = performance.now();
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const matte = intelligentMatte(
    state.imageData,
    width,
    height,
    state.bgColor,
    state.settings,
  );
  state.bgMask = matte.bgMask;
  state.processedImageData = matte.imageData;
  processedCtx.putImageData(matte.imageData, 0, 0);
  const labeled = labelComponents(matte.imageData, state.bgMask, width, height);
  state.labels = labeled.labels;
  state.components = labeled.components;
  state.groups = groupComponents(
    labeled.components,
    state.settings.mergeGap,
    state.settings.minArea,
  );
  if (!state.groups.some((group) => group.id === state.selectedId)) {
    state.selectedId = state.groups[0]?.id ?? null;
  }

  const elapsed = Math.round(performance.now() - start);
  ui.assetCount.textContent = state.groups.length;
  ui.processTime.textContent = `${elapsed} ms`;
  setStatus(`智能抠图完成，已分离 ${state.groups.length} 个素材`);
  ui.analyzeBtn.disabled = false;
  ui.zipBtn.disabled = state.groups.length === 0;
  renderPreview();
  renderAssets();
}

function getAssetName(asset) {
  return `asset-${String(asset.id).padStart(2, "0")}`;
}

function assetDimensions(asset) {
  const pad = state.settings.padding;
  return {
    x0: asset.minX - pad,
    y0: asset.minY - pad,
    width: asset.maxX - asset.minX + 1 + pad * 2,
    height: asset.maxY - asset.minY + 1 + pad * 2,
  };
}

function makeAssetCanvas(asset, options = {}) {
  const pad = options.padding ?? state.settings.padding;
  const scale = options.scale ?? state.settings.scale;
  const feather = options.feather ?? state.settings.feather;
  const sharpness = options.sharpness ?? state.settings.sharpness;
  const bounds = {
    x0: asset.minX - pad,
    y0: asset.minY - pad,
    width: asset.maxX - asset.minX + 1 + pad * 2,
    height: asset.maxY - asset.minY + 1 + pad * 2,
  };
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, bounds.width);
  cropCanvas.height = Math.max(1, bounds.height);
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
  const output = cropCtx.createImageData(cropCanvas.width, cropCanvas.height);
  const mask = new Uint8Array(cropCanvas.width * cropCanvas.height);
  const source = (state.processedImageData ?? state.imageData).data;
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;

  for (let y = 0; y < cropCanvas.height; y += 1) {
    const sy = bounds.y0 + y;
    for (let x = 0; x < cropCanvas.width; x += 1) {
      const sx = bounds.x0 + x;
      const destIndex = y * cropCanvas.width + x;
      const destOffset = destIndex * 4;
      if (sx < 0 || sx >= sourceWidth || sy < 0 || sy >= sourceHeight) continue;
      const label = state.labels[sy * sourceWidth + sx];
      if (!asset.labelSet.has(label)) continue;
      const sourceOffset = (sy * sourceWidth + sx) * 4;
      output.data[destOffset] = source[sourceOffset];
      output.data[destOffset + 1] = source[sourceOffset + 1];
      output.data[destOffset + 2] = source[sourceOffset + 2];
      output.data[destOffset + 3] = source[sourceOffset + 3];
      mask[destIndex] = 1;
    }
  }

  if (feather > 0) {
    applyFeather(output, mask, cropCanvas.width, cropCanvas.height, feather);
  }

  cropCtx.putImageData(output, 0, 0);

  if (scale === 1 && sharpness === 0) return cropCanvas;

  const scaledCanvas = document.createElement("canvas");
  scaledCanvas.width = Math.max(1, Math.round(cropCanvas.width * scale));
  scaledCanvas.height = Math.max(1, Math.round(cropCanvas.height * scale));
  const scaledCtx = scaledCanvas.getContext("2d", { willReadFrequently: true });
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(cropCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
  if (sharpness > 0) {
    sharpenCanvas(scaledCanvas, sharpness / 100);
  }
  return scaledCanvas;
}

function applyFeather(imageData, mask, width, height, radius) {
  const sourceAlpha = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    sourceAlpha[i] = imageData.data[i * 4 + 3];
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      let nearest = radius + 1;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const distance = Math.hypot(dx, dy);
          if (distance > radius) continue;
          if (!mask[ny * width + nx]) nearest = Math.min(nearest, distance);
        }
      }
      if (nearest <= radius) {
        const factor = clamp((nearest + 0.6) / (radius + 0.6), 0.18, 1);
        imageData.data[index * 4 + 3] = Math.round(sourceAlpha[index] * factor);
      }
    }
  }
}

function sharpenCanvas(canvas, strength) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const src = imageData.data;
  const out = new Uint8ClampedArray(src);
  const width = canvas.width;
  const height = canvas.height;
  const amount = clamp(strength, 0, 1.4);
  const getChannel = (x, y, channel, fallbackOffset) => {
    const nx = clamp(x, 0, width - 1);
    const ny = clamp(y, 0, height - 1);
    const offset = (ny * width + nx) * 4;
    if (src[offset + 3] < 8) return src[fallbackOffset + channel];
    return src[offset + channel];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (src[offset + 3] < 8) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = src[offset + channel] * (1 + amount * 4);
        const sides =
          getChannel(x - 1, y, channel, offset) +
          getChannel(x + 1, y, channel, offset) +
          getChannel(x, y - 1, channel, offset) +
          getChannel(x, y + 1, channel, offset);
        out[offset + channel] = clamp(Math.round(center - sides * amount), 0, 255);
      }
    }
  }
  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
}

function buildRunPath(asset, pad = state.settings.padding) {
  const x0 = asset.minX - pad;
  const y0 = asset.minY - pad;
  const width = asset.maxX - asset.minX + 1 + pad * 2;
  const height = asset.maxY - asset.minY + 1 + pad * 2;
  const sourceWidth = sourceCanvas.width;
  const sourceHeight = sourceCanvas.height;
  const path = [];

  for (let y = 0; y < height; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= width; x += 1) {
      let inside = false;
      if (x < width) {
        const sx = x0 + x;
        const sy = y0 + y;
        if (sx >= 0 && sx < sourceWidth && sy >= 0 && sy < sourceHeight) {
          inside = asset.labelSet.has(state.labels[sy * sourceWidth + sx]);
        }
      }
      if (inside && runStart < 0) {
        runStart = x;
      } else if (!inside && runStart >= 0) {
        path.push(`M${runStart} ${y}H${x}V${y + 1}H${runStart}Z`);
        runStart = -1;
      }
    }
  }
  return {
    d: path.join(""),
    width,
    height,
  };
}

function averageAssetColor(asset) {
  const source = (state.processedImageData ?? state.imageData).data;
  const width = sourceCanvas.width;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = asset.minY; y <= asset.maxY; y += 1) {
    for (let x = asset.minX; x <= asset.maxX; x += 1) {
      const label = state.labels[y * width + x];
      if (!asset.labelSet.has(label)) continue;
      const offset = (y * width + x) * 4;
      const alpha = source[offset + 3] / 255;
      if (alpha < 0.1) continue;
      r += source[offset] * alpha;
      g += source[offset + 1] * alpha;
      b += source[offset + 2] * alpha;
      count += alpha;
    }
  }
  if (!count) return "#222b26";
  return `#${pad2(Math.round(r / count))}${pad2(Math.round(g / count))}${pad2(Math.round(b / count))}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeSvgString(asset) {
  const canvas = makeAssetCanvas(asset);
  const raster = canvas.toDataURL("image/png");
  const path = buildRunPath(asset);
  const title = getAssetName(asset);

  if (ui.exportMode.value === "silhouette") {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${path.width}" height="${path.height}" viewBox="0 0 ${path.width} ${path.height}">`,
      `<title>${escapeXml(title)}</title>`,
      `<path d="${path.d}" fill="${averageAssetColor(asset)}"/>`,
      "</svg>",
    ].join("");
  }

  const clipId = `clip-${title}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${path.width} ${path.height}">`,
    `<title>${escapeXml(title)}</title>`,
    "<defs>",
    `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${path.d}"/></clipPath>`,
    "</defs>",
    `<image href="${raster}" x="0" y="0" width="${path.width}" height="${path.height}" preserveAspectRatio="none" clip-path="url(#${clipId})"/>`,
    "</svg>",
  ].join("");
}

function renderPreview() {
  const canvas = ui.previewCanvas;
  const stage = ui.dropZone;
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(320, Math.floor(rect.height));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`;
  if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`;
  previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  previewCtx.clearRect(0, 0, width, height);

  if (!state.image) {
    ui.emptyState.classList.remove("is-hidden");
    return;
  }

  const scale = Math.min(width / sourceCanvas.width, height / sourceCanvas.height);
  const drawWidth = sourceCanvas.width * scale;
  const drawHeight = sourceCanvas.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  state.draw = { x, y, width: drawWidth, height: drawHeight, scale, dpr };

  previewCtx.save();
  previewCtx.imageSmoothingEnabled = true;
  previewCtx.imageSmoothingQuality = "high";
  previewCtx.drawImage(state.processedImageData ? processedCanvas : state.image, x, y, drawWidth, drawHeight);
  previewCtx.restore();

  if (!state.groups.length) return;

  previewCtx.save();
  previewCtx.lineWidth = 1.5;
  previewCtx.font = "12px Inter, sans-serif";
  previewCtx.textBaseline = "top";
  for (const asset of state.groups) {
    const selected = asset.id === state.selectedId;
    const bx = x + asset.minX * scale;
    const by = y + asset.minY * scale;
    const bw = (asset.maxX - asset.minX + 1) * scale;
    const bh = (asset.maxY - asset.minY + 1) * scale;
    previewCtx.strokeStyle = selected ? "#ef4444" : "#28a9f4";
    previewCtx.fillStyle = selected ? "rgba(239, 68, 68, 0.12)" : "rgba(40, 169, 244, 0.12)";
    previewCtx.fillRect(bx, by, bw, bh);
    previewCtx.strokeRect(bx, by, bw, bh);
    previewCtx.fillStyle = selected ? "#ef4444" : "#28a9f4";
    const tag = String(asset.id).padStart(2, "0");
    const labelWidth = previewCtx.measureText(tag).width + 10;
    previewCtx.fillRect(bx, Math.max(0, by - 18), labelWidth, 18);
    previewCtx.fillStyle = "#ffffff";
    previewCtx.fillText(tag, bx + 5, Math.max(0, by - 16));
  }
  previewCtx.restore();
}

function renderAssets() {
  ui.assetList.textContent = "";
  ui.selectedText.textContent = state.selectedId
    ? `已选择 ${getAssetName(state.groups.find((asset) => asset.id === state.selectedId))}`
    : "未选择素材";

  const fragment = document.createDocumentFragment();
  for (const asset of state.groups) {
    const card = document.createElement("article");
    card.className = `asset-card${asset.id === state.selectedId ? " is-selected" : ""}`;
    card.dataset.assetId = String(asset.id);

    const preview = document.createElement("div");
    preview.className = "asset-preview";
    const image = document.createElement("img");
    const previewCanvas = makeAssetCanvas(asset, {
      padding: state.settings.padding,
      scale: 1,
      sharpness: Math.min(state.settings.sharpness, 38),
      feather: state.settings.feather,
    });
    image.alt = getAssetName(asset);
    image.src = previewCanvas.toDataURL("image/png");
    preview.append(image);

    const info = document.createElement("div");
    info.className = "asset-info";
    const title = document.createElement("div");
    title.className = "asset-title";
    title.innerHTML = `<strong>${getAssetName(asset)}</strong><span>${asset.partCount} 块</span>`;
    const dims = assetDimensions(asset);
    const meta = document.createElement("div");
    meta.className = "asset-meta";
    meta.textContent = `${dims.width}×${dims.height} · ${asset.area} px`;
    const actions = document.createElement("div");
    actions.className = "asset-actions";
    actions.innerHTML = [
      `<button type="button" class="small-button primary" data-action="svg" data-id="${asset.id}"><i data-lucide="file-code-2"></i><span>SVG</span></button>`,
      `<button type="button" class="small-button" data-action="png" data-id="${asset.id}"><i data-lucide="file-image"></i><span>PNG</span></button>`,
    ].join("");
    info.append(title, meta, actions);
    card.append(preview, info);
    fragment.append(card);
  }
  ui.assetList.append(fragment);
  updateSplitButton();
  window.lucide?.createIcons();
}

function selectAsset(id) {
  state.selectedId = id;
  renderPreview();
  renderAssets();
}

function pointToImage(event) {
  const rect = ui.previewCanvas.getBoundingClientRect();
  const cx = event.clientX - rect.left;
  const cy = event.clientY - rect.top;
  const { x, y, scale } = state.draw;
  return {
    x: (cx - x) / scale,
    y: (cy - y) / scale,
  };
}

function pickAssetAt(imageX, imageY) {
  const found = [...state.groups]
    .reverse()
    .find(
      (asset) =>
        imageX >= asset.minX &&
        imageX <= asset.maxX &&
        imageY >= asset.minY &&
        imageY <= asset.maxY,
    );
  if (found) selectAsset(found.id);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadText(text, filename, type = "image/svg+xml;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), filename);
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function canvasToPngBytes(canvas) {
  const blob = await canvasToPngBlob(canvas);
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

async function downloadPng(asset) {
  const canvas = makeAssetCanvas(asset);
  const blob = await canvasToPngBlob(canvas);
  if (blob) downloadBlob(blob, `${getAssetName(asset)}.png`);
}

function getAssetById(id) {
  return state.groups.find((asset) => asset.id === id);
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const crcTable = buildCrcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function writeHeader(view, values) {
  let offset = 0;
  for (const [bytes, value] of values) {
    if (bytes === 2) {
      view.setUint16(offset, value, true);
    } else {
      view.setUint32(offset, value, true);
    }
    offset += bytes;
  }
}

function makeZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(dataBytes);
    const localHeader = new ArrayBuffer(30);
    writeHeader(new DataView(localHeader), [
      [4, 0x04034b50],
      [2, 20],
      [2, 0x0800],
      [2, 0],
      [2, time],
      [2, day],
      [4, crc],
      [4, dataBytes.length],
      [4, dataBytes.length],
      [2, nameBytes.length],
      [2, 0],
    ]);
    localParts.push(localHeader, nameBytes, dataBytes);

    const centralHeader = new ArrayBuffer(46);
    writeHeader(new DataView(centralHeader), [
      [4, 0x02014b50],
      [2, 20],
      [2, 20],
      [2, 0x0800],
      [2, 0],
      [2, time],
      [2, day],
      [4, crc],
      [4, dataBytes.length],
      [4, dataBytes.length],
      [2, nameBytes.length],
      [2, 0],
      [2, 0],
      [2, 0],
      [2, 0],
      [4, 0],
      [4, offset],
    ]);
    centralParts.push(centralHeader, nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  const end = new ArrayBuffer(22);
  writeHeader(new DataView(end), [
    [4, 0x06054b50],
    [2, 0],
    [2, 0],
    [2, files.length],
    [2, files.length],
    [4, centralSize],
    [4, offset],
    [2, 0],
  ]);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

async function downloadZip() {
  if (!state.groups.length) return;
  ui.zipBtn.disabled = true;
  setStatus("正在打包 PNG...");
  try {
    const files = await Promise.all(
      state.groups.map(async (asset) => ({
        name: `${getAssetName(asset)}.png`,
        content: await canvasToPngBytes(makeAssetCanvas(asset)),
      })),
    );
    const zip = makeZip(files);
    const base = state.imageName.replace(/\.[^.]+$/, "") || "assets";
    downloadBlob(zip, `${base}-png-assets.zip`);
    setStatus(`已打包 ${files.length} 个 PNG`);
  } catch {
    setStatus("PNG 打包失败");
  } finally {
    ui.zipBtn.disabled = state.groups.length === 0;
  }
}

let analyzeTimer = 0;
let renderTimer = 0;

function scheduleAnalyze() {
  window.clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(() => analyzeImage(), 180);
}

function scheduleRenderAssets() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderPreview();
    renderAssets();
  }, 120);
}

function resetAll() {
  state.image = null;
  state.imageName = "";
  state.imageData = null;
  state.processedImageData = null;
  state.bgMask = null;
  state.labels = null;
  state.components = [];
  state.groups = [];
  state.selectedId = null;
  ui.assetList.textContent = "";
  ui.imageMeta.textContent = "等待载入图片";
  ui.assetCount.textContent = "0";
  ui.processTime.textContent = "0 ms";
  updateSplitButton();
  ui.zipBtn.disabled = true;
  ui.selectedText.textContent = "未选择素材";
  setStatus("准备就绪");
  renderPreview();
}

function bindEvents() {
  ui.fileInput.addEventListener("change", async () => {
    const file = ui.fileInput.files?.[0];
    if (!file) return;
    setStatus("载入图片...");
    const result = await fileToImage(file);
    await useImage(result.image, result.name);
    ui.fileInput.value = "";
  });

  ui.sampleBtn.addEventListener("click", () => {
    loadSample().catch((error) => setStatus(error.message));
  });
  ui.analyzeBtn.addEventListener("click", () => analyzeImage());
  ui.splitBtn.addEventListener("click", splitSelectedAsset);
  ui.zipBtn.addEventListener("click", downloadZip);
  ui.clearBtn.addEventListener("click", resetAll);

  ui.pickBgBtn.addEventListener("click", () => {
    if (!state.image) return;
    state.pickingBg = !state.pickingBg;
    ui.dropZone.classList.toggle("is-picking", state.pickingBg);
    setStatus(state.pickingBg ? "点击画布取背景色" : "准备就绪");
  });

  ui.removeEnclosed.addEventListener("change", () => {
    updateControlText();
    scheduleAnalyze();
  });

  for (const [key, input] of Object.entries(ui.controls)) {
    input.addEventListener("input", () => {
      updateControlText();
      if (["tolerance", "edgeTrim", "innerStroke", "mergeGap", "minArea"].includes(key)) {
        scheduleAnalyze();
      } else {
        scheduleRenderAssets();
      }
    });
  }

  ui.exportMode.addEventListener("change", () => {
    setStatus(ui.exportMode.value === "silhouette" ? "导出模式: 纯剪影" : "导出模式: 保留颜色");
  });

  ui.previewCanvas.addEventListener("click", async (event) => {
    if (!state.image) return;
    const point = pointToImage(event);
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= sourceCanvas.width ||
      point.y >= sourceCanvas.height
    ) {
      return;
    }
    if (state.pickingBg) {
      state.bgColor = samplePixelColor(point.x, point.y);
      state.pickingBg = false;
      ui.dropZone.classList.remove("is-picking");
      updateBgUi();
      await analyzeImage();
      return;
    }
    pickAssetAt(point.x, point.y);
  });

  ui.assetList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (button) {
      const asset = getAssetById(Number(button.dataset.id));
      if (!asset) return;
      if (button.dataset.action === "svg") {
        downloadText(makeSvgString(asset), `${getAssetName(asset)}.svg`);
      } else {
        downloadPng(asset);
      }
      return;
    }
    const card = event.target.closest(".asset-card");
    if (card) selectAsset(Number(card.dataset.assetId));
  });

  ui.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    ui.dropZone.classList.add("is-picking");
  });

  ui.dropZone.addEventListener("dragleave", () => {
    if (!state.pickingBg) ui.dropZone.classList.remove("is-picking");
  });

  ui.dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (!state.pickingBg) ui.dropZone.classList.remove("is-picking");
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const result = await fileToImage(file);
    await useImage(result.image, result.name);
  });

  const resizeObserver = new ResizeObserver(() => renderPreview());
  resizeObserver.observe(ui.dropZone);
}

updateControlText();
updateBgUi();
bindEvents();
window.lucide?.createIcons();
window.AssetVectorizer = {
  stats: () => ({
    count: state.groups.length,
    imageName: state.imageName,
    selectedId: state.selectedId,
    parts: state.groups.map((asset) => asset.partCount),
  }),
  splitSelected: splitSelectedAsset,
  makeSvg: (id) => {
    const asset = getAssetById(Number(id));
    return asset ? makeSvgString(asset) : "";
  },
};
resetAll();
