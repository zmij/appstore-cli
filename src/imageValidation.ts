/**
 * Pre-upload image dimension validation.
 *
 * App Store Connect silently rejects screenshots whose pixel dimensions
 * don't match Apple's per-device-class spec — the asset is reserved,
 * committed (`assetDeliveryState=UPLOADED`), and then Apple's
 * post-processing flips it to `FAILED` without surfacing why through
 * the JSON API. The CLI looked successful, the screenshot vanished from
 * the listing, the operator only noticed days later.
 *
 * This module reads each candidate file's PNG / JPEG header (no decode
 * — `image-size` parses ~16 bytes) and rejects locally before reserving
 * the asset, with a clear error pointing at the accepted dimension
 * pairs.
 *
 * Sources of truth:
 *  - `SCREENSHOT_DIMENSIONS` (app store listings, per displayType)
 *    from `types.ts`.
 *  - `IAP_REVIEW_SCREENSHOT_LIMITS` below (looser — Apple only requires
 *    a sensible bound, not exact device-class dimensions).
 */

import { readFileSync } from 'fs';
import { imageSize } from 'image-size';
import { SCREENSHOT_DIMENSIONS } from './types.js';

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Apple-accepted dimensions for IAP / subscription review screenshots.
 *
 * Empirically Apple's API rejects any size that doesn't match one of
 * these portrait pairs with `assetDeliveryState.errors[0].code =
 * IMAGE_INCORRECT_DIMENSIONS` (the asset commits, then fails — silent
 * from the operator's POV). The list is the union of:
 *   - the historic 640×920 legacy screenshot
 *   - every iPhone screenshot dimension from `SCREENSHOT_DIMENSIONS`
 *     (Apple accepts any of them; modern submissions usually use the
 *     latest iPhone spec)
 *   - the legacy 5.5" / 4.7" pairs that are still allowed for review
 *     screenshots even though they're retired from app-screenshot
 *     listings.
 *
 * Landscape mirrors of each pair are also accepted.
 */
export const IAP_REVIEW_SCREENSHOT_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [640, 920],
  [750, 1334],
  [1242, 2208],
  [1170, 2532],
  [1179, 2556],
  [1242, 2688],
  [1260, 2736],
  [1284, 2778],
  [1290, 2796],
];

export const IAP_REVIEW_SCREENSHOT_LIMITS = {
  /** PNG / JPEG only — Apple silently drops anything else. */
  allowedExtensions: ['.png', '.jpg', '.jpeg'] as const,
};

/** Pull just the (width, height) from an image file. Throws on
 *  unreadable / unrecognised files; never decodes pixels. */
export function probeImageDimensions(filePath: string): ImageDimensions {
  const bytes = readFileSync(filePath);
  const dims = imageSize(bytes);
  if (!dims.width || !dims.height) {
    throw new Error(`Unable to determine image dimensions for ${filePath}`);
  }
  return { width: dims.width, height: dims.height };
}

/**
 * Validate an app-screenshot file against Apple's per-displayType spec.
 *
 * Apple accepts portrait (w, h) or its landscape mirror (h, w) for each
 * pair listed in `SCREENSHOT_DIMENSIONS`. Returns `{ valid: true }` on
 * a match; otherwise an error message describing what was found vs.
 * what was expected.
 *
 * When the displayType has no entry in the table, validation degrades
 * to "always pass" — better than blocking an upload because we don't
 * have a spec entry yet for a new device class Apple adds.
 */
export function validateAppScreenshotDimensions(
  filePath: string,
  displayType: string,
): { valid: true } | { valid: false; reason: string } {
  const expected = SCREENSHOT_DIMENSIONS[displayType];
  if (!expected) {
    return { valid: true };
  }
  const { width, height } = probeImageDimensions(filePath);
  const matches = expected.some(
    ([w, h]) => (width === w && height === h) || (width === h && height === w),
  );
  if (matches) return { valid: true };
  const allowedList = expected
    .map(([w, h]) => `${w}×${h} (or ${h}×${w} landscape)`)
    .join(', ');
  return {
    valid: false,
    reason:
      `Got ${width}×${height}. Apple's spec for ${displayType} is one of: ${allowedList}. ` +
      `ASC silently rejects mismatched dimensions — the upload commits, then Apple's ` +
      `post-processing fails the asset and the screenshot never appears in the listing.`,
  };
}

/**
 * Validate an IAP / subscription review screenshot.
 *
 * Apple is less strict about review-screenshot dimensions than app
 * screenshots — a 1024×1024 PNG works fine — but it still drops files
 * that are too small (illegible to reviewers), too large (Apple's
 * post-process times out), or in an unsupported format.
 */
export function validateReviewScreenshotDimensions(
  filePath: string,
): { valid: true } | { valid: false; reason: string } {
  const lower = filePath.toLowerCase();
  const extOk = IAP_REVIEW_SCREENSHOT_LIMITS.allowedExtensions.some((ext) =>
    lower.endsWith(ext),
  );
  if (!extOk) {
    return {
      valid: false,
      reason:
        `Only ${IAP_REVIEW_SCREENSHOT_LIMITS.allowedExtensions.join(' / ')} accepted; got ${filePath}.`,
    };
  }

  const { width, height } = probeImageDimensions(filePath);
  const matches = IAP_REVIEW_SCREENSHOT_PAIRS.some(
    ([w, h]) => (width === w && height === h) || (width === h && height === w),
  );
  if (matches) return { valid: true };
  const allowedList = IAP_REVIEW_SCREENSHOT_PAIRS
    .map(([w, h]) => `${w}×${h}`)
    .join(', ');
  return {
    valid: false,
    reason:
      `Got ${width}×${height}. Apple's IAP review screenshot endpoint accepts only ` +
      `iPhone-screenshot dimensions or the legacy 640×920 pair (portrait or landscape mirror): ` +
      `${allowedList}. Anything else fails with assetDeliveryState.errors[0].code = ` +
      `IMAGE_INCORRECT_DIMENSIONS hours after the upload commits.`,
  };
}
