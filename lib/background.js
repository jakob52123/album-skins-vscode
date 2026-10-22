'use strict';

const DEFAULT_OPACITY = Object.freeze({ dark: 0.30, light: 0.22 });
const MIN_OPACITY = 0.05;
const MAX_OPACITY = 0.6;

function clampOpacity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, value));
}

/** Theme override > shared value > theme default. Invalid values derive like null. */
function resolveBackgroundOpacity(settings = {}) {
  const shared = clampOpacity(settings.backgroundOpacity);
  return Object.fromEntries(['dark', 'light'].map((mode) => [mode,
    clampOpacity(settings[mode === 'dark' ? 'backgroundOpacityDark' : 'backgroundOpacityLight'])
      ?? shared ?? DEFAULT_OPACITY[mode],
  ]));
}

module.exports = { resolveBackgroundOpacity, clampOpacity };
