export const palette = $state({ open: false });
export const openPalette = (): void => { palette.open = true; };
export const closePalette = (): void => { palette.open = false; };
