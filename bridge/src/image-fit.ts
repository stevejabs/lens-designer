// image-fit.ts — pure fit/alignment math for the Image primitive.
//
// Computes the texture-UV transform (scale + offset) the RoundedRect
// shader applies as `texUV = uv * texScale + texOffset` before sampling
// baseTex. Keeping this in TypeScript (vs the shader) means the fit logic
// is unit-testable and the shader stays a one-liner.
//
// Conventions:
//   - aspect = width / height.
//   - align is 0 | 0.5 | 1 per axis (start / center / end). For Y, 0 is
//     the TOP per the inspector's 9-point grid. LS's surface-UV V origin is
//     the BOTTOM (verified on-device 2026-05-24), so the applier passes
//     (1 - alignY) here — see computeImageOverrides in applier.ts. X matches.
//   - The shader gates sample alpha to texUV ∈ [0,1] so 'fit' letterbox
//     bars render transparent. 'fill' and 'stretch' keep texUV in-bounds.

export type FitMode = 'stretch' | 'fit' | 'fill';

export interface TexTransform {
  scale: { x: number; y: number };
  offset: { x: number; y: number };
}

/**
 * @param fit       stretch (distort), fit (contain), or fill (cover)
 * @param alignX    0=left, 0.5=center, 1=right
 * @param alignY    0=top,  0.5=center, 1=bottom
 * @param imgAspect image width/height
 * @param boxAspect quad width/height
 */
export function computeTexTransform(
  fit: FitMode,
  alignX: number,
  alignY: number,
  imgAspect: number,
  boxAspect: number,
): TexTransform {
  // Stretch (or a degenerate aspect) → identity: image distorts to box.
  if (fit === 'stretch' || !Number.isFinite(imgAspect) || imgAspect <= 0
    || !Number.isFinite(boxAspect) || boxAspect <= 0) {
    return { scale: { x: 1, y: 1 }, offset: { x: 0, y: 0 } };
  }

  let sx = 1;
  let sy = 1;

  if (fit === 'fit') {
    // contain: image fully visible, letterbox the longer axis by scaling
    // box-UV UP past [0,1] there (shader gates those samples transparent).
    if (imgAspect >= boxAspect) {
      sy = imgAspect / boxAspect; // image relatively wider → bars top/bottom
    } else {
      sx = boxAspect / imgAspect; // image relatively taller → bars left/right
    }
  } else {
    // fill / cover: image covers box, crop the overflow by scaling box-UV
    // DOWN within [0,1] on the cropped axis.
    if (imgAspect >= boxAspect) {
      sx = boxAspect / imgAspect; // crop left/right
    } else {
      sy = imgAspect / boxAspect; // crop top/bottom
    }
  }

  // offset places the visible window per alignment: uv*scale+offset maps
  // the chosen anchor to the image edge. align*(1-scale) gives start at
  // align=0, centered at 0.5, end at 1 — for both scale>1 (fit) and <1 (fill).
  return {
    scale: { x: sx, y: sy },
    offset: { x: alignX * (1 - sx), y: alignY * (1 - sy) },
  };
}

/** Map a 9-point alignment label → {x, y} in {0, 0.5, 1}. */
export const ALIGN_9: Record<string, { x: number; y: number }> = {
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'center-left': { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  'center-right': { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};
