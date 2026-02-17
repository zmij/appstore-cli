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

export interface InAppPurchase {
  reference_name: string;
  localisations: Record<string, IAPLocalisation>;
}

export interface Subscription {
  reference_name: string;
  localisations: Record<string, IAPLocalisation>;
}

export interface IAPMetadata {
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

export type PreviewUploadMode = 'replace' | 'add' | 'skip';

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
