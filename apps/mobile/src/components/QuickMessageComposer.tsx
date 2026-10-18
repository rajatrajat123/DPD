import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { colors, typography, spacing, borderRadius, useTheme } from '../theme';
import { DiscoveryMessagingQuota } from '../types';

interface QuickMessageComposerProps {
  recipientId?: string;
  recipientName: string;
  onSend: (message: string) => Promise<void> | void;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  quota?: DiscoveryMessagingQuota | null;
  onQuotaPress?: () => void;
  placeholder?: string;
  inputTestID?: string;
  sendBtnTestID?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

export const QuickMessageComposer: React.FC<QuickMessageComposerProps> = ({
  recipientId,
  recipientName,
  onSend,
  disabled = false,
  onFocus,
  onBlur,
  quota,
  onQuotaPress,
  placeholder,
  inputTestID = 'quick-message-input',
  sendBtnTestID = 'quick-message-send-btn',
  containerStyle,
}) => {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Clear draft only when active recipient changes
  useEffect(() => {
    setText('');
  }, [recipientId || recipientName]);

  const trimmed = text.trim();
  const charLimit = 500;
  const isLocked = Boolean(quota?.is_locked && !quota?.is_unlimited);
  const canSend = trimmed.length > 0 && trimmed.length <= charLimit && !isSending && !disabled;

  const handleSend = async () => {
    if (isLocked) {
      if (onQuotaPress) onQuotaPress();
      return;
    }
    if (!canSend) return;
    setIsSending(true);
    const draftText = trimmed;
    try {
      await onSend(draftText);
      setText('');
      Keyboard.dismiss();
    } catch (err) {
      // Strictly preserve draft on network or quota send failures
      setText(draftText);
      console.warn('Failed to send intro note, draft preserved:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {isLocked && (
        <TouchableOpacity
          style={[styles.quotaIndicator, { backgroundColor: 'rgba(212,175,55,0.12)', borderColor: colors.gold }]}
          onPress={onQuotaPress}
          activeOpacity={0.7}
          testID="composer-quota-locked-indicator"
        >
          <Text style={[styles.quotaIndicatorText, { color: colors.gold }]}>
            🔒 Limit Reached · {quota?.can_unlock_with_ad ? 'Watch Ad to Unlock' : 'Limit Active'}
          </Text>
        </TouchableOpacity>
      )}
      {!isLocked && !quota?.is_unlimited && quota?.is_in_trial && (
        <View
          style={[styles.quotaIndicator, { backgroundColor: 'rgba(212,175,55,0.08)', borderColor: 'rgba(212,175,55,0.3)' }]}
          testID="composer-quota-trial-indicator"
        >
          <Text style={[styles.quotaIndicatorText, { color: colors.gold }]}>
            ✦ Trial: {quota.trial_initiations_remaining ?? quota.free_slots_remaining ?? 0} of {quota.trial_initiations_allowed ?? 4} Discovery initiations left
          </Text>
        </View>
      )}
      {!isLocked && !quota?.is_in_trial && quota?.ad_unlocked && (quota.bonus_slots_remaining ?? 0) > 0 && (
        <View
          style={[styles.quotaIndicator, { backgroundColor: 'rgba(212,175,55,0.08)', borderColor: 'rgba(212,175,55,0.3)' }]}
          testID="composer-quota-bonus-indicator"
        >
          <Text style={[styles.quotaIndicatorText, { color: colors.gold }]}>
            ✦ {quota.bonus_slots_remaining} bonus intro note{quota.bonus_slots_remaining > 1 ? 's' : ''} available
          </Text>
        </View>
      )}
      <View style={styles.inputRow}>
      <View style={[styles.inputWrapper, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={text}
          onChangeText={setText}
          onFocus={onFocus}
          onBlur={onBlur}
          autoFocus={false}
          placeholder={placeholder || (recipientName ? `Intro note for ${recipientName}...` : 'Write an intro message...')}
          placeholderTextColor={colors.textSubtle}
          maxLength={charLimit}
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!isSending && !disabled}
          testID={inputTestID} /* testID="quick-message-input" */
        />
        {text.length > 0 && (
          <Text style={[styles.charCount, { color: colors.textSubtle }]}>
            {text.length}/{charLimit}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={[
          styles.sendButton,
          canSend
            ? [styles.sendButtonActive, { backgroundColor: colors.gold, shadowColor: colors.gold }]
            : [styles.sendButtonDisabled, { backgroundColor: colors.cardElevated, borderColor: colors.borderSubtle }],
        ]}
        onPress={handleSend}
        disabled={!canSend}
        activeOpacity={0.8}
        testID={sendBtnTestID} /* testID="quick-message-send-btn" */
        accessibilityRole="button"
        accessibilityLabel="Send Intro Note"
      >
        {isSending ? (
          <ActivityIndicator size="small" color={colors.textInverse || "#FFFFFF"} />
        ) : (
          <Text
            style={[
              styles.sendIcon,
              canSend ? styles.sendIconActive : [styles.sendIconDisabled, { color: colors.textSubtle }],
            ]}
          >
            ➤
          </Text>
        )}
      </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    width: '100%',
  },
  quotaIndicator: {
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginBottom: 4,
    alignSelf: 'center',
  },
  quotaIndicatorText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E232B',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: spacing.md,
    height: 42,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
  },
  charCount: {
    fontSize: 10,
    color: colors.textSubtle,
    marginLeft: spacing.xs,
  },
  sendButton: {
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  sendButtonActive: {
    backgroundColor: colors.gold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  sendButtonDisabled: {
    backgroundColor: '#1E232B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sendIcon: {
    fontSize: 16,
  },
  sendIconActive: {
    color: '#090A0E',
  },
  sendIconDisabled: {
    color: colors.textSubtle,
  },
});
