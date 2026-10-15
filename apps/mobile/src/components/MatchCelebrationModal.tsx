import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Image } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';

interface MatchCelebrationModalProps {
  visible: boolean;
  onClose: () => void;
  onSendMessage: () => void;
  targetName: string;
  targetPhoto?: string;
  myPhoto?: string;
}

export const MatchCelebrationModal: React.FC<MatchCelebrationModalProps> = ({
  visible,
  onClose,
  onSendMessage,
  targetName,
  targetPhoto,
  myPhoto,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.sparkleIcon}>✨</Text>
          <Text style={styles.title}>It&apos;s a Mutual Match</Text>
          <Text style={styles.subtitle}>You and {targetName} liked each other</Text>

          {/* Intersecting profile photos */}
          <View style={styles.avatarsRow}>
            <View style={[styles.avatarWrap, styles.avatarLeft]}>
              {myPhoto ? (
                <Image source={{ uri: myPhoto }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarMonogram}>You</Text>
                </View>
              )}
            </View>

            <View style={[styles.avatarWrap, styles.avatarRight]}>
              {targetPhoto ? (
                <Image source={{ uri: targetPhoto }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarMonogram}>{targetName.charAt(0)}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.buttonsContainer}>
            <TouchableOpacity style={styles.primaryButton} onPress={onSendMessage} activeOpacity={0.8}>
              <Text style={styles.primaryButtonText}>Send a Message</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.secondaryButtonText}>Keep Browsing</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 13, 18, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gold,
    padding: spacing.xxl,
    alignItems: 'center',
  },
  sparkleIcon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.gold,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  avatarsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xxl,
    height: 100,
  },
  avatarWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: colors.gold,
    overflow: 'hidden',
    backgroundColor: colors.backgroundElevated,
  },
  avatarLeft: {
    marginRight: -20,
    zIndex: 1,
  },
  avatarRight: {
    marginLeft: -20,
    zIndex: 2,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.cardMuted,
  },
  avatarMonogram: {
    ...typography.h2,
    color: colors.gold,
  },
  buttonsContainer: {
    width: '100%',
    gap: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.textInverse,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.textMuted,
  },
});
