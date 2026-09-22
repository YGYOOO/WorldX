const ICONS = {
  "download": [
    '<path d="M12 3v12"/>',
    '<path d="m7.5 10.5 4.5 4.5 4.5-4.5"/>',
    '<path d="M5 20h14"/>',
  ],
  "file-code-2": [
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>',
    '<path d="M14 2v6h6"/>',
    '<path d="m10 13-2 2 2 2"/>',
    '<path d="m14 17 2-2-2-2"/>',
  ],
  "file-image": [
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>',
    '<path d="M14 2v6h6"/>',
    '<path d="m9 18 2.5-3 2 2.2 1.5-1.7L18 18z"/>',
    '<circle cx="9" cy="12" r="1.2"/>',
  ],
  "image": [
    '<rect x="3" y="5" width="18" height="14" rx="2"/>',
    '<path d="m6 16 4.2-4.2 3.2 3.2 1.8-1.8L19 17"/>',
    '<circle cx="8.5" cy="9.5" r="1.4"/>',
  ],
  "image-plus": [
    '<rect x="3" y="5" width="18" height="14" rx="2"/>',
    '<path d="m6 16 4.2-4.2 3.2 3.2 1.8-1.8L19 17"/>',
    '<path d="M16 8h4"/>',
    '<path d="M18 6v4"/>',
  ],
  "pipette": [
    '<path d="m14 5 5 5"/>',
    '<path d="M11 8 5 14l5 5 6-6"/>',
    '<path d="M14 5 19 0l5 5-5 5"/>',
    '<path d="M4 20h6"/>',
  ],
  "scan-line": [
    '<path d="M4 7V5a1 1 0 0 1 1-1h3"/>',
    '<path d="M16 4h3a1 1 0 0 1 1 1v2"/>',
    '<path d="M20 17v2a1 1 0 0 1-1 1h-3"/>',
    '<path d="M8 20H5a1 1 0 0 1-1-1v-2"/>',
    '<path d="M6 12h12"/>',
  ],
  "sparkles": [
    '<path d="M12 3 10.4 8.4 5 10l5.4 1.6L12 17l1.6-5.4L19 10l-5.4-1.6z"/>',
    '<path d="M19 15.5 18.2 18 16 18.8l2.2.7.8 2.5.8-2.5 2.2-.7-2.2-.8z"/>',
  ],
  "trash-2": [
    '<path d="M3 6h18"/>',
    '<path d="M8 6V4h8v2"/>',
    '<path d="M6 6l1 15h10l1-15"/>',
    '<path d="M10 11v6"/>',
    '<path d="M14 11v6"/>',
  ],
  "ungroup": [
    '<rect width="8" height="8" x="3" y="3" rx="2"/>',
    '<rect width="8" height="8" x="13" y="13" rx="2"/>',
    '<path d="M11 7h2a4 4 0 0 1 4 4v2"/>',
    '<path d="m8 15-2 2 2 2"/>',
    '<path d="M6 17h7"/>',
  ],
};

function createIcon(name) {
  const paths = ICONS[name] || ICONS.image;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("lucide", `lucide-${name}`);
  svg.innerHTML = paths.join("");
  return svg;
}

window.lucide = {
  createIcons() {
    document.querySelectorAll("i[data-lucide]").forEach((placeholder) => {
      const name = placeholder.dataset.lucide;
      placeholder.replaceWith(createIcon(name));
    });
  },
};
