/**
 * RAGOT Lab Utilities
 * Offline-safe helpers so the lab works without a network connection.
 */

const PALETTE = [
    '#f05454', '#c94040',  // reds
    '#2d3250', '#424874',  // blues
    '#4caf50', '#388e3c',  // greens
    '#ff9800', '#f57c00',  // oranges
    '#9c27b0', '#7b1fa2',  // purples
];

/**
 * Generate an inline SVG data-URI placeholder image.
 * Requires no network and renders immediately.
 *
 * @param {number} index   - Used to pick a deterministic color from the palette
 * @param {string} label   - Short text to render in the center (e.g. "#5")
 * @param {number} [w=320] - Width
 * @param {number} [h=180] - Height
 * @returns {string} data:image/svg+xml;... URI
 */
export function makePlaceholderSrc(index, label = '', w = 320, h = 180) {
    const bg = PALETTE[(index * 2) % PALETTE.length];
    const fg = PALETTE[(index * 2 + 1) % PALETTE.length];
    const txt = label || `#${index}`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <rect x="0" y="${h - 4}" width="${w}" height="4" fill="${fg}"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="ui-monospace,monospace" font-size="22" font-weight="bold"
        fill="rgba(255,255,255,0.85)">${txt}</text>
</svg>`;

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Returns a remote URL with the given index as fallback to local SVG placeholder.
 * The img element's onerror swaps in the placeholder if the network request fails.
 *
 * Usage in createElement:
 *   createElement('img', { src: remoteWithFallback(i), onError: swapToPlaceholder(i) })
 */
export function remoteWithFallback(index, remoteUrl) {
    return remoteUrl || makePlaceholderSrc(index);
}

export function onImgError(index) {
    return function (e) {
        e.target.src = makePlaceholderSrc(index);
        e.target.onerror = null; // prevent infinite loop
    };
}
