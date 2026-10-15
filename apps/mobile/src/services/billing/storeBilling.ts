import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import { api, ApiError } from '../api/client';
import { BillingPlan, EntitlementsResponse, Subscription } from '../../types';

export interface StoreProduct {
  productId: string;
  planCode: string;
  title: string;
  description: string;
  priceString: string;
  priceCents: number;
  currency: string;
  tier: 'PLUS' | 'BLACK';
  billingPeriod: 'MONTHLY' | 'ANNUAL';
}

export interface PurchaseResult {
  success: boolean;
  transactionId?: string;
  entitlements?: EntitlementsResponse;
  statusMessage?: string;
}

export interface StorefrontBillingPolicy {
  platform: string;
  storefront: string;
  supported_billing_methods: string[];
  preferred_method: string;
  external_checkout_permitted: boolean;
  external_checkout_url?: string;
  disclosure_notice: string;
  requires_choice_screen: boolean;
  program_enrollment_status: string;
}

export const storeBilling = {
  /**
   * Fetches the authoritative storefront-aware billing policy for the user's platform and region
   */
  async getStorefrontPolicy(
    storefront = 'US',
    hasExternalEntitlement = false
  ): Promise<StorefrontBillingPolicy> {
    try {
      const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
      return await api.get<StorefrontBillingPolicy>(
        `/api/v1/billing/policy?platform=${platform}&storefront=${storefront}&has_external_purchase_entitlement=${hasExternalEntitlement}`
      );
    } catch {
      return {
        platform: Platform.OS,
        storefront,
        supported_billing_methods: Platform.OS === 'ios' ? ['APPLE_IAP'] : ['GOOGLE_PLAY_BILLING'],
        preferred_method: Platform.OS === 'ios' ? 'APPLE_IAP' : 'GOOGLE_PLAY_BILLING',
        external_checkout_permitted: false,
        disclosure_notice: 'In-app purchases are securely managed through your native store account.',
        requires_choice_screen: false,
        program_enrollment_status: 'STANDARD',
      };
    }
  },

  /**
   * Initializes native StoreKit / Google Play Billing connection
   */
  async initializeIAP(): Promise<boolean> {
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        await RNIap.initConnection();
      }
      return true;
    } catch (err) {
      console.warn('[storeBilling] initConnection failed:', err);
      return false;
    }
  },

  /**
   * Closes store connection cleanly
   */
  async endIAP(): Promise<void> {
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        await RNIap.endConnection();
      }
    } catch {
      // ignore
    }
  },
  /**
   * Fetches published billing plans from authoritative Go backend catalog.
   * Normalizes response whether returned as { plans: BillingPlan[], count: number } or BillingPlan[].
   * Handles empty, malformed, or network-error states without crashing.
   * Never invents plans, prices, or entitlements.
   */
  async getAvailablePlans(): Promise<BillingPlan[]> {
    try {
      const response = await api.get<BillingPlan[] | { plans?: BillingPlan[]; count?: number }>('/api/v1/billing/plans');
      if (Array.isArray(response)) {
        return response.filter((p): p is BillingPlan => Boolean(p && typeof p === 'object' && p.plan_code));
      }
      if (response && typeof response === 'object' && Array.isArray((response as any).plans)) {
        return (response as any).plans.filter((p: any): p is BillingPlan => Boolean(p && typeof p === 'object' && p.plan_code));
      }
      return [];
    } catch {
      return [];
    }
  },

  /**
   * Fetches active entitlements directly from backend.
   * Client NEVER assumes entitlements based on local state.
   */
  async getActiveEntitlements(): Promise<EntitlementsResponse> {
    return api.get<EntitlementsResponse>('/api/v1/billing/entitlements');
  },

  /**
   * Submits store receipt to backend for server-side verification with Apple/Google.
   */
  async verifyStorePurchase(
    planCode: string,
    transactionId: string,
    receiptData = ''
  ): Promise<PurchaseResult> {
    const provider = Platform.OS === 'ios' ? 'APPLE_APP_STORE' : 'GOOGLE_PLAY';

    try {
      const response = await api.post<{
        verified: boolean;
        transaction?: Record<string, unknown>;
      }>('/api/v1/billing/verify', {
        provider,
        plan_code: planCode,
        external_transaction_id: transactionId,
        receipt_data: receiptData,
      });

      if (response.verified) {
        // Fetch newly granted entitlements
        const entitlements = await this.getActiveEntitlements();
        return {
          success: true,
          transactionId,
          entitlements,
          statusMessage: 'Subscription successfully verified by backend.',
        };
      }

      return {
        success: false,
        statusMessage: 'Purchase could not be verified by server.',
      };
    } catch (err) {
      if (err instanceof ApiError) {
        return {
          success: false,
          statusMessage: err.message,
        };
      }
      return {
        success: false,
        statusMessage: 'Payment verification failed due to network error.',
      };
    }
  },

  /**
   * Activates a profile boost multiplier (consumes 1 credit)
   */
  async activateBoost(durationMinutes = 30): Promise<{ success: boolean; creditsRemaining: number }> {
    const response = await api.post<{
      boost: { id: string; duration_minutes: number; multiplier: number };
      credits_remaining: number;
    }>('/api/v1/boosts/activate', {
      duration_minutes: durationMinutes,
    });

    return {
      success: true,
      creditsRemaining: response.credits_remaining,
    };
  },

  /**
   * Fetches the current user subscription details
   */
  async getSubscription(): Promise<Subscription | null> {
    try {
      const res = await api.get<{ subscription?: Subscription }>('/api/v1/billing/subscription');
      return res.subscription || null;
    } catch {
      return null;
    }
  },

  /**
   * Cancels subscription renewal at period end
   */
  async cancelSubscriptionRenewal(): Promise<boolean> {
    await api.post('/api/v1/billing/subscription/cancel');
    return true;
  },

  /**
   * Initiates native StoreKit (iOS) or Google Play Billing (Android) subscription purchase.
   * Enforces server-authoritative receipt verification before granting entitlements.
   */
  async requestSubscriptionPurchase(sku: string, planCode: string): Promise<PurchaseResult> {
    try {
      await this.initializeIAP();
      let purchase: RNIap.SubscriptionPurchase | null = null;

      if (Platform.OS === 'ios') {
        const result = await RNIap.requestSubscription({ sku });
        purchase = Array.isArray(result) ? result[0] : (result as RNIap.SubscriptionPurchase);
      } else if (Platform.OS === 'android') {
        const result = await RNIap.requestSubscription({
          subscriptionOffers: [{ sku, offerToken: '' }],
        });
        purchase = Array.isArray(result) ? result[0] : (result as RNIap.SubscriptionPurchase);
      } else {
        // Fallback for mock/test runs
        return this.verifyStorePurchase(planCode, `mock_tx_${Date.now()}`, 'mock_receipt');
      }

      if (!purchase) {
        return { success: false, statusMessage: 'User cancelled or purchase failed.' };
      }

      const receipt = purchase.transactionReceipt || '';
      const txId = purchase.transactionId || `tx_${Date.now()}`;

      // Server-side verification with authoritative Go backend
      const verifyResult = await this.verifyStorePurchase(planCode, txId, receipt);

      // Finish transaction on client store
      try {
        await RNIap.finishTransaction({ purchase, isConsumable: false });
      } catch (finishErr) {
        console.warn('[storeBilling] finishTransaction warning:', finishErr);
      }

      return verifyResult;
    } catch (err: unknown) {
      return {
        success: false,
        statusMessage: err instanceof Error ? err.message : 'Subscription purchase failed.',
      };
    }
  },

  /**
   * Initiates native consumable purchase (e.g. Boost pack)
   */
  async requestConsumablePurchase(sku: string, planCode: string): Promise<PurchaseResult> {
    try {
      await this.initializeIAP();
      let purchase: RNIap.ProductPurchase | null = null;

      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        const result = await RNIap.requestPurchase({ skus: [sku] });
        purchase = Array.isArray(result) ? result[0] : (result as RNIap.ProductPurchase);
      } else {
        return this.verifyStorePurchase(planCode, `mock_tx_${Date.now()}`, 'mock_receipt');
      }

      if (!purchase) {
        return { success: false, statusMessage: 'User cancelled or purchase failed.' };
      }

      const receipt = purchase.transactionReceipt || '';
      const txId = purchase.transactionId || `tx_${Date.now()}`;

      const verifyResult = await this.verifyStorePurchase(planCode, txId, receipt);

      try {
        await RNIap.finishTransaction({ purchase, isConsumable: true });
      } catch (finishErr) {
        console.warn('[storeBilling] finishTransaction warning:', finishErr);
      }

      return verifyResult;
    } catch (err: unknown) {
      return {
        success: false,
        statusMessage: err instanceof Error ? err.message : 'Consumable purchase failed.',
      };
    }
  },
};
