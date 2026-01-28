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
 * iPhone display sizes:
 * - 5.5" - iPhone 6+, 7+, 8+ (APP_IPHONE_55)
 * - 6.1" - iPhone XR, 11, 12, 13, 14 (APP_IPHONE_61)
 * - 6.3" - Alias for 6.1" display type
 * - 6.5" - iPhone XS Max, 11 Pro Max (APP_IPHONE_65)
 * - 6.7" - iPhone 12-14 Pro Max, 14 Plus (APP_IPHONE_67)
 * - 6.9" - iPhone 16 Pro Max (APP_IPHONE_69)
 *
 * iPad display sizes:
 * - 11" - iPad Pro 11" 3rd gen (APP_IPAD_PRO_3GEN_11)
 * - 12.9" - iPad Pro 12.9" (older) (APP_IPAD_PRO_129)
 * - 13" - iPad Pro 12.9" 3rd gen (APP_IPAD_PRO_3GEN_129)
 */
export const DEVICE_TYPE_MAP: Record<string, string> = {
  'iphone-5.5': 'APP_IPHONE_55',
  'iphone-6.1': 'APP_IPHONE_61',
  'iphone-6.3': 'APP_IPHONE_61',  // Alias for 6.1" display
  'iphone-6.5': 'APP_IPHONE_65',
  'iphone-6.7': 'APP_IPHONE_67',
  'iphone-6.9': 'APP_IPHONE_69',
  'ipad-11': 'APP_IPAD_PRO_3GEN_11',
  'ipad-12.9': 'APP_IPAD_PRO_129',
  'ipad-13': 'APP_IPAD_PRO_3GEN_129',
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
  'ja': 'ja',
  'ko': 'ko',
  'ru': 'ru',
  'zh': 'zh-Hans',
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
  'ja': 'ja',
  'ko': 'ko',
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
