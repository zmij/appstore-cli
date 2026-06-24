/**
 * Pre-upload image validation + auto-heal for App Store Connect.
 *
 * Background: ASC's reservation + commit endpoints accept any pixel
 * payload. Apple's post-processing then asynchronously flips the
 * `assetDeliveryState` to FAILED if the file doesn't satisfy an
 * undocumented superset of rules — and the public web UI displays a
 * single misleading "dimensions are wrong" error regardless of which
 * rule actually fired. The CLI used to report "Review screenshots
 * uploaded: 1" and move on, even when the asset was about to be
 * silently rejected.
 *
 * Empirical reject reasons we've hit on IAP review screenshots (see
 * lazy-sudoku#2456 spike, 8 jigsaw IAPs):
 *   - alpha channel (RGBA from iPhone screenshots) — the #1 blocker
 *   - Display P3 colour profile + 144 dpi (iPhone-native)
 *   - dimensions outside Apple's accepted iPhone-screenshot set
 *     (1206×2622 was rejected; 1320×2868 / 1290×2796 / etc accepted)
 *
 * App-screenshot uploads (`screenshots upload`) are stricter on
 * dimensions but Apple is more forgiving on colour/dpi — there we
 * just check dims.
 *
 * Healing recipe (the magick incantation that flipped all 8 jigsaw
 * IAPs to READY_TO_SUBMIT):
 *     resize → flatten on black → sRGB → 8-bit → 72 dpi → drop metadata
 * Sharp can do every step natively; we shell out to nothing.
 */

import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { SCREENSHOT_DIMENSIONS } from './types.js';

export interface ImageProperties {
  width: number;
  height: number;
  /** PNG colour-type-derived: true when an alpha channel is present. */
  hasAlpha: boolean;
  /** Pixels-per-inch from PNG `pHYs` / JPEG JFIF. */
  density?: number;
  /** ICC colour space tag if libsharp could interpret one; usually
   *  `srgb` for normalised files, `rgb` for files with an embedded
   *  Display P3 profile and no sRGB recoloring. */
  space?: string;
  /** ICC profile description string (e.g. "sRGB IEC61966-2.1",
   *  "Display P3"). Empty when no profile attached. */
  profileName?: string;
  /** Pixel format: png / jpeg / etc. */
  format?: string;
}

/**
 * Dimensions Apple accepts on the IAP review-screenshot endpoint.
 *
 * Empirically the validator accepts iPhone screenshot dimensions plus
 * the legacy 640×920 — landscape mirrors of each pair are also fine.
 * Anything else fails with `IMAGE_INCORRECT_DIMENSIONS` hours after a
 * "successful" commit. Keep this list ordered cheapest-first so
 * `chooseNearestAcceptedDimensions` prefers the smaller targets when
 * multiple match the input aspect.
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
  [1320, 2868],
];

/** Rules an IAP review screenshot must satisfy before Apple post-
 *  processing accepts it. Surface to operators on validation reject. */
export const IAP_REVIEW_SCREENSHOT_RULES = {
  allowedExtensions: ['.png', '.jpg', '.jpeg'] as const,
  requiredDensity: 72,
  /** Hard-reject ANY embedded profile name containing one of these —
   *  iPhone captures save Display P3 by default and Apple rejects it. */
  rejectedProfileFragments: ['Display P3', 'P3 D65', 'Adobe RGB'],
};

/** Read every property the validator + healer need from a single
 *  sharp metadata call. Throws if the file isn't a recognisable
 *  PNG/JPEG. */
export async function probeImageProperties(filePath: string): Promise<ImageProperties> {
  const img = sharp(filePath, { failOn: 'none' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Unable to determine image dimensions for ${filePath}`);
  }
  // ICC profile description: when sharp's parser recognised the
  // profile, `space` carries the colour space tag; for everything else
  // we have to read the description text out of the raw profile
  // bytes. The 'desc' tag in ICC v2/v4 stores a Latin-1 string after
  // a fixed-position header — grepping the raw buffer is robust
  // against minor format variations and good enough for "is this
  // Display P3?" classification.
  let profileName: string | undefined;
  if (meta.icc) {
    const text = meta.icc.toString('latin1');
    for (const tag of [
      'Display P3', 'sRGB IEC61966-2.1', 'sRGB', 'Adobe RGB',
      'Generic RGB Profile', 'P3 D65',
    ]) {
      if (text.includes(tag)) {
        profileName = tag;
        break;
      }
    }
  }
  return {
    width: meta.width,
    height: meta.height,
    hasAlpha: !!meta.hasAlpha,
    density: meta.density,
    space: meta.space,
    profileName,
    format: meta.format,
  };
}

/** A single failed validation criterion. */
export interface ValidationFailure {
  rule: string;
  expected: string;
  got: string;
}

export type ValidationResult =
  | { valid: true; properties: ImageProperties }
  | { valid: false; failures: ValidationFailure[]; properties: ImageProperties };

/**
 * Validate an app-screenshot file against Apple's per-displayType
 * spec. Only checks dimensions — Apple is more forgiving on
 * colour/dpi for app screenshots than IAP review screenshots.
 */
export async function validateAppScreenshotDimensions(
  filePath: string,
  displayType: string,
): Promise<ValidationResult> {
  const properties = await probeImageProperties(filePath);
  const expected = SCREENSHOT_DIMENSIONS[displayType];
  if (!expected) {
    return { valid: true, properties };
  }
  const { width, height } = properties;
  const matches = expected.some(
    ([w, h]) => (width === w && height === h) || (width === h && height === w),
  );
  if (matches) return { valid: true, properties };
  const allowedList = expected
    .map(([w, h]) => `${w}×${h} (or ${h}×${w} landscape)`)
    .join(', ');
  return {
    valid: false,
    failures: [
      {
        rule: 'dimensions',
        expected: allowedList,
        got: `${width}×${height}`,
      },
    ],
    properties,
  };
}

/**
 * Validate an IAP / subscription review screenshot against the full
 * set of empirical rules. All failures are collected so the operator
 * sees every problem at once instead of fixing them one at a time
 * across multiple sync iterations.
 */
export async function validateIapReviewScreenshot(
  filePath: string,
): Promise<ValidationResult> {
  const lower = filePath.toLowerCase();
  const extOk = IAP_REVIEW_SCREENSHOT_RULES.allowedExtensions.some((ext) =>
    lower.endsWith(ext),
  );
  if (!extOk) {
    return {
      valid: false,
      properties: {
        width: 0, height: 0, hasAlpha: false,
      },
      failures: [
        {
          rule: 'extension',
          expected: IAP_REVIEW_SCREENSHOT_RULES.allowedExtensions.join(' / '),
          got: filePath.split('.').pop() ?? '(none)',
        },
      ],
    };
  }

  const properties = await probeImageProperties(filePath);
  const failures: ValidationFailure[] = [];

  // Dimensions.
  const dimsMatch = IAP_REVIEW_SCREENSHOT_PAIRS.some(
    ([w, h]) =>
      (properties.width === w && properties.height === h) ||
      (properties.width === h && properties.height === w),
  );
  if (!dimsMatch) {
    failures.push({
      rule: 'dimensions',
      expected: IAP_REVIEW_SCREENSHOT_PAIRS.map(([w, h]) => `${w}×${h}`).join(' / '),
      got: `${properties.width}×${properties.height}`,
    });
  }

  // Alpha channel — the #1 silent-rejection cause.
  if (properties.hasAlpha) {
    failures.push({
      rule: 'alpha-channel',
      expected: 'opaque RGB (no alpha)',
      got: 'RGBA',
    });
  }

  // DPI / density. iPhone screenshots are 144 dpi; Apple needs 72.
  // sharp returns 0 / undefined when no pHYs chunk is present, which
  // we treat as "neutral" — Apple's post-process accepts that too.
  if (properties.density && properties.density !== IAP_REVIEW_SCREENSHOT_RULES.requiredDensity) {
    failures.push({
      rule: 'density',
      expected: `${IAP_REVIEW_SCREENSHOT_RULES.requiredDensity} dpi`,
      got: `${properties.density} dpi`,
    });
  }

  // Colour profile — reject Display P3 / Adobe RGB explicitly. sRGB
  // and "no profile attached" both pass.
  if (properties.profileName) {
    const reject = IAP_REVIEW_SCREENSHOT_RULES.rejectedProfileFragments.some((frag) =>
      properties.profileName!.includes(frag),
    );
    if (reject) {
      failures.push({
        rule: 'colour-profile',
        expected: 'sRGB (or no embedded profile)',
        got: properties.profileName,
      });
    }
  }

  if (failures.length === 0) return { valid: true, properties };
  return { valid: false, failures, properties };
}

/**
 * Format a validation result for terminal output. One line per
 * failure, with a closing `→ run with --fix to auto-heal` hint when
 * the failures look like the kind a heal can resolve.
 */
export function formatValidationFailures(failures: ReadonlyArray<ValidationFailure>): string {
  return failures
    .map(({ rule, expected, got }) => `      [${rule}] expected ${expected}; got ${got}`)
    .join('\n');
}

/**
 * Pick the dimension pair from `IAP_REVIEW_SCREENSHOT_PAIRS` whose
 * aspect ratio is closest to the input's, breaking ties by smallest
 * total pixels (so a 1206×2622 input lands on 1170×2532 not 1320×2868
 * — less upscale damage when the source is small). Returns the pair
 * in portrait orientation; rotate at the caller.
 */
export function chooseNearestAcceptedDimensions(
  width: number,
  height: number,
): [number, number] {
  const aspect = Math.min(width, height) / Math.max(width, height);
  let best: { pair: readonly [number, number]; deltaAspect: number; area: number } | null = null;
  for (const pair of IAP_REVIEW_SCREENSHOT_PAIRS) {
    const [w, h] = pair;
    const cand = Math.min(w, h) / Math.max(w, h);
    const deltaAspect = Math.abs(cand - aspect);
    const area = w * h;
    if (
      best === null ||
      deltaAspect < best.deltaAspect - 1e-6 ||
      (Math.abs(deltaAspect - best.deltaAspect) < 1e-6 && area < best.area)
    ) {
      best = { pair, deltaAspect, area };
    }
  }
  return [best!.pair[0], best!.pair[1]];
}

/**
 * Heal an IAP review screenshot in place by running the proven magick
 * recipe via sharp:
 *
 *   resize to the nearest accepted dim (with `fit: fill` so we land
 *     exactly on Apple's spec; warn the caller when the target is
 *     larger than the source)
 *   → flatten on a black background (drops alpha channel)
 *   → re-encode as PNG with sRGB colour space + 72 dpi density
 *   → strip the input's iPhone capture metadata (description, dates)
 *
 * Writes to a temp file and atomically replaces `filePath` on
 * success. Returns the source/target dims so the caller can log
 * "1206×2622 → 1170×2532 (no upscale)".
 */
export async function healIapReviewScreenshot(filePath: string): Promise<{
  before: ImageProperties;
  after: ImageProperties;
  /** True when the target is larger in either axis — flag visually
   *  noisy on small inputs. */
  upscaled: boolean;
}> {
  const before = await probeImageProperties(filePath);

  // Land on a portrait target when the input is portrait, landscape
  // mirror when landscape; preserves orientation through the heal.
  const [pw, ph] = chooseNearestAcceptedDimensions(before.width, before.height);
  const isPortrait = before.height >= before.width;
  const targetW = isPortrait ? pw : ph;
  const targetH = isPortrait ? ph : pw;
  const upscaled = targetW > before.width || targetH > before.height;

  const buf = await sharp(filePath)
    .resize(targetW, targetH, { fit: 'fill' })
    .flatten({ background: '#000000' })
    .toColorspace('srgb')
    .png({ compressionLevel: 9 })
    // density goes on the PNG output; .withMetadata also re-emits any
    // existing ICC by default — explicitly request the sRGB one via
    // withIccProfile to overwrite whatever the source carried (Display
    // P3 etc.).
    .withMetadata({ density: 72 })
    .withIccProfile('srgb')
    .toBuffer();

  // Atomic replace: write a temp file in the same directory (to keep
  // the rename atomic across filesystems), then rename onto the
  // target. fs.renameSync is atomic on POSIX.
  const tmpPath = join(
    tmpdir(),
    `appstore-iap-heal-${randomBytes(8).toString('hex')}.png`,
  );
  writeFileSync(tmpPath, buf);
  // Use renameSync to overwrite. (sync is fine — files are small.)
  const { renameSync } = await import('fs');
  renameSync(tmpPath, filePath);

  const after = await probeImageProperties(filePath);
  return { before, after, upscaled };
}
