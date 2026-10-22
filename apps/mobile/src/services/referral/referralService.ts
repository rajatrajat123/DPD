import { Share, Platform } from 'react-native';
import { api } from '../api/client';
import { UserReferralStatus } from '../../types';

export const referralService = {
  /**
   * Fetches the current user's referral code, invite URL, verified referral counts,
   * reward milestones, and active reward entitlement status.
   */
  async getMyReferralStatus(): Promise<UserReferralStatus> {
    return await api.get<UserReferralStatus>('/api/v1/referrals/me');
  },

  /**
   * Requests a fresh server-side evaluation of referral rewards and returns
   * the updated status.
   */
  async refreshReferralStatus(): Promise<UserReferralStatus> {
    return await api.post<UserReferralStatus>('/api/v1/referrals/refresh');
  },

  /**
   * Copies the user's referral code or shares it. On web uses navigator.clipboard,
   * on native mobile triggers native share sheet.
   */
  async copyOrShareCode(code: string, inviteUrl: string): Promise<boolean> {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).clipboard) {
        await (navigator as any).clipboard.writeText(code);
        return true;
      }
      return await this.shareInviteLink(code, inviteUrl);
    } catch {
      return false;
    }
  },

  /**
   * Opens the native share dialog with the user's invite link and referral code.
   */
  async shareInviteLink(code: string, inviteUrl: string): Promise<boolean> {
    try {
      const shareUrl = inviteUrl || `https://auradating.com/join?ref=${code}`;
      const message = `Join me on Aura LGBTQ+ Dating! Use my invite code ${code} or click: ${shareUrl}`;
      const result = await Share.share({
        title: 'Join me on Aura Dating',
        message,
        url: shareUrl,
      });
      return result.action === Share.sharedAction;
    } catch {
      return false;
    }
  },
};
