/**
 * albumGeometry.ts — Coordinate geometry helpers for Libro Álbum
 *
 * ══════════════════════════════════════════════════════════════════
 * COORDINATE CONTRACT (applies to the entire album system)
 * ══════════════════════════════════════════════════════════════════
 *
 * All AlbumRegion coordinates (x, y, width, height) are expressed as
 * PERCENTAGES OF THE RENDERED IMAGE CONTENT AREA — not the container,
 * not the viewport, not the flex wrapper.
 *
 *   0%,  0%  = top-left corner of the visible image pixels
 *   100%, 100% = bottom-right corner of the visible image pixels
 *
 * This rule must be obeyed by:
 *   - SubirContenido (editor drag/drop and overlay positioning)
 *   - VisorAlbum (zoom transform, hit detection)
 *   - getObjectContainRect / viewportToImagePercent (this file)
 *   - Any future geometry consumer
 *
 * ══════════════════════════════════════════════════════════════════
 * WHY getObjectContainRect IS NEEDED
 * ══════════════════════════════════════════════════════════════════
 *
 * When an <img> uses object-fit: contain inside a fixed-size flex container,
 * the browser may add letterbox bars (empty space) around the image content.
 * getBoundingClientRect() on the element returns the *element box*, which
 * includes those bars. Clicks derived from the element box would be wrong.
 *
 * getObjectContainRect corrects this by computing the actual rendered image
 * sub-rect. It works through CSS transforms on parent elements because
 * getBoundingClientRect() always returns post-transform viewport coordinates.
 *
 * NOTE: If the <img> element uses max-w-full max-h-full (no explicit fixed
 * dimensions), the browser sizes the element to fit the image content exactly —
 * there is no letterboxing within the element itself. In that case,
 * getObjectContainRect returns the element rect unchanged and translate(x%, y%)
 * on the img element is naturally in image-coordinate space.
 */

import type { AlbumRegion } from '../types';

// ── Core geometry ─────────────────────────────────────────────────────────────

/**
 * Returns the actual rendered bounds of an <img> element with object-fit: contain.
 *
 * object-fit: contain scales the image uniformly to fit within the element box,
 * centering it. The element box does not shrink — only the image content is
 * repositioned inside it. This function computes the content sub-rect.
 *
 * Falls back to the element rect if naturalWidth/naturalHeight are unavailable
 * (image not yet loaded), so callers never receive a zero-size rect.
 *
 * @param img  The HTMLImageElement carrying object-fit: contain
 * @returns    DOMRect of the actual image content, in viewport coordinates
 */
export function getObjectContainRect(img: HTMLImageElement): DOMRect {
    const elRect = img.getBoundingClientRect();
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;

    // Image not loaded yet, or element has zero size — nothing to compute
    if (!nw || !nh || !elRect.width || !elRect.height) return elRect;

    const elW = elRect.width;
    const elH = elRect.height;
    const imageAspect   = nw / nh;
    const elementAspect = elW / elH;

    let renderedW: number;
    let renderedH: number;

    if (imageAspect > elementAspect) {
        // Image is wider relative to the element.
        // Width fills the element; height is shorter → letterbox top & bottom.
        renderedW = elW;
        renderedH = elW / imageAspect;
    } else {
        // Image is taller relative to the element.
        // Height fills the element; width is narrower → letterbox left & right.
        renderedH = elH;
        renderedW = elH * imageAspect;
    }

    // Center the rendered image within the element box (same as object-position: center)
    const offsetX = (elW - renderedW) / 2;
    const offsetY = (elH - renderedH) / 2;

    return new DOMRect(
        elRect.left + offsetX,
        elRect.top  + offsetY,
        renderedW,
        renderedH,
    );
}

// ── Coordinate conversion ─────────────────────────────────────────────────────

/**
 * Converts a viewport click position to image-relative percentage coordinates
 * (0–100 on each axis), using the actual image content rect produced by
 * getObjectContainRect.
 *
 * Returns null when the click falls outside the image area (e.g., on a letterbox
 * bar). Callers should treat null as a miss — a click on empty space around the
 * image should never match any region.
 *
 * @param clientX    e.clientX from the click event
 * @param clientY    e.clientY from the click event
 * @param imageRect  Result of getObjectContainRect for the target image
 */
export function viewportToImagePercent(
    clientX: number,
    clientY: number,
    imageRect: DOMRect,
): { x: number; y: number } | null {
    const x = ((clientX - imageRect.left) / imageRect.width)  * 100;
    const y = ((clientY - imageRect.top)  / imageRect.height) * 100;

    // Outside image content — treat as miss
    if (x < 0 || x > 100 || y < 0 || y > 100) return null;
    return { x, y };
}

// ── Region hit test ───────────────────────────────────────────────────────────

/**
 * Tests whether a point in image-relative coordinates (0–100) falls within an
 * AlbumRegion's axis-aligned bounding box.
 *
 * All values share the same coordinate space: 0 = left/top edge of the image,
 * 100 = right/bottom edge.
 *
 * @param x       Horizontal image-percent (from viewportToImagePercent)
 * @param y       Vertical image-percent
 * @param region  Region whose bounding box is tested
 */
export function isPointInRegion(
    x: number,
    y: number,
    region: Pick<AlbumRegion, 'x' | 'y' | 'width' | 'height'>,
): boolean {
    return (
        x >= region.x &&
        x <= region.x + region.width &&
        y >= region.y &&
        y <= region.y + region.height
    );
}
