# Changelog

## 2.3.0

- Add a dedicated status bar toggle for discreet mode: $(eye) when off, $(eye-closed) when on; click to flip.
- The toggle stays visible even in discreet mode, so you can always switch back.
- Its status bar id is `albumSkins.toggle` (never matches the cover CSS gate), so covers stay hidden in discreet mode.

## 2.2.0

- Add shared and per-theme background opacity settings with validation and clamping (0.05–0.6).
- Increase default cover opacity to 0.30 for dark themes and 0.22 for light themes.
- Re-sync background configuration when opacity changes; background may still request Apply and Reload.
- Add current-theme opacity presets to the album quick pick.
- Document opacity inheritance and update the VSIX installation command.
