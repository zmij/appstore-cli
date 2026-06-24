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
  buildsGetCollection,
  betaGroupsGetCollection,
  betaGroupsBuildsCreateToManyRelationship,
  betaGroupsBuildsGetToManyRelated,
  betaBuildLocalizationsCreateInstance,
  betaBuildLocalizationsUpdateInstance,
  betaBuildLocalizationsGetCollection,
  betaAppReviewSubmissionsCreateInstance,
  // IAP / subscription localisation surface
  inAppPurchasesV2InAppPurchaseLocalizationsGetToManyRelated,
  inAppPurchaseLocalizationsCreateInstance,
  inAppPurchaseLocalizationsUpdateInstance,
  inAppPurchaseLocalizationsDeleteInstance,
  subscriptionGroupsSubscriptionsGetToManyRelated,
  subscriptionGroupsSubscriptionGroupLocalizationsGetToManyRelated,
  subscriptionGroupLocalizationsCreateInstance,
  subscriptionGroupLocalizationsUpdateInstance,
  subscriptionGroupLocalizationsDeleteInstance,
  subscriptionsSubscriptionLocalizationsGetToManyRelated,
  subscriptionLocalizationsCreateInstance,
  subscriptionLocalizationsUpdateInstance,
  subscriptionLocalizationsDeleteInstance,
  // IAP / subscription create (Phase 5)
  inAppPurchasesV2CreateInstance,
  inAppPurchasesV2UpdateInstance,
  subscriptionGroupsCreateInstance,
  subscriptionsCreateInstance,
  subscriptionsUpdateInstance,
  // Subscription introductory offers (Phase 3a)
  subscriptionsIntroductoryOffersGetToManyRelated,
  subscriptionIntroductoryOffersCreateInstance,
  subscriptionIntroductoryOffersDeleteInstance,
  // IAP / subscription review screenshots (Phase 4)
  inAppPurchasesV2AppStoreReviewScreenshotGetToOneRelated,
  inAppPurchaseAppStoreReviewScreenshotsCreateInstance,
  inAppPurchaseAppStoreReviewScreenshotsUpdateInstance,
  inAppPurchaseAppStoreReviewScreenshotsDeleteInstance,
  subscriptionsAppStoreReviewScreenshotGetToOneRelated,
  subscriptionAppStoreReviewScreenshotsCreateInstance,
  subscriptionAppStoreReviewScreenshotsUpdateInstance,
  subscriptionAppStoreReviewScreenshotsDeleteInstance,
  // IAP / subscription pricing + availability
  inAppPurchasesV2IapPriceScheduleGetToOneRelated,
  inAppPurchasePriceSchedulesBaseTerritoryGetToOneRelated,
  inAppPurchasePriceSchedulesAutomaticPricesGetToManyRelated,
  inAppPurchasePriceSchedulesManualPricesGetToManyRelated,
  inAppPurchasePriceSchedulesCreateInstance,
  inAppPurchasesV2PricePointsGetToManyRelated,
  inAppPurchasesV2InAppPurchaseAvailabilityGetToOneRelated,
  inAppPurchaseAvailabilitiesAvailableTerritoriesGetToManyRelated,
  inAppPurchaseAvailabilitiesCreateInstance,
  subscriptionsPricesGetToManyRelated,
  subscriptionsPricePointsGetToManyRelated,
  subscriptionPricesCreateInstance,
  subscriptionsSubscriptionAvailabilityGetToOneRelated,
  subscriptionAvailabilitiesAvailableTerritoriesGetToManyRelated,
  subscriptionAvailabilitiesCreateInstance,
} from 'appstore-connect-sdk';
import type { Client } from 'appstore-connect-sdk';
import { getAuthContext, type AuthContext } from './auth.js';
import type {
  AppVersion,
  AppLocalisation,
  CustomProductPage,
  Screenshot,
  Preview,
  Build,
  BetaGroup,
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
   * List in-app purchases. The default response omits `reviewNote`;
   * pass an explicit `fields[inAppPurchases]` list so the v2 endpoint
   * surfaces every attribute the rest of the CLI reads from
   * `attributes` (name + classification + reviewNote).
   */
  async listInAppPurchases(): Promise<any[]> {
    const response = await appsInAppPurchasesV2GetToManyRelated({
      client: this.client,
      path: { id: this.appId },
      query: {
        'fields[inAppPurchases]': [
          'name', 'productId', 'inAppPurchaseType', 'familySharable', 'state', 'reviewNote',
        ],
      } as any,
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
  // IAP Localisations
  // ============================================================================
  //
  // Three flavours of localisation live under the IAP/sub family:
  //   1. In-app purchase localisation       (display_name, description)
  //   2. Subscription group localisation    (name, custom_app_name)
  //   3. Subscription localisation          (display_name, description)
  //
  // ASC keys each localisation by (parent product, locale). We provide three
  // primitives — list, upsert (create-or-update), delete — and mirror the
  // appStoreVersionLocalizations upsert pattern used for app-listings.

  /**
   * Fetch every localisation attached to an IAP. The `id` here is the
   * App Store Connect IAP id (NOT the productId string).
   */
  async listInAppPurchaseLocalisations(iapId: string): Promise<any[]> {
    const response = await inAppPurchasesV2InAppPurchaseLocalizationsGetToManyRelated({
      client: this.client,
      path: { id: iapId },
    });
    return response.data?.data || [];
  }

  /**
   * Create-or-update one IAP localisation. We POST when no existing
   * localisation matches the locale and PATCH otherwise — exactly the
   * same shape we use for app-listing localisations.
   *
   * The update path is conservative: it only sends the fields the caller
   * passes, so a partial sync (e.g. just description) doesn't clobber
   * the other field.
   */
  async upsertInAppPurchaseLocalisation(
    iapId: string,
    locale: string,
    fields: { name: string; description?: string },
  ): Promise<string> {
    const existing = await this.listInAppPurchaseLocalisations(iapId);
    const match = existing.find((l: any) => l.attributes?.locale === locale);

    if (match) {
      const resp = await inAppPurchaseLocalizationsUpdateInstance({
        client: this.client,
        path: { id: match.id },
        body: {
          data: {
            id: match.id,
            type: 'inAppPurchaseLocalizations',
            attributes: fields,
          },
        },
      });
      throwIfError(resp);
      return match.id;
    }

    const resp = await inAppPurchaseLocalizationsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'inAppPurchaseLocalizations',
          attributes: { locale, ...fields },
          relationships: {
            inAppPurchaseV2: {
              data: { id: iapId, type: 'inAppPurchases' },
            },
          },
        },
      },
    });
    throwIfError(resp);
    return resp.data?.data?.id || '';
  }

  /** Delete one IAP localisation by id. */
  async deleteInAppPurchaseLocalisation(localisationId: string): Promise<void> {
    const resp = await inAppPurchaseLocalizationsDeleteInstance({
      client: this.client,
      path: { id: localisationId },
    });
    throwIfError(resp);
  }

  // -- Subscription groups ----------------------------------------------------

  /** List every subscription product inside one subscription group.
   *  Like `listInAppPurchases`, request `reviewNote` explicitly so the
   *  response carries everything the CLI reads off `attributes`. */
  async listSubscriptionsInGroup(groupId: string): Promise<any[]> {
    const response = await subscriptionGroupsSubscriptionsGetToManyRelated({
      client: this.client,
      path: { id: groupId },
      query: {
        'fields[subscriptions]': [
          'name', 'productId', 'subscriptionPeriod', 'familySharable', 'state', 'reviewNote', 'groupLevel',
        ],
      } as any,
    });
    return response.data?.data || [];
  }

  /** List every localisation on a subscription group. */
  async listSubscriptionGroupLocalisations(groupId: string): Promise<any[]> {
    const response = await subscriptionGroupsSubscriptionGroupLocalizationsGetToManyRelated({
      client: this.client,
      path: { id: groupId },
    });
    return response.data?.data || [];
  }

  /**
   * Upsert one subscription-group localisation. Group localisations carry
   * `name` (the group's user-facing name in that locale) and
   * `customAppName` (an optional override for the app name shown next to
   * the group in the subscriptions sheet).
   */
  async upsertSubscriptionGroupLocalisation(
    groupId: string,
    locale: string,
    fields: { name: string; customAppName?: string },
  ): Promise<string> {
    const existing = await this.listSubscriptionGroupLocalisations(groupId);
    const match = existing.find((l: any) => l.attributes?.locale === locale);

    if (match) {
      const resp = await subscriptionGroupLocalizationsUpdateInstance({
        client: this.client,
        path: { id: match.id },
        body: {
          data: {
            id: match.id,
            type: 'subscriptionGroupLocalizations',
            attributes: fields,
          },
        },
      });
      throwIfError(resp);
      return match.id;
    }

    const resp = await subscriptionGroupLocalizationsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionGroupLocalizations',
          attributes: { locale, ...fields },
          relationships: {
            subscriptionGroup: {
              data: { id: groupId, type: 'subscriptionGroups' },
            },
          },
        },
      },
    });
    throwIfError(resp);
    return resp.data?.data?.id || '';
  }

  async deleteSubscriptionGroupLocalisation(localisationId: string): Promise<void> {
    const resp = await subscriptionGroupLocalizationsDeleteInstance({
      client: this.client,
      path: { id: localisationId },
    });
    throwIfError(resp);
  }

  // -- Subscriptions (inside a group) -----------------------------------------

  /** List every localisation on a single subscription product. */
  async listSubscriptionLocalisations(subscriptionId: string): Promise<any[]> {
    const response = await subscriptionsSubscriptionLocalizationsGetToManyRelated({
      client: this.client,
      path: { id: subscriptionId },
    });
    return response.data?.data || [];
  }

  /**
   * Upsert one subscription localisation. Subscription localisations carry
   * `name` (user-facing product name) and `description`.
   */
  async upsertSubscriptionLocalisation(
    subscriptionId: string,
    locale: string,
    fields: { name: string; description?: string },
  ): Promise<string> {
    const existing = await this.listSubscriptionLocalisations(subscriptionId);
    const match = existing.find((l: any) => l.attributes?.locale === locale);

    if (match) {
      const resp = await subscriptionLocalizationsUpdateInstance({
        client: this.client,
        path: { id: match.id },
        body: {
          data: {
            id: match.id,
            type: 'subscriptionLocalizations',
            attributes: fields,
          },
        },
      });
      throwIfError(resp);
      return match.id;
    }

    const resp = await subscriptionLocalizationsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionLocalizations',
          attributes: { locale, ...fields },
          relationships: {
            subscription: {
              data: { id: subscriptionId, type: 'subscriptions' },
            },
          },
        },
      },
    });
    throwIfError(resp);
    return resp.data?.data?.id || '';
  }

  async deleteSubscriptionLocalisation(localisationId: string): Promise<void> {
    const resp = await subscriptionLocalizationsDeleteInstance({
      client: this.client,
      path: { id: localisationId },
    });
    throwIfError(resp);
  }

  // ============================================================================
  // IAP / Subscription product create (Phase 5)
  // ============================================================================
  //
  // These three creators are the "from scratch" path — they create the
  // product record itself. Pricing / availability / localisations layer
  // on top via the methods below; `iap create` chains them together so
  // a YAML record turns into a fully-shaped ASC product in one shot.

  /**
   * Create a new in-app purchase. `productId` is the developer-facing
   * key used by your billing layer (e.g. `premium_lifetime`). Hard-fails
   * (via the API's own conflict) if the productId already exists — call
   * `listInAppPurchases` upfront to dedup beforehand.
   */
  async createInAppPurchase(opts: {
    productId: string;
    name: string;
    type: 'CONSUMABLE' | 'NON_CONSUMABLE' | 'NON_RENEWING_SUBSCRIPTION';
    familySharable?: boolean;
    reviewNote?: string;
  }): Promise<string> {
    const resp = await inAppPurchasesV2CreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'inAppPurchases',
          attributes: {
            name: opts.name,
            productId: opts.productId,
            inAppPurchaseType: opts.type,
            familySharable: opts.familySharable ?? false,
            ...(opts.reviewNote && { reviewNote: opts.reviewNote }),
          },
          relationships: {
            app: { data: { id: this.appId, type: 'apps' } },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  /**
   * Update mutable attributes on an existing IAP. `name` and
   * `familySharable` are also patchable here per the v2 schema, but
   * the current caller (iap sync) only flows `reviewNote` through —
   * see #2450 for the full wiring story.
   */
  async updateInAppPurchase(opts: {
    iapId: string;
    name?: string;
    familySharable?: boolean;
    reviewNote?: string;
  }): Promise<void> {
    const attributes: Record<string, unknown> = {};
    if (opts.name !== undefined) attributes.name = opts.name;
    if (opts.familySharable !== undefined) attributes.familySharable = opts.familySharable;
    // Empty string explicitly clears the note on Apple's side; `undefined`
    // leaves it alone. The caller (iap sync) decides which.
    if (opts.reviewNote !== undefined) attributes.reviewNote = opts.reviewNote;
    if (Object.keys(attributes).length === 0) return;
    const resp = await inAppPurchasesV2UpdateInstance({
      client: this.client,
      path: { id: opts.iapId },
      body: {
        data: {
          id: opts.iapId,
          type: 'inAppPurchases',
          attributes,
        },
      } as any,
    });
    throwIfError(resp);
  }

  /**
   * Create a new subscription group. The group is the container that
   * lets users upgrade/downgrade between tiers (monthly ↔ yearly within
   * the same family). Returns the ASC group id.
   */
  async createSubscriptionGroup(referenceName: string): Promise<string> {
    const resp = await subscriptionGroupsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionGroups',
          attributes: { referenceName },
          relationships: {
            app: { data: { id: this.appId, type: 'apps' } },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  /**
   * Create a new subscription inside an existing group. The
   * `subscriptionPeriod` enum is required; `groupLevel` optional (Apple
   * orders tiers within a group by this for the upgrade UI).
   */
  async createSubscription(opts: {
    groupId: string;
    productId: string;
    name: string;
    subscriptionPeriod: 'ONE_WEEK' | 'ONE_MONTH' | 'TWO_MONTHS' | 'THREE_MONTHS' | 'SIX_MONTHS' | 'ONE_YEAR';
    familySharable?: boolean;
    reviewNote?: string;
    groupLevel?: number;
  }): Promise<string> {
    const resp = await subscriptionsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptions',
          attributes: {
            name: opts.name,
            productId: opts.productId,
            subscriptionPeriod: opts.subscriptionPeriod,
            familySharable: opts.familySharable ?? false,
            ...(opts.reviewNote && { reviewNote: opts.reviewNote }),
            ...(opts.groupLevel !== undefined && { groupLevel: opts.groupLevel }),
          },
          relationships: {
            group: { data: { id: opts.groupId, type: 'subscriptionGroups' } },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  /**
   * Update mutable attributes on an existing subscription. Mirrors
   * `updateInAppPurchase` — the sync caller only flows `reviewNote`
   * through today (see #2450).
   */
  async updateSubscription(opts: {
    subId: string;
    name?: string;
    familySharable?: boolean;
    groupLevel?: number;
    reviewNote?: string;
  }): Promise<void> {
    const attributes: Record<string, unknown> = {};
    if (opts.name !== undefined) attributes.name = opts.name;
    if (opts.familySharable !== undefined) attributes.familySharable = opts.familySharable;
    if (opts.groupLevel !== undefined) attributes.groupLevel = opts.groupLevel;
    if (opts.reviewNote !== undefined) attributes.reviewNote = opts.reviewNote;
    if (Object.keys(attributes).length === 0) return;
    const resp = await subscriptionsUpdateInstance({
      client: this.client,
      path: { id: opts.subId },
      body: {
        data: {
          id: opts.subId,
          type: 'subscriptions',
          attributes,
        },
      } as any,
    });
    throwIfError(resp);
  }

  // ============================================================================
  // Subscription introductory offers (Phase 3a)
  // ============================================================================
  //
  // An introductory offer is a one-shot incentive ASC attaches to a
  // subscription for new subscribers. Three modes:
  //   * FREE_TRIAL: N periods free, no price point needed.
  //   * PAY_AS_YOU_GO: discounted rate for N periods, price point required.
  //   * PAY_UP_FRONT: one-time discounted price for N periods, price point
  //     required.
  //
  // Offers can be scoped to a single territory or apply globally (omit
  // territory). Multiple offers can coexist on one subscription as long
  // as their (mode, duration, territory) tuples don't collide.

  /** List every intro offer attached to one subscription. */
  async listSubscriptionIntroductoryOffers(subscriptionId: string): Promise<any[]> {
    const resp = await subscriptionsIntroductoryOffersGetToManyRelated({
      client: this.client,
      path: { id: subscriptionId },
      query: { include: ['territory', 'subscriptionPricePoint'] as any, limit: 200 } as any,
    });
    return ((resp.data?.data as any[]) ?? []).map((r: any) => ({
      ...r,
      // Flatten the included territory + price-point onto the row for the
      // caller's convenience — saves them walking the JSON:API envelope.
      _territory: r.relationships?.territory?.data?.id ?? null,
      _price_point_id: r.relationships?.subscriptionPricePoint?.data?.id ?? null,
    }));
  }

  /**
   * Create one intro offer. `territory` omitted = global. `pricePointId`
   * required for PAY_AS_YOU_GO and PAY_UP_FRONT; ignored (and may be
   * omitted) for FREE_TRIAL.
   */
  async createSubscriptionIntroductoryOffer(opts: {
    subscriptionId: string;
    duration: 'THREE_DAYS' | 'ONE_WEEK' | 'TWO_WEEKS' | 'ONE_MONTH' | 'TWO_MONTHS' | 'THREE_MONTHS' | 'SIX_MONTHS' | 'ONE_YEAR';
    offerMode: 'FREE_TRIAL' | 'PAY_AS_YOU_GO' | 'PAY_UP_FRONT';
    numberOfPeriods: number;
    territory?: string;
    pricePointId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<string> {
    const relationships: any = {
      subscription: { data: { id: opts.subscriptionId, type: 'subscriptions' } },
    };
    if (opts.territory) {
      relationships.territory = { data: { id: opts.territory, type: 'territories' } };
    }
    if (opts.pricePointId) {
      relationships.subscriptionPricePoint = {
        data: { id: opts.pricePointId, type: 'subscriptionPricePoints' },
      };
    }

    const attributes: any = {
      duration: opts.duration,
      offerMode: opts.offerMode,
      numberOfPeriods: opts.numberOfPeriods,
    };
    if (opts.startDate) attributes.startDate = opts.startDate;
    if (opts.endDate) attributes.endDate = opts.endDate;

    const resp = await subscriptionIntroductoryOffersCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionIntroductoryOffers',
          attributes,
          relationships,
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  /** Delete one intro offer by id. */
  async deleteSubscriptionIntroductoryOffer(offerId: string): Promise<void> {
    const resp = await subscriptionIntroductoryOffersDeleteInstance({
      client: this.client,
      path: { id: offerId },
    });
    throwIfError(resp);
  }

  // ============================================================================
  // IAP / Subscription review screenshots (Phase 4)
  // ============================================================================
  //
  // Apple's review team needs a screenshot showing where each IAP /
  // subscription is purchased inside the app — required before an IAP
  // can be submitted. Each product carries AT MOST ONE review
  // screenshot (a single image).
  //
  // Upload flow mirrors the appScreenshots flow used for store listings:
  //   1. createXxxReviewScreenshot(productId, fileName, fileSize) →
  //      reserves a record + returns uploadOperations (presigned URLs).
  //   2. caller PUTs the file bytes per operation.
  //   3. commitXxxReviewScreenshot(screenshotId, md5) → marks uploaded.

  /** Return the review screenshot attached to an IAP, or null when
   *  there isn't one yet. */
  async getInAppPurchaseReviewScreenshot(iapId: string): Promise<any | null> {
    const resp = await inAppPurchasesV2AppStoreReviewScreenshotGetToOneRelated({
      client: this.client,
      path: { id: iapId },
    });
    return (resp.data?.data as any) ?? null;
  }

  /** Reserve a review-screenshot upload slot for an IAP. Returns the
   *  new record id plus the presigned upload operations the caller
   *  PUTs chunks to. */
  async reserveInAppPurchaseReviewScreenshot(
    iapId: string,
    fileName: string,
    fileSize: number,
  ): Promise<{ id: string; uploadOperations: any[] }> {
    const resp = await inAppPurchaseAppStoreReviewScreenshotsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'inAppPurchaseAppStoreReviewScreenshots',
          attributes: { fileName, fileSize },
          relationships: {
            inAppPurchaseV2: { data: { id: iapId, type: 'inAppPurchases' } },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return {
      id: (resp.data?.data as any)?.id ?? '',
      uploadOperations: ((resp.data?.data as any)?.attributes?.uploadOperations as any[]) ?? [],
    };
  }

  /** Mark an IAP review screenshot as uploaded once the bytes are in. */
  async commitInAppPurchaseReviewScreenshot(screenshotId: string, checksum: string): Promise<void> {
    const resp = await inAppPurchaseAppStoreReviewScreenshotsUpdateInstance({
      client: this.client,
      path: { id: screenshotId },
      body: {
        data: {
          id: screenshotId,
          type: 'inAppPurchaseAppStoreReviewScreenshots',
          attributes: { uploaded: true, sourceFileChecksum: checksum },
        },
      } as any,
    });
    throwIfError(resp);
  }

  /** Delete an IAP review screenshot. Use before re-uploading a new
   *  image since each product holds only one. */
  async deleteInAppPurchaseReviewScreenshot(screenshotId: string): Promise<void> {
    const resp = await inAppPurchaseAppStoreReviewScreenshotsDeleteInstance({
      client: this.client,
      path: { id: screenshotId },
    });
    throwIfError(resp);
  }

  // -- Subscriptions ----------------------------------------------------------

  async getSubscriptionReviewScreenshot(subscriptionId: string): Promise<any | null> {
    const resp = await subscriptionsAppStoreReviewScreenshotGetToOneRelated({
      client: this.client,
      path: { id: subscriptionId },
    });
    return (resp.data?.data as any) ?? null;
  }

  async reserveSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    fileSize: number,
  ): Promise<{ id: string; uploadOperations: any[] }> {
    const resp = await subscriptionAppStoreReviewScreenshotsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionAppStoreReviewScreenshots',
          attributes: { fileName, fileSize },
          relationships: {
            subscription: { data: { id: subscriptionId, type: 'subscriptions' } },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return {
      id: (resp.data?.data as any)?.id ?? '',
      uploadOperations: ((resp.data?.data as any)?.attributes?.uploadOperations as any[]) ?? [],
    };
  }

  async commitSubscriptionReviewScreenshot(screenshotId: string, checksum: string): Promise<void> {
    const resp = await subscriptionAppStoreReviewScreenshotsUpdateInstance({
      client: this.client,
      path: { id: screenshotId },
      body: {
        data: {
          id: screenshotId,
          type: 'subscriptionAppStoreReviewScreenshots',
          attributes: { uploaded: true, sourceFileChecksum: checksum },
        },
      } as any,
    });
    throwIfError(resp);
  }

  async deleteSubscriptionReviewScreenshot(screenshotId: string): Promise<void> {
    const resp = await subscriptionAppStoreReviewScreenshotsDeleteInstance({
      client: this.client,
      path: { id: screenshotId },
    });
    throwIfError(resp);
  }

  // ============================================================================
  // IAP Pricing + Availability (auto-equalisation model)
  // ============================================================================
  //
  // Pricing model:
  //   Every IAP carries one `inAppPurchasePriceSchedule` which holds a
  //   `baseTerritory` (e.g. USA) and a base `inAppPurchasePricePoint`. With
  //   auto-equalisation Apple computes every other territory's price from
  //   that anchor (visible as the schedule's automaticPrices). Push pricing
  //   = create a new schedule pointing at the desired (territory, price-
  //   point) pair; Apple swaps the schedule in atomically.
  //
  // Availability model:
  //   `inAppPurchaseAvailability` holds an `availableInNewTerritories`
  //   boolean (default Apple-rolls-it-out-for-you flag) + a list of
  //   `availableTerritories`. Same pattern as pricing: push = create new
  //   availability record.
  //
  // Subscriptions mirror the same pattern with their own type names
  // (`subscriptionPrice`, `subscriptionAvailability`).

  /**
   * Get the price-schedule object for one IAP, plus its base territory and
   * the customer-facing price in that territory. Returns null when no
   * schedule exists (pre-pricing product).
   *
   * The `base_price` returned is the human-readable customerPrice from the
   * base territory's price point — what users see in the App Store.
   */
  async getInAppPurchasePriceSummary(iapId: string): Promise<{
    schedule_id: string;
    base_territory: string;
    base_price: string;
    base_currency: string;
    price_point_id: string;
  } | null> {
    const sched = await inAppPurchasesV2IapPriceScheduleGetToOneRelated({
      client: this.client,
      path: { id: iapId },
    });
    const scheduleId = (sched.data?.data as any)?.id;
    if (!scheduleId) return null;

    const base = await inAppPurchasePriceSchedulesBaseTerritoryGetToOneRelated({
      client: this.client,
      path: { id: scheduleId },
    });
    const baseTerritoryId = (base.data?.data as any)?.id;
    const baseCurrency = (base.data?.data as any)?.attributes?.currency ?? '';
    if (!baseTerritoryId) return null;

    // Look up the price for the BASE territory. The schedule keeps the
    // explicitly-set base price in `manualPrices` (one row, the anchor)
    // and Apple's auto-equalised prices for every OTHER territory in
    // `automaticPrices`. So the base price is always in manualPrices.
    const manual = await inAppPurchasePriceSchedulesManualPricesGetToManyRelated({
      client: this.client,
      path: { id: scheduleId },
      query: {
        include: ['inAppPurchasePricePoint', 'territory'] as any,
        limit: 200,
      } as any,
    });
    const manualRows = (manual.data?.data as any[]) ?? [];
    const priceRow = manualRows.find(
      (r: any) => r.relationships?.territory?.data?.id === baseTerritoryId,
    ) ?? manualRows[0];
    const pricePointId = priceRow?.relationships?.inAppPurchasePricePoint?.data?.id;
    const included = (manual.data?.included as any[]) ?? [];
    const pricePoint = included.find(
      (i: any) => i.type === 'inAppPurchasePricePoints' && i.id === pricePointId,
    );
    const customerPrice = pricePoint?.attributes?.customerPrice ?? '';

    return {
      schedule_id: scheduleId,
      base_territory: baseTerritoryId,
      base_price: customerPrice,
      base_currency: baseCurrency,
      price_point_id: pricePointId ?? '',
    };
  }

  /**
   * Find the IAP-scoped price point whose customer price matches
   * `targetPrice` in `territory`. The API exposes price points per-IAP
   * because each IAP can have its own tier of available points. Throws
   * when there's no match — caller surfaces that to the user.
   */
  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    targetPrice: string,
  ): Promise<string> {
    // The price-points endpoint is paged. We page until we find a match
    // or exhaust — Apple's list is ~50 tiers per territory so 200 covers
    // the realistic search space.
    const resp = await inAppPurchasesV2PricePointsGetToManyRelated({
      client: this.client,
      path: { id: iapId },
      query: {
        'filter[territory]': [territory],
        limit: 200,
      } as any,
    });
    const points = (resp.data?.data as any[]) ?? [];
    const match = points.find((p: any) => p.attributes?.customerPrice === targetPrice);
    if (!match) {
      const seen = points
        .map((p: any) => p.attributes?.customerPrice)
        .filter(Boolean)
        .slice(0, 12)
        .join(', ');
      throw new Error(
        `No IAP price point matches ${targetPrice} in ${territory}. ` +
        `First ${Math.min(12, points.length)} available tiers: ${seen || '(none)'}`,
      );
    }
    return match.id;
  }

  /**
   * Replace the IAP's price schedule with one whose base territory uses
   * the given price-point id. Apple auto-equalises every other territory
   * from this anchor. Mirrors ASC web UI's "Set Price for All Territories"
   * flow.
   */
  async createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritoryId: string,
    basePricePointId: string,
  ): Promise<string> {
    // ASC's schedule create takes the IAP id + a base territory ref + a
    // single `manualPrices` row that points at the chosen price point in
    // that territory. The body uses a client-supplied placeholder id
    // ("${manualPrice}") that ties the row to the schedule before it
    // exists on the server — that link is declared on the PARENT schedule
    // via `relationships.manualPrices`, not as a back-pointer on the price
    // row itself. ASC v3 rejects an `inAppPurchasePriceSchedule` relationship
    // on the included `inAppPurchasePrices` entry ("not a relationship on
    // the resource 'inAppPurchasePrices'") — see issue #2426. The price row
    // only carries its `inAppPurchasePricePoint` + `territory`, mirroring
    // the working `subscriptionPrices` shape used by createSubscriptionBasePrice.
    const priceRef = '${manualPrice}';
    const resp = await inAppPurchasePriceSchedulesCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'inAppPurchasePriceSchedules',
          relationships: {
            inAppPurchase: {
              data: { id: iapId, type: 'inAppPurchases' },
            },
            baseTerritory: {
              data: { id: baseTerritoryId, type: 'territories' },
            },
            manualPrices: {
              data: [{ id: priceRef, type: 'inAppPurchasePrices' }],
            },
          },
        },
        included: [
          {
            id: priceRef,
            type: 'inAppPurchasePrices',
            attributes: { startDate: null },
            relationships: {
              inAppPurchasePricePoint: {
                data: { id: basePricePointId, type: 'inAppPurchasePricePoints' },
              },
              territory: {
                data: { id: baseTerritoryId, type: 'territories' },
              },
            },
          },
        ],
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  /**
   * Get an IAP's territory availability — flag + sorted territory list.
   * Returns null when the API has no availability record yet.
   */
  async getInAppPurchaseAvailability(iapId: string): Promise<{
    availability_id: string;
    available_in_new_territories: boolean;
    territories: string[];
  } | null> {
    const resp = await inAppPurchasesV2InAppPurchaseAvailabilityGetToOneRelated({
      client: this.client,
      path: { id: iapId },
    });
    const availId = (resp.data?.data as any)?.id;
    if (!availId) return null;
    const flag = (resp.data?.data as any)?.attributes?.availableInNewTerritories ?? false;
    const territories = await this.listAllInAppPurchaseTerritories(availId);
    return {
      availability_id: availId,
      available_in_new_territories: !!flag,
      territories,
    };
  }

  /** Page through every available-territory row for an availability id. */
  private async listAllInAppPurchaseTerritories(availId: string): Promise<string[]> {
    const all: string[] = [];
    let cursor: string | undefined;
    // The endpoint is page-based; loop until the response carries no next.
    for (let safety = 0; safety < 20; safety++) {
      const resp = await inAppPurchaseAvailabilitiesAvailableTerritoriesGetToManyRelated({
        client: this.client,
        path: { id: availId },
        query: { limit: 200, cursor } as any,
      });
      const page = (resp.data?.data as any[]) ?? [];
      for (const t of page) all.push(t.id);
      cursor = (resp.data?.links as any)?.next
        ? new URL((resp.data!.links as any).next as string).searchParams.get('cursor') ?? undefined
        : undefined;
      if (!cursor) break;
    }
    all.sort();
    return all;
  }

  /**
   * Replace the IAP's availability with a new one. `territories` is the
   * full target list (the API takes the absolute set, not a diff); pass
   * null to keep the existing list (only flip the `availableInNewTerritories`
   * flag).
   */
  async createInAppPurchaseAvailability(
    iapId: string,
    availableInNewTerritories: boolean,
    territories: string[],
  ): Promise<string> {
    const resp = await inAppPurchaseAvailabilitiesCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'inAppPurchaseAvailabilities',
          attributes: { availableInNewTerritories },
          relationships: {
            inAppPurchase: {
              data: { id: iapId, type: 'inAppPurchases' },
            },
            availableTerritories: {
              data: territories.map((t) => ({ id: t, type: 'territories' })),
            },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  // -- Subscriptions ----------------------------------------------------------

  /**
   * Get the price summary for one subscription in its base territory.
   * Subscriptions don't have a schedule wrapper — they carry per-territory
   * prices directly. We surface the USA price (or the first one returned)
   * as the "base" for the YAML round-trip.
   */
  async getSubscriptionPriceSummary(subscriptionId: string): Promise<{
    base_territory: string;
    base_price: string;
    price_point_id: string;
  } | null> {
    const resp = await subscriptionsPricesGetToManyRelated({
      client: this.client,
      path: { id: subscriptionId },
      query: {
        include: ['subscriptionPricePoint', 'territory'] as any,
        limit: 200,
      } as any,
    });
    const prices = (resp.data?.data as any[]) ?? [];
    if (prices.length === 0) return null;

    // Prefer USA so the YAML round-trip is deterministic across products.
    const included = (resp.data?.included as any[]) ?? [];
    const findPoint = (pricePointId: string) =>
      included.find((i: any) => i.type === 'subscriptionPricePoints' && i.id === pricePointId);

    const findTerritoryOnPrice = (priceRow: any): string =>
      priceRow?.relationships?.territory?.data?.id ?? '';

    let chosen = prices.find((p: any) => findTerritoryOnPrice(p) === 'USA');
    if (!chosen) chosen = prices[0];

    const pricePointId = chosen.relationships?.subscriptionPricePoint?.data?.id ?? '';
    const point = findPoint(pricePointId);
    return {
      base_territory: findTerritoryOnPrice(chosen),
      base_price: point?.attributes?.customerPrice ?? '',
      price_point_id: pricePointId,
    };
  }

  /**
   * Look up the subscription price-point id whose customer price matches
   * `targetPrice` in `territory`.
   */
  async findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    targetPrice: string,
  ): Promise<string> {
    const resp = await subscriptionsPricePointsGetToManyRelated({
      client: this.client,
      path: { id: subscriptionId },
      query: {
        'filter[territory]': [territory],
        limit: 200,
      } as any,
    });
    const points = (resp.data?.data as any[]) ?? [];
    const match = points.find((p: any) => p.attributes?.customerPrice === targetPrice);
    if (!match) {
      const seen = points
        .map((p: any) => p.attributes?.customerPrice)
        .filter(Boolean)
        .slice(0, 12)
        .join(', ');
      throw new Error(
        `No subscription price point matches ${targetPrice} in ${territory}. ` +
        `First ${Math.min(12, points.length)} available tiers: ${seen || '(none)'}`,
      );
    }
    return match.id;
  }

  /**
   * Set a subscription's base territory price. Apple auto-equalises the
   * rest. The API requires a `preserveCurrentPrice = true` body flag if
   * the schedule should stay active for existing subscribers — we set
   * that to match how ASC web defaults.
   */
  async createSubscriptionBasePrice(
    subscriptionId: string,
    territoryId: string,
    pricePointId: string,
  ): Promise<string> {
    const resp = await subscriptionPricesCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionPrices',
          attributes: { startDate: null, preserveCurrentPrice: true },
          relationships: {
            subscription: {
              data: { id: subscriptionId, type: 'subscriptions' },
            },
            subscriptionPricePoint: {
              data: { id: pricePointId, type: 'subscriptionPricePoints' },
            },
            territory: {
              data: { id: territoryId, type: 'territories' },
            },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  /**
   * Re-broadcast a subscription's existing price in a territory WITH
   * `preserveCurrentPrice = false` — Apple's signal that existing
   * subscribers in this territory should be migrated to the new
   * schedule. Same shape as createSubscriptionBasePrice except for
   * the migration flag.
   *
   * Per-territory by design (Apple subscriptionPrices is keyed by
   * territory). Apple's auto-equalised tier system means the anchor
   * (USA) is what `iap sync` writes — migrating USA only affects USA
   * existing subscribers. Other territories have independent
   * schedules; if you've never explicitly set them, Apple's
   * derived-price machinery handles new buyers, and existing buyers
   * on those territories stay on whatever schedule they were signed
   * up under.
   *
   * Price-increase migrations go through Apple's standard customer
   * notification + consent flow; decreases auto-apply at next
   * billing. Apple picks the right policy based on the price delta.
   */
  async migrateSubscriptionBasePrice(
    subscriptionId: string,
    territoryId: string,
    pricePointId: string,
  ): Promise<string> {
    const resp = await subscriptionPricesCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionPrices',
          attributes: { startDate: null, preserveCurrentPrice: false },
          relationships: {
            subscription: {
              data: { id: subscriptionId, type: 'subscriptions' },
            },
            subscriptionPricePoint: {
              data: { id: pricePointId, type: 'subscriptionPricePoints' },
            },
            territory: {
              data: { id: territoryId, type: 'territories' },
            },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
  }

  /**
   * Get a subscription's territory availability — flag + sorted list.
   */
  async getSubscriptionAvailability(subscriptionId: string): Promise<{
    availability_id: string;
    available_in_new_territories: boolean;
    territories: string[];
  } | null> {
    const resp = await subscriptionsSubscriptionAvailabilityGetToOneRelated({
      client: this.client,
      path: { id: subscriptionId },
    });
    const availId = (resp.data?.data as any)?.id;
    if (!availId) return null;
    const flag = (resp.data?.data as any)?.attributes?.availableInNewTerritories ?? false;
    const territories = await this.listAllSubscriptionTerritories(availId);
    return {
      availability_id: availId,
      available_in_new_territories: !!flag,
      territories,
    };
  }

  private async listAllSubscriptionTerritories(availId: string): Promise<string[]> {
    const all: string[] = [];
    let cursor: string | undefined;
    for (let safety = 0; safety < 20; safety++) {
      const resp = await subscriptionAvailabilitiesAvailableTerritoriesGetToManyRelated({
        client: this.client,
        path: { id: availId },
        query: { limit: 200, cursor } as any,
      });
      const page = (resp.data?.data as any[]) ?? [];
      for (const t of page) all.push(t.id);
      cursor = (resp.data?.links as any)?.next
        ? new URL((resp.data!.links as any).next as string).searchParams.get('cursor') ?? undefined
        : undefined;
      if (!cursor) break;
    }
    all.sort();
    return all;
  }

  /** Replace a subscription's availability with a new record. */
  async createSubscriptionAvailability(
    subscriptionId: string,
    availableInNewTerritories: boolean,
    territories: string[],
  ): Promise<string> {
    const resp = await subscriptionAvailabilitiesCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'subscriptionAvailabilities',
          attributes: { availableInNewTerritories },
          relationships: {
            subscription: {
              data: { id: subscriptionId, type: 'subscriptions' },
            },
            availableTerritories: {
              data: territories.map((t) => ({ id: t, type: 'territories' })),
            },
          },
        },
      } as any,
    });
    throwIfError(resp);
    return (resp.data?.data as any)?.id ?? '';
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

  // ============================================================================
  // Builds
  // ============================================================================

  /**
   * List builds for the app
   */
  async listBuilds(options?: {
    limit?: number;
    version?: string;
    platform?: string;
  }): Promise<Build[]> {
    const query: Record<string, any> = {
      'filter[app]': [this.appId],
      'sort': ['-uploadedDate'],
    };

    if (options?.limit) {
      query['limit'] = options.limit;
    }

    if (options?.version) {
      query['filter[version]'] = [options.version];
    }

    if (options?.platform) {
      query['filter[processingState]'] = ['VALID'];
    }

    const response = await buildsGetCollection({
      client: this.client,
      query,
    });

    return (response.data?.data || []).map((b: any) => ({
      id: b.id,
      version: b.attributes?.version || '',
      buildNumber: b.attributes?.version || '',
      processingState: b.attributes?.processingState || '',
      uploadedDate: b.attributes?.uploadedDate || '',
      platform: b.attributes?.platform || '',
      minOsVersion: b.attributes?.minOsVersion || undefined,
    }));
  }

  // ============================================================================
  // Beta Groups
  // ============================================================================

  /**
   * List all beta tester groups for the app
   */
  async listBetaGroups(): Promise<BetaGroup[]> {
    const response = await betaGroupsGetCollection({
      client: this.client,
      query: {
        'filter[app]': [this.appId],
      },
    });

    return (response.data?.data || []).map((g: any) => ({
      id: g.id,
      name: g.attributes?.name || '',
      isInternalGroup: g.attributes?.isInternalGroup || false,
      publicLinkEnabled: g.attributes?.publicLinkEnabled || false,
    }));
  }

  /**
   * List builds assigned to a beta group
   */
  async getBetaGroupBuilds(groupId: string): Promise<Build[]> {
    const response = await betaGroupsBuildsGetToManyRelated({
      client: this.client,
      path: { id: groupId },
    });

    return (response.data?.data || []).map((b: any) => ({
      id: b.id,
      version: b.attributes?.version || '',
      buildNumber: b.attributes?.version || '',
      processingState: b.attributes?.processingState || '',
      uploadedDate: b.attributes?.uploadedDate || '',
      platform: b.attributes?.platform || '',
    }));
  }

  /**
   * Add a build to a beta tester group (promote)
   */
  async addBuildToBetaGroup(groupId: string, buildId: string): Promise<void> {
    const response = await betaGroupsBuildsCreateToManyRelationship({
      client: this.client,
      path: { id: groupId },
      body: {
        data: [
          {
            id: buildId,
            type: 'builds',
          },
        ],
      },
    });

    if (response.error) {
      const errors = (response.error as any).errors || [];
      const messages = errors.map((e: any) => e.detail || e.title).join('; ');
      throw new Error(`API error: ${messages || JSON.stringify(response.error)}`);
    }
  }

  /**
   * Set "What to Test" notes on a build (beta build localisation).
   * Updates existing localisation if one exists for the locale, otherwise creates new.
   */
  async setBetaBuildNotes(buildId: string, locale: string, whatsNew: string): Promise<void> {
    // Check if a localisation already exists for this build+locale
    const existing = await betaBuildLocalizationsGetCollection({
      client: this.client,
      query: {
        'filter[build]': [buildId],
        'filter[locale]': [locale],
      },
    });

    const existingLoc = (existing.data?.data || [])[0];

    if (existingLoc) {
      // Update existing
      const response = await betaBuildLocalizationsUpdateInstance({
        client: this.client,
        path: { id: existingLoc.id },
        body: {
          data: {
            id: existingLoc.id,
            type: 'betaBuildLocalizations',
            attributes: {
              whatsNew,
            },
          },
        },
      });

      if (response.error) {
        const errors = (response.error as any).errors || [];
        const messages = errors.map((e: any) => e.detail || e.title).join('; ');
        throw new Error(`API error updating beta notes: ${messages || JSON.stringify(response.error)}`);
      }
    } else {
      // Create new
      const response = await betaBuildLocalizationsCreateInstance({
        client: this.client,
        body: {
          data: {
            type: 'betaBuildLocalizations',
            attributes: {
              locale,
              whatsNew,
            },
            relationships: {
              build: {
                data: {
                  id: buildId,
                  type: 'builds',
                },
              },
            },
          },
        },
      });

      if (response.error) {
        const errors = (response.error as any).errors || [];
        const messages = errors.map((e: any) => e.detail || e.title).join('; ');
        throw new Error(`API error setting beta notes: ${messages || JSON.stringify(response.error)}`);
      }
    }
  }

  /**
   * Submit a build for beta app review (required for external testers)
   */
  async submitForBetaReview(buildId: string): Promise<void> {
    const response = await betaAppReviewSubmissionsCreateInstance({
      client: this.client,
      body: {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: {
            build: {
              data: {
                id: buildId,
                type: 'builds',
              },
            },
          },
        },
      },
    });

    if (response.error) {
      const errors = (response.error as any).errors || [];
      const messages = errors.map((e: any) => e.detail || e.title).join('; ');
      // Beta review submission may fail if already submitted — that's OK
      if (!messages.includes('already exists')) {
        throw new Error(`API error submitting for beta review: ${messages || JSON.stringify(response.error)}`);
      }
    }
  }
}

/**
 * Create a client instance
 */
export function createClient(keyName?: string): AppStoreClient {
  return AppStoreClient.create(keyName);
}

/**
 * Throw a JS Error from an App Store Connect API response that carries
 * a non-empty `error` envelope. Used by the IAP/sub localisation upsert
 * helpers so a caller can wrap one try/catch around the whole sync loop.
 */
function throwIfError(response: { error?: any }): void {
  if (!response.error) return;
  const errors = (response.error as any).errors || [];
  const messages = errors.map((e: any) => e.detail || e.title).filter(Boolean).join('; ');
  throw new Error(`App Store Connect API error: ${messages || JSON.stringify(response.error)}`);
}
