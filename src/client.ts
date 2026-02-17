/**
 * App Store Connect API Client Wrapper
 *
 * Provides a high-level interface to the App Store Connect API
 * using appstore-connect-sdk.
 */

import {
  createClient as createSdkClient,
  appsGetCollection,
  appsGetInstance,
  appsAppStoreVersionsGetToManyRelated,
  appStoreVersionsAppStoreVersionLocalizationsGetToManyRelated,
  appStoreVersionLocalizationsUpdateInstance,
  appStoreVersionLocalizationsCreateInstance,
  appStoreVersionLocalizationsAppScreenshotSetsGetToManyRelated,
  appScreenshotSetsAppScreenshotsGetToManyRelated,
  appScreenshotSetsAppScreenshotsReplaceToManyRelationship,
  appScreenshotSetsCreateInstance,
  appScreenshotsDeleteInstance,
  appScreenshotsCreateInstance,
  appScreenshotsUpdateInstance,
  appsAppCustomProductPagesGetToManyRelated,
  appCustomProductPagesGetInstance,
  appsInAppPurchasesV2GetToManyRelated,
  appsSubscriptionGroupsGetToManyRelated,
  appStoreVersionLocalizationsAppPreviewSetsGetToManyRelated,
  appPreviewSetsAppPreviewsGetToManyRelated,
  appPreviewSetsCreateInstance,
  appPreviewsCreateInstance,
  appPreviewsUpdateInstance,
  appPreviewsDeleteInstance,
  appPreviewSetsDeleteInstance,
} from 'appstore-connect-sdk';
import type { Client } from 'appstore-connect-sdk';
import { getAuthContext, type AuthContext } from './auth.js';
import type {
  AppVersion,
  AppLocalisation,
  CustomProductPage,
  Screenshot,
  Preview,
} from './types.js';

/**
 * App Store Connect Client
 */
export class AppStoreClient {
  private client: Client;
  private appId: string;

  constructor(authContext: AuthContext) {
    this.client = createSdkClient({
      issuerId: authContext.issuerId,
      privateKeyId: authContext.keyId,
      privateKey: authContext.privateKey,
    });
    this.appId = authContext.appId;
  }

  /**
   * Create a client using the default or specified key
   */
  static create(keyName?: string): AppStoreClient {
    const authContext = getAuthContext(keyName);
    return new AppStoreClient(authContext);
  }

  /**
   * Find app ID by bundle ID (for setup)
   */
  static async findAppIdByBundleId(
    issuerId: string,
    keyId: string,
    privateKey: string,
    bundleId: string
  ): Promise<string | null> {
    const client = createSdkClient({
      issuerId,
      privateKeyId: keyId,
      privateKey,
    });

    const response = await appsGetCollection({
      client,
      query: {
        'filter[bundleId]': [bundleId],
      },
    });

    const apps = response.data?.data || [];
    if (apps.length === 0) {
      return null;
    }

    return apps[0].id;
  }

  // ============================================================================
  // App Versions
  // ============================================================================

  /**
   * List all app versions
   */
  async listVersions(): Promise<AppVersion[]> {
    const response = await appsAppStoreVersionsGetToManyRelated({
      client: this.client,
      path: { id: this.appId },
    });

    return (response.data?.data || []).map((v: any) => ({
      id: v.id,
      versionString: v.attributes?.versionString || '',
      platform: v.attributes?.platform || '',
      state: v.attributes?.appStoreState || '',
      createdDate: v.attributes?.createdDate || '',
    }));
  }

  /**
   * Get the latest editable version (PREPARE_FOR_SUBMISSION or DEVELOPER_REJECTED)
   */
  async getEditableVersion(): Promise<AppVersion | null> {
    const versions = await this.listVersions();
    const editableStates = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED'];

    return versions.find((v) => editableStates.includes(v.state)) || null;
  }

  // ============================================================================
  // Localisations
  // ============================================================================

  /**
   * List all localisations for an app version
   */
  async listLocalisations(versionId: string): Promise<AppLocalisation[]> {
    const response = await appStoreVersionsAppStoreVersionLocalizationsGetToManyRelated({
      client: this.client,
      path: { id: versionId },
    });

    return (response.data?.data || []).map((l: any) => ({
      id: l.id,
      locale: l.attributes?.locale || '',
      name: l.attributes?.name || '',
      subtitle: l.attributes?.subtitle || '',
      promotionalText: l.attributes?.promotionalText || '',
      description: l.attributes?.description || '',
      keywords: l.attributes?.keywords || '',
      whatsNew: l.attributes?.whatsNew || '',
    }));
  }

  /**
   * Get localisation for a specific locale
   */
  async getLocalisation(versionId: string, locale: string): Promise<AppLocalisation | null> {
    const localisations = await this.listLocalisations(versionId);
    return localisations.find((l) => l.locale === locale) || null;
  }

  /**
   * Update a localisation
   */
  async updateLocalisation(
    localisationId: string,
    updates: Partial<{
      name: string;
      subtitle: string;
      promotionalText: string;
      description: string;
      keywords: string;
      whatsNew: string;
    }>
  ): Promise<void> {
    const response = await appStoreVersionLocalizationsUpdateInstance({
      client: this.client,
      path: { id: localisationId },
      body: {
        data: {
          id: localisationId,
          type: 'appStoreVersionLocalizations',
          attributes: updates,
        },
      },
    });

    // Check for errors in the response
    if (response.error) {
      const errors = (response.error as any).errors || [];
      const messages = errors.map((e: any) => e.detail || e.title).join('; ');
      throw new Error(`API error: ${messages || JSON.stringify(response.error)}`);
    }
  }

  /**
   * Create a new localisation for a version
   */
  async createLocalisation(
    versionId: string,
    locale: string,
    attributes: {
      name?: string;
      subtitle?: string;
      promotionalText?: string;
      description?: string;
      keywords?: string;
      whatsNew?: string;
    }
  ): Promise<string> {
    const response = await appStoreVersionLocalizationsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'appStoreVersionLocalizations',
          attributes: {
            locale,
            ...attributes,
          },
          relationships: {
            appStoreVersion: {
              data: {
                id: versionId,
                type: 'appStoreVersions',
              },
            },
          },
        },
      },
    });

    return response.data?.data?.id || '';
  }

  // ============================================================================
  // Screenshots
  // ============================================================================

  /**
   * List screenshot sets for a localisation
   */
  async listScreenshotSets(localisationId: string): Promise<any[]> {
    const response = await appStoreVersionLocalizationsAppScreenshotSetsGetToManyRelated({
      client: this.client,
      path: { id: localisationId },
    });

    return response.data?.data || [];
  }

  /**
   * List screenshots in a screenshot set
   */
  async listScreenshots(screenshotSetId: string): Promise<Screenshot[]> {
    const response = await appScreenshotSetsAppScreenshotsGetToManyRelated({
      client: this.client,
      path: { id: screenshotSetId },
    });

    return (response.data?.data || []).map((s: any) => ({
      id: s.id,
      fileName: s.attributes?.fileName || '',
      fileSize: s.attributes?.fileSize || 0,
      sourceFileChecksum: s.attributes?.sourceFileChecksum || '',
      assetDeliveryState: s.attributes?.assetDeliveryState || { state: 'UNKNOWN' },
    }));
  }

  /**
   * Create a screenshot set for a display type
   */
  async createScreenshotSet(
    localisationId: string,
    screenshotDisplayType: string
  ): Promise<string> {
    const response = await appScreenshotSetsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'appScreenshotSets',
          attributes: {
            screenshotDisplayType: screenshotDisplayType as any,
          },
          relationships: {
            appStoreVersionLocalization: {
              data: {
                id: localisationId,
                type: 'appStoreVersionLocalizations',
              },
            },
          },
        },
      },
    });

    return response.data?.data?.id || '';
  }

  /**
   * Delete a screenshot
   */
  async deleteScreenshot(screenshotId: string): Promise<void> {
    await appScreenshotsDeleteInstance({
      client: this.client,
      path: { id: screenshotId },
    });
  }

  /**
   * Reserve a screenshot upload slot
   */
  async reserveScreenshot(
    screenshotSetId: string,
    fileName: string,
    fileSize: number
  ): Promise<{ id: string; uploadOperations: any[] }> {
    const response = await appScreenshotsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'appScreenshots',
          attributes: {
            fileName,
            fileSize,
          },
          relationships: {
            appScreenshotSet: {
              data: {
                id: screenshotSetId,
                type: 'appScreenshotSets',
              },
            },
          },
        },
      },
    });

    return {
      id: response.data?.data?.id || '',
      uploadOperations: response.data?.data?.attributes?.uploadOperations || [],
    };
  }

  /**
   * Commit a screenshot upload
   */
  async commitScreenshot(screenshotId: string, checksum: string): Promise<void> {
    await appScreenshotsUpdateInstance({
      client: this.client,
      path: { id: screenshotId },
      body: {
        data: {
          id: screenshotId,
          type: 'appScreenshots',
          attributes: {
            uploaded: true,
            sourceFileChecksum: checksum,
          },
        },
      },
    });
  }

  /**
   * Reorder screenshots in a screenshot set
   *
   * @param screenshotSetId - The screenshot set ID
   * @param screenshotIds - Array of screenshot IDs in the desired order
   */
  async reorderScreenshots(screenshotSetId: string, screenshotIds: string[]): Promise<void> {
    await appScreenshotSetsAppScreenshotsReplaceToManyRelationship({
      client: this.client,
      path: { id: screenshotSetId },
      body: {
        data: screenshotIds.map((id) => ({
          id,
          type: 'appScreenshots',
        })),
      },
    });
  }

  // ============================================================================
  // Previews
  // ============================================================================

  /**
   * List preview sets for a localisation
   */
  async listPreviewSets(localisationId: string): Promise<any[]> {
    const response = await appStoreVersionLocalizationsAppPreviewSetsGetToManyRelated({
      client: this.client,
      path: { id: localisationId },
    });

    return response.data?.data || [];
  }

  /**
   * List previews in a preview set
   */
  async listPreviews(previewSetId: string): Promise<Preview[]> {
    const response = await appPreviewSetsAppPreviewsGetToManyRelated({
      client: this.client,
      path: { id: previewSetId },
    });

    return (response.data?.data || []).map((p: any) => ({
      id: p.id,
      fileName: p.attributes?.fileName || '',
      fileSize: p.attributes?.fileSize || 0,
      sourceFileChecksum: p.attributes?.sourceFileChecksum || '',
      videoUrl: p.attributes?.videoUrl || '',
      mimeType: p.attributes?.mimeType || '',
      assetDeliveryState: p.attributes?.assetDeliveryState || { state: 'UNKNOWN' },
    }));
  }

  /**
   * Create a preview set for a preview type
   */
  async createPreviewSet(
    localisationId: string,
    previewType: string
  ): Promise<string> {
    const response = await appPreviewSetsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'appPreviewSets',
          attributes: {
            previewType: previewType as any,
          },
          relationships: {
            appStoreVersionLocalization: {
              data: {
                id: localisationId,
                type: 'appStoreVersionLocalizations',
              },
            },
          },
        },
      },
    });

    return response.data?.data?.id || '';
  }

  /**
   * Reserve a preview upload slot
   */
  async reservePreview(
    previewSetId: string,
    fileName: string,
    fileSize: number
  ): Promise<{ id: string; uploadOperations: any[] }> {
    const response = await appPreviewsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'appPreviews',
          attributes: {
            fileName,
            fileSize,
          },
          relationships: {
            appPreviewSet: {
              data: {
                id: previewSetId,
                type: 'appPreviewSets',
              },
            },
          },
        },
      },
    });

    return {
      id: response.data?.data?.id || '',
      uploadOperations: response.data?.data?.attributes?.uploadOperations || [],
    };
  }

  /**
   * Commit a preview upload
   */
  async commitPreview(previewId: string, checksum: string): Promise<void> {
    await appPreviewsUpdateInstance({
      client: this.client,
      path: { id: previewId },
      body: {
        data: {
          id: previewId,
          type: 'appPreviews',
          attributes: {
            uploaded: true,
            sourceFileChecksum: checksum,
          },
        },
      },
    });
  }

  /**
   * Delete a preview
   */
  async deletePreview(previewId: string): Promise<void> {
    await appPreviewsDeleteInstance({
      client: this.client,
      path: { id: previewId },
    });
  }

  /**
   * Delete an entire preview set
   */
  async deletePreviewSet(previewSetId: string): Promise<void> {
    await appPreviewSetsDeleteInstance({
      client: this.client,
      path: { id: previewSetId },
    });
  }

  // ============================================================================
  // Custom Product Pages
  // ============================================================================

  /**
   * List custom product pages
   */
  async listCustomProductPages(): Promise<CustomProductPage[]> {
    const response = await appsAppCustomProductPagesGetToManyRelated({
      client: this.client,
      path: { id: this.appId },
    });

    return (response.data?.data || []).map((p: any) => ({
      id: p.id,
      name: p.attributes?.name || '',
      url: p.attributes?.url || '',
      visible: p.attributes?.visible || false,
    }));
  }

  /**
   * Get custom product page details
   */
  async getCustomProductPage(pageId: string): Promise<CustomProductPage | null> {
    try {
      const response = await appCustomProductPagesGetInstance({
        client: this.client,
        path: { id: pageId },
      });

      const p = response.data?.data;
      if (!p) return null;

      return {
        id: p.id,
        name: p.attributes?.name || '',
        url: p.attributes?.url || '',
        visible: p.attributes?.visible || false,
      };
    } catch {
      return null;
    }
  }

  // ============================================================================
  // In-App Purchases
  // ============================================================================

  /**
   * List in-app purchases
   */
  async listInAppPurchases(): Promise<any[]> {
    const response = await appsInAppPurchasesV2GetToManyRelated({
      client: this.client,
      path: { id: this.appId },
    });

    return response.data?.data || [];
  }

  /**
   * List subscriptions
   */
  async listSubscriptions(): Promise<any[]> {
    const response = await appsSubscriptionGroupsGetToManyRelated({
      client: this.client,
      path: { id: this.appId },
    });

    return response.data?.data || [];
  }

  // ============================================================================
  // App Info
  // ============================================================================

  /**
   * Get app info
   */
  async getAppInfo(): Promise<any> {
    const response = await appsGetInstance({
      client: this.client,
      path: { id: this.appId },
    });

    return response.data?.data;
  }
}

/**
 * Create a client instance
 */
export function createClient(keyName?: string): AppStoreClient {
  return AppStoreClient.create(keyName);
}
