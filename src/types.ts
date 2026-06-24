/**
 * App Store Connect CLI Types
 */

// ============================================================================
// Authentication
// ============================================================================

export interface AuthKey {
  key_id: string;
  key_file: string;
}

export interface AppStoreConfig {
  issuer_id: string;
  app_id: string;
  keys: Record<string, AuthKey>;
  default_key: string;
}

// ============================================================================
// Metadata
// ============================================================================

export interface AppInfo {
  title: string;
  subtitle: string;
  promotional_text: string;
  description: string;
  keywords: string;
}

export interface ListingMetadata {
  whats_new: string;
  app_info: AppInfo;
}

export interface IAPLocalisation {
  display_name: string;
  description: string;
}

/**
 * Auto-equalised pricing. `base_territory` is an ISO3 code (e.g. "USA");
 * `base_price` is the customer-facing customer price in that territory's
 * currency (e.g. "4.99"). Apple computes every other territory's price
 * from the anchor.
 */
export interface IAPPrice {
  base_territory: string;
  base_price: string;
}

/**
 * Territory availability. `available_in_new_territories` is the auto-
 * rollout flag (true = whenever Apple opens a new market, the product is
 * available there by default). `territories` is the explicit list of ISO3
 * territory codes — or the literal string "all" as shorthand for "every
 * territory Apple supports today".
 */
export interface IAPAvailability {
  available_in_new_territories: boolean;
  territories: string[] | 'all';
}

export interface InAppPurchase {
  reference_name: string;
  /** Optional `type` + `family_sharable` are immutable on existing IAPs;
   *  the export emits them for round-trip clarity and Phase 5 `iap create`
   *  will require them. */
  type?: 'NON_CONSUMABLE' | 'CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION';
  family_sharable?: boolean;
  price?: IAPPrice;
  availability?: IAPAvailability;
  /** Local path to a PNG / JPEG that Apple Review uses to verify where
   *  this IAP appears in the app. Required for submission. Sync replaces
   *  any existing screenshot when the local file is set. */
  review_screenshot?: string;
  /** Free-text note Apple Review reads alongside the screenshot
   *  (e.g. "tap Settings → Pro → Unlock to reach this purchase").
   *  Synced via PATCH; can be set on create and updated on existing IAPs. */
  review_note?: string;
  localisations: Record<string, IAPLocalisation>;
}

/** A localised name for a subscription group (the family-of-tiers
 *  container). `custom_app_name` overrides how the app is referred to
 *  in the subscriptions sheet for that locale; optional. */
export interface SubscriptionGroupLocalisation {
  name: string;
  custom_app_name?: string;
}

/** A subscription group — declared once in `subscription_groups`,
 *  referenced by name from individual subscriptions. */
export interface SubscriptionGroup {
  reference_name: string;
  localisations?: Record<string, SubscriptionGroupLocalisation>;
}

/**
 * One subscription introductory offer.
 *
 * Modes:
 *   * FREE_TRIAL — N periods free. No `price` field needed.
 *   * PAY_AS_YOU_GO — discounted recurring price for N periods. `price`
 *     required.
 *   * PAY_UP_FRONT — one-time discounted price for N periods total.
 *     `price` required.
 *
 * `territory` scopes the offer to one ISO3 territory; omit for global.
 * `start_date` / `end_date` are optional ISO8601 dates (default = open-
 * ended).
 */
export interface IntroOffer {
  mode: 'FREE_TRIAL' | 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT';
  duration: 'THREE_DAYS' | 'ONE_WEEK' | 'TWO_WEEKS' | 'ONE_MONTH' | 'TWO_MONTHS' | 'THREE_MONTHS' | 'SIX_MONTHS' | 'ONE_YEAR';
  periods: number;
  /** Required for PAY_AS_YOU_GO / PAY_UP_FRONT; ignored for FREE_TRIAL. */
  price?: string;
  /** Optional: scope to a single ISO3 territory (omit for global). */
  territory?: string;
  start_date?: string;
  end_date?: string;
}

export interface Subscription {
  reference_name: string;
  /** Which subscription_groups entry this sub lives in. Required for
   *  create; on export filled in from the live group's referenceName. */
  group?: string;
  /** Subscription duration enum. Immutable on existing subscriptions;
   *  emitted by export and required for create. */
  subscription_period?: 'ONE_WEEK' | 'ONE_MONTH' | 'TWO_MONTHS' | 'THREE_MONTHS' | 'SIX_MONTHS' | 'ONE_YEAR';
  family_sharable?: boolean;
  /** Apple uses this to order tiers within a group for the upgrade UI;
   *  lower numbers are "higher" tiers. Optional. */
  group_level?: number;
  price?: IAPPrice;
  availability?: IAPAvailability;
  /** Introductory offers attached to this subscription. The sync uses a
   *  smart diff: matches by (mode, duration, periods, territory) tuple,
   *  creates anything in YAML but not on ASC, deletes anything on ASC
   *  but not in YAML. */
  intro_offers?: IntroOffer[];
  /** Local path to a PNG / JPEG that Apple Review uses to verify where
   *  this subscription is purchased in the app. Required for submission. */
  review_screenshot?: string;
  /** Free-text note Apple Review reads alongside the screenshot.
   *  Synced via PATCH; can be set on create and updated on existing subs. */
  review_note?: string;
  localisations: Record<string, IAPLocalisation>;
}

export interface IAPMetadata {
  /** Optional — only required if any subscriptions reference a group
   *  not already on ASC. The CLI creates groups before subscriptions. */
  subscription_groups?: Record<string, SubscriptionGroup>;
  purchases: Record<string, InAppPurchase>;
  subscriptions: Record<string, Subscription>;
}

// ============================================================================
// Screenshots
// ============================================================================

export type ScreenshotUploadMode = 'replace' | 'add' | 'reorder';

export interface ScreenshotOrder {
  order: string[];
}

export interface ParsedScreenshotFilename {
  language: string;
  device: string;
  orientation: 'p' | 'l';
  feature: string;
  timestamp: string;
  resolution: string;
  filename: string;
}

/**
 * Device type mapping to App Store Connect display types
 *
 * iPhone display sizes (using only required sizes):
 * - 6.3" - Maps to 6.1" display type (APP_IPHONE_61)
 * - 6.5" - iPhone XS Max, 11 Pro Max (APP_IPHONE_65)
 * - 6.9" - iPhone 16 Pro Max (APP_IPHONE_67)
 *
 * iPad display sizes:
 * - 11" - iPad Pro 11" 3rd gen (APP_IPAD_PRO_3GEN_11)
 * - 12.9" - iPad Pro 12.9" (older) (APP_IPAD_PRO_129)
 * - 13" - iPad Pro 12.9" 3rd gen (APP_IPAD_PRO_3GEN_129)
 */
export const DEVICE_TYPE_MAP: Record<string, string> = {
  // iPhones - only 6.9", 6.5", 6.3"
  'iphone-6.3': 'APP_IPHONE_61',  // Maps to 6.1" display type
  'iphone-6.5': 'APP_IPHONE_65',
  'iphone-6.9': 'APP_IPHONE_67',  // Maps to 6.7" display type
  // iPads - all sizes
  'ipad-11': 'APP_IPAD_PRO_3GEN_11',
  'ipad-12.9': 'APP_IPAD_PRO_129',
  'ipad-13': 'APP_IPAD_PRO_3GEN_129',
};

/**
 * Apple's required screenshot dimensions per ASC display type.
 *
 * Each entry lists the acceptable PORTRAIT (w, h) pairs for that
 * display type; landscape (h, w) is also accepted at the same numbers
 * swapped. ASC silently rejects screenshots that don't match one of
 * these pairs — the upload commits cleanly but the file never appears
 * in the listing — so the upload command validates each file's
 * `(width, height)` against this table before reserving the asset.
 *
 * Source:
 * https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
 *
 * Notes:
 *   - APP_IPHONE_67 is shared between Apple's "6.7\"" and "6.9\""
 *     marketing tiers; both pixel pairs are valid.
 *   - APP_IPHONE_61 is shared between "6.1\"" and "6.3\"" tiers.
 *   - APP_IPAD_PRO_3GEN_11 covers four generations of 11" iPad Pro/Air
 *     hardware; Apple accepts any of the four historical pairs.
 */
export const SCREENSHOT_DIMENSIONS: Record<string, ReadonlyArray<readonly [number, number]>> = {
  // 1320×2868 is the iPhone 17 Pro Max / 16 Pro Max recently-added 6.9"
  // dimension Apple started accepting in 2025; some 6.7" / 6.9" submissions
  // still upload at 1290×2796 / 1260×2736 (the docs list both).
  APP_IPHONE_67: [[1320, 2868], [1290, 2796], [1260, 2736]],
  APP_IPHONE_65: [[1284, 2778], [1242, 2688]],
  APP_IPHONE_61: [[1179, 2556], [1170, 2532]],
  APP_IPAD_PRO_3GEN_129: [[2064, 2752]],
  APP_IPAD_PRO_129: [[2048, 2732]],
  APP_IPAD_PRO_3GEN_11: [[1488, 2266], [1668, 2420], [1668, 2388], [1640, 2360]],
};

/**
 * Device type mapping for App Preview videos.
 * Preview types use different enum values than screenshot display types.
 */
export const PREVIEW_DEVICE_TYPE_MAP: Record<string, string> = {
  'iphone-6.3': 'IPHONE_61',
  'iphone-6.5': 'IPHONE_65',
  'iphone-6.9': 'IPHONE_67',
  'ipad-11': 'IPAD_PRO_3GEN_11',
  'ipad-12.9': 'IPAD_PRO_129',
  'ipad-13': 'IPAD_PRO_3GEN_129',
};

/**
 * Device group aliases — upload one file to all sizes of a device family.
 */
export const PREVIEW_DEVICE_GROUPS: Record<string, string[]> = {
  'iphone': ['iphone-6.9', 'iphone-6.5', 'iphone-6.3'],
  'ipad': ['ipad-13', 'ipad-12.9', 'ipad-11'],
};

/**
 * Language code mapping from our format to App Store Connect locale
 */
export const LANGUAGE_MAP: Record<string, string> = {
  'en': 'en-GB',
  'en-US': 'en-US',
  'en-GB': 'en-GB',
  'de': 'de-DE',
  'fr': 'fr-FR',
  'es': 'es-ES',
  'es-MX': 'es-MX',
  'ar': 'ar-SA',
  'fi': 'fi',
  'he': 'he',
  'hi': 'hi',
  'id': 'id',
  'ja': 'ja',
  'ko': 'ko',
  'pt': 'pt-BR',
  'pt-BR': 'pt-BR',
  'pt-PT': 'pt-PT',
  'ru': 'ru',
  'zh': 'zh-Hans',
};

/**
 * Languages that expand to multiple store locales for screenshots.
 * When uploading screenshots, files with these language prefixes
 * are uploaded to all listed locales.
 */
export const LOCALE_EXPAND: Record<string, string[]> = {
  'es': ['es-ES', 'es-MX'],
  'pt': ['pt-BR', 'pt-PT'],
};

/**
 * Reverse mapping from App Store Connect locale to short name
 * Used when exporting to create consistent filenames
 */
export const LOCALE_TO_SHORT: Record<string, string> = {
  'en-GB': 'en',
  'en-US': 'en-US',
  'de-DE': 'de',
  'fr-FR': 'fr',
  'es-ES': 'es',
  'es-MX': 'es-MX',
  'ar-SA': 'ar',
  'fi': 'fi',
  'he': 'he',
  'hi': 'hi',
  'id': 'id',
  'ja': 'ja',
  'ko': 'ko',
  'pt-BR': 'pt',
  'pt-PT': 'pt-PT',
  'ru': 'ru',
  'zh-Hans': 'zh',
};

// ============================================================================
// API Response Types
// ============================================================================

export interface AppVersion {
  id: string;
  versionString: string;
  platform: string;
  state: string;
  createdDate: string;
}

export interface AppLocalisation {
  id: string;
  locale: string;
  name: string;
  subtitle: string;
  promotionalText: string;
  description: string;
  keywords: string;
  whatsNew: string;
}

export interface CustomProductPage {
  id: string;
  name: string;
  url: string;
  visible: boolean;
}

export interface Screenshot {
  id: string;
  fileName: string;
  fileSize: number;
  sourceFileChecksum: string;
  assetDeliveryState: {
    state: string;
    errors?: Array<{ code: string; description: string }>;
  };
}

export interface Preview {
  id: string;
  fileName: string;
  fileSize: number;
  sourceFileChecksum: string;
  videoUrl: string;
  mimeType: string;
  assetDeliveryState: {
    state: string;
    errors?: Array<{ code: string; description: string }>;
  };
}

export interface Build {
  id: string;
  version: string;
  buildNumber: string;
  processingState: string;
  uploadedDate: string;
  platform: string;
  minOsVersion?: string;
}

export interface BetaGroup {
  id: string;
  name: string;
  isInternalGroup: boolean;
  publicLinkEnabled: boolean;
}

export type PreviewUploadMode = 'replace' | 'replace-all' | 'add' | 'skip';

// ============================================================================
// Command Options
// ============================================================================

export interface ListingsUpdateOptions {
  all?: boolean;
  lang?: string;
  field?: 'whats_new' | 'title' | 'subtitle' | 'promotional_text' | 'description' | 'keywords';
  dryRun?: boolean;
  keyId?: string;
}

export interface ScreenshotsUploadOptions {
  source: string;
  lang?: string;
  all?: boolean;
  mode: ScreenshotUploadMode;
  keyId?: string;
}

export interface IAPSyncOptions {
  productId?: string;
  keyId?: string;
}

export interface ReadOptions {
  lang?: string;
  keyId?: string;
}
