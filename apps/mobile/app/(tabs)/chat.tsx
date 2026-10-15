import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius } from '../../src/theme';
import { Match, Conversation } from '../../src/types';
import { chatService } from '../../src/services/chat/chatService';
import { useAuth } from '../../src/context/AuthContext';
import { AgeVerificationBanner } from '../../src/components/AgeVerificationBanner';
import { SponsoredBannerAd } from '../../src/components/SponsoredBannerAd';

export default function ChatScreen() {
  const router = useRouter();
  const { isAgeVerified } = useAuth();

  const [matches, setMatches] = useState<Match[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [matchesRes, convsRes] = await Promise.all([
        chatService.getMatches(),
        chatService.getConversations(),
      ]);
      setMatches(matchesRes || []);
      setConversations(convsRes || []);
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const openConversation = (convId: string, participantName: string, participantId: string) => {
    router.push({
      pathname: '/chat/[id]',
      params: { id: convId, name: participantName, recipientId: participantId },
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>Chat</Text>
        <Text style={styles.subtitle}>Confidential & Encrypted</Text>
      </View>

      <SponsoredBannerAd testID="inbox-sponsored-banner" />

      {!isAgeVerified && (
        <AgeVerificationBanner onVerifyPress={() => router.push('/(auth)/verify-age')} />
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={styles.loadingText}>Loading inbox...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.gold}
              colors={[colors.gold]}
            />
          }
        >
          {/* New Mutual Matches Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Mutual Sparks</Text>
              {matches.length > 0 && (
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{matches.length}</Text>
                </View>
              )}
            </View>

            {matches.length === 0 ? (
              <Text style={styles.emptyText}>
                No pending matches. Keep discovering to ignite new mutual sparks.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.matchesRow}
              >
                {matches.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.matchItem}
                    onPress={() => openConversation(m.id, m.target_profile.display_name, m.target_profile.user_id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.matchAvatarWrap}>
                      {m.target_profile.avatar_url ? (
                        <Image source={{ uri: m.target_profile.avatar_url }} style={styles.matchAvatar} />
                      ) : (
                        <View style={[styles.matchAvatar, styles.avatarPlaceholder]}>
                          <Text style={styles.monogramText}>{m.target_profile.display_name.charAt(0)}</Text>
                        </View>
                      )}
                      {m.target_profile.is_verified && (
                        <View style={styles.verifiedDot}>
                          <Text style={styles.verifiedDotText}>✓</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.matchName} numberOfLines={1}>
                      {m.target_profile.display_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          {/* Conversations Inbox */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Messages</Text>

            {conversations.length === 0 ? (
              <View style={styles.emptyInboxCard}>
                <View style={styles.emptyInboxIconCircle}>
                  <Text style={styles.emptyInboxIcon}>💬</Text>
                </View>
                <Text style={styles.emptyInboxTitle}>Your Inbox is Quiet</Text>
                <Text style={styles.emptyInboxBody}>
                  Conversations become available when both members like each other. Swipe right in Discover to find your match!
                </Text>
                <TouchableOpacity
                  style={styles.discoverBtn}
                  onPress={() => router.push('/(tabs)')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.discoverBtnText}>Explore Discover</Text>
                </TouchableOpacity>
              </View>
            ) : (
              conversations.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.conversationItem}
                  onPress={() => openConversation(c.id, c.participant_name, c.participant_id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.convAvatarWrap}>
                    {c.participant_avatar ? (
                      <Image source={{ uri: c.participant_avatar }} style={styles.convAvatar} />
                    ) : (
                      <View style={[styles.convAvatar, styles.avatarPlaceholder]}>
                        <Text style={styles.monogramText}>{c.participant_name.charAt(0)}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.convInfo}>
                    <View style={styles.convHeaderRow}>
                      <Text style={styles.convName}>{c.participant_name}</Text>
                      {c.last_message && (
                        <Text style={styles.convTime}>
                          {new Date(c.last_message.created_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.convLastMessage} numberOfLines={1}>
                      {c.last_message ? c.last_message.content : 'Matched! Say hello.'}
                    </Text>
                  </View>

                  {c.unread_count > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{c.unread_count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    letterSpacing: 1,
  },
  subtitle: {
    ...typography.caption,
    color: colors.gold,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  section: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    fontSize: 17,
  },
  countPill: {
    backgroundColor: colors.goldMuted,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  countPillText: {
    ...typography.caption,
    color: colors.gold,
    fontWeight: '700',
    fontSize: 10,
  },
  emptyText: {
    ...typography.bodySmall,
    color: colors.textSubtle,
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  matchesRow: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  matchItem: {
    alignItems: 'center',
    width: 68,
  },
  matchAvatarWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: colors.gold,
    position: 'relative',
    marginBottom: 6,
  },
  matchAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 29,
  },
  avatarPlaceholder: {
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monogramText: {
    ...typography.h3,
    color: colors.gold,
  },
  verifiedDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.emerald,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  verifiedDotText: {
    fontSize: 10,
    color: colors.textInverse,
    fontWeight: '700',
  },
  matchName: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  convAvatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginRight: spacing.md,
  },
  convAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
  },
  convInfo: {
    flex: 1,
  },
  convHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  convName: {
    ...typography.bodyLarge,
    fontWeight: '600',
    color: colors.text,
  },
  convTime: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textSubtle,
  },
  convLastMessage: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  unreadBadge: {
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: spacing.sm,
  },
  unreadBadgeText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textInverse,
    fontWeight: '700',
  },
  emptyInboxCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: spacing.sm,
  },
  emptyInboxIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyInboxIcon: {
    fontSize: 26,
  },
  emptyInboxTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyInboxBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  discoverBtn: {
    backgroundColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
  },
  discoverBtnText: {
    ...typography.button,
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 12,
  },
});
