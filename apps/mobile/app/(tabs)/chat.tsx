import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { colors, typography, spacing, borderRadius, useTheme } from '../../src/theme';
import { Match, Conversation, MessageRequest } from '../../src/types';
import { chatService } from '../../src/services/chat/chatService';
import { useAuth } from '../../src/context/AuthContext';
import { AgeVerificationBanner } from '../../src/components/AgeVerificationBanner';
import { SponsoredBannerAd } from '../../src/components/SponsoredBannerAd';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MATCH_CARD_WIDTH = Math.floor((SCREEN_WIDTH - spacing.lg * 2 - spacing.md) / 2);

export type ChatTab = 'matches' | 'messages' | 'requests';

export interface ChatScreenProps {
  initialTab?: ChatTab;
}

export function formatMatchTime(dateStr?: string): string {
  if (!dateStr) return 'Recently matched';
  try {
    const matchedTime = new Date(dateStr).getTime();
    const now = Date.now();
    const diffSec = Math.floor((now - matchedTime) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently matched';
  }
}

export default function ChatScreen({ initialTab }: ChatScreenProps = {}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { isAgeVerified, user } = useAuth();
  const { colors } = useTheme();

  const [activeTab, setActiveTab] = useState<ChatTab>(() => {
    if (initialTab) return initialTab;
    if (params?.tab === 'messages' || params?.tab === 'requests' || params?.tab === 'matches') {
      return params.tab as ChatTab;
    }
    return 'matches';
  });

  const [matches, setMatches] = useState<Match[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messageRequests, setMessageRequests] = useState<MessageRequest[]>([]);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (params?.tab === 'messages' || params?.tab === 'requests' || params?.tab === 'matches') {
      setActiveTab(params.tab as ChatTab);
    }
  }, [params?.tab]);

  const loadData = useCallback(async () => {
    try {
      if (user?.id) {
        chatService.setCurrentUserId(user.id);
      }
      const [matchesRes, convsRes, requestsRes] = await Promise.all([
        chatService.getMatches(),
        chatService.getConversations(user?.id),
        chatService.getMessageRequests().catch(() => []),
      ]);

      // Deduplicate genuine mutual matches by target user ID to prevent duplicates
      const seenMatchUsers = new Set<string>();
      const dedupedMatches: Match[] = [];
      for (const m of (matchesRes || [])) {
        const uid = m.target_profile?.user_id || m.target_user_id || m.id;
        if (uid && !seenMatchUsers.has(uid)) {
          seenMatchUsers.add(uid);
          dedupedMatches.push(m);
        }
      }
      setMatches(dedupedMatches);

      // Deduplicate conversations by conversation ID or match ID
      const seenConvIds = new Set<string>();
      const dedupedConvs: Conversation[] = [];
      for (const c of (convsRes || [])) {
        const cid = c.id || c.match_id;
        if (cid && !seenConvIds.has(cid)) {
          seenConvIds.add(cid);
          dedupedConvs.push(c);
        }
      }
      setConversations(dedupedConvs);
      setMessageRequests(requestsRes || []);
    } catch {
      // Handled
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    const unsub = chatService.onUnreadCountChange((_total, changedConvId) => {
      if (changedConvId) {
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id === changedConvId || c.match_id === changedConvId) {
              return {
                ...c,
                unread_count: chatService.getConversationUnreadCount(changedConvId),
              };
            }
            return c;
          })
        );
      } else {
        setConversations((prev) =>
          prev.map((c) => ({
            ...c,
            unread_count: chatService.getConversationUnreadCount(c.id),
          }))
        );
      }
    });
    return unsub;
  }, []);

  const onRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const handleAcceptRequest = async (req: MessageRequest) => {
    setProcessingRequestId(req.id);
    try {
      const res = await chatService.acceptMessageRequest(req.id);
      setMessageRequests((prev) => prev.filter((r) => r.id !== req.id));
      await loadData();
      if (res.conversation_id) {
        router.push({
          pathname: '/chat/[id]',
          params: {
            id: res.conversation_id,
            name: req.sender_name || 'Member',
            recipientId: req.sender_id,
            avatar: req.sender_avatar || '',
          },
        });
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not accept message request.');
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleDeclineRequest = async (req: MessageRequest) => {
    setProcessingRequestId(req.id);
    try {
      await chatService.declineMessageRequest(req.id);
      setMessageRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not decline message request.');
    } finally {
      setProcessingRequestId(null);
    }
  };

  const handleBlockRequest = async (req: MessageRequest) => {
    Alert.alert(
      'Block Member?',
      `Are you sure you want to block ${req.sender_name || 'this member'}? They will no longer be able to message you or view your profile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setProcessingRequestId(req.id);
            try {
              await chatService.blockMessageRequest(req.id);
              setMessageRequests((prev) => prev.filter((r) => r.id !== req.id));
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not block member.');
            } finally {
              setProcessingRequestId(null);
            }
          },
        },
      ]
    );
  };

  const openConversation = (convId: string, participantName: string, participantId: string, participantAvatar?: string) => {
    chatService.markConversationAsRead(convId);
    setConversations((prev) =>
      prev.map((c) => (c.id === convId || c.match_id === convId ? { ...c, unread_count: 0 } : c))
    );
    router.push({
      pathname: '/chat/[id]',
      params: {
        id: convId,
        name: participantName,
        recipientId: participantId,
        avatar: participantAvatar || '',
      },
    });
  };

  const handleMatchPress = (m: Match) => {
    const targetId = m.target_profile?.user_id || m.target_user_id;
    const targetName = m.target_profile?.display_name || 'Member';
    const targetAvatar = m.target_profile?.avatar_url || '';

    // Reuse existing conversation if already created for this match to prevent duplicates
    const existingConv = conversations.find(
      (c) => c.match_id === m.id || (targetId && c.participant_id === targetId)
    );

    const convId = existingConv ? existingConv.id : m.id;
    openConversation(convId, targetName, targetId, targetAvatar);
  };

  const totalUnreadMessages = useMemo(() => {
    return conversations.reduce((acc, c) => acc + (c.unread_count || 0), 0);
  }, [conversations]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.borderSubtle }]}>
        <Text style={[styles.title, { color: colors.text }]}>Chat</Text>
        <Text style={[styles.subtitle, { color: colors.gold }]}>Confidential & Encrypted</Text>
      </View>

      <SponsoredBannerAd testID="inbox-sponsored-banner" />

      {!isAgeVerified && (
        <AgeVerificationBanner onVerifyPress={() => router.push('/(auth)/verify-age')} />
      )}

      {/* Segmented Navigation Bar */}
      <View
        style={[styles.segmentedContainer, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}
        testID="chat-segmented-navigation"
      >
        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeTab === 'matches' && [styles.segmentBtnActive, { backgroundColor: colors.goldMuted, borderColor: colors.gold }],
          ]}
          onPress={() => setActiveTab('matches')}
          activeOpacity={0.75}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'matches' }}
          testID="chat-tab-matches"
        >
          <Text
            style={[
              styles.segmentBtnText,
              { color: activeTab === 'matches' ? colors.gold : colors.textMuted },
            ]}
          >
            Matches
          </Text>
          {matches.length > 0 && (
            <View
              style={[
                styles.segmentBadge,
                { backgroundColor: activeTab === 'matches' ? colors.gold : colors.goldMuted },
              ]}
            >
              <Text
                style={[
                  styles.segmentBadgeText,
                  { color: activeTab === 'matches' ? colors.textInverse : colors.gold },
                ]}
              >
                {matches.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeTab === 'messages' && [styles.segmentBtnActive, { backgroundColor: colors.goldMuted, borderColor: colors.gold }],
          ]}
          onPress={() => setActiveTab('messages')}
          activeOpacity={0.75}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'messages' }}
          testID="chat-tab-messages"
        >
          <Text
            style={[
              styles.segmentBtnText,
              { color: activeTab === 'messages' ? colors.gold : colors.textMuted },
            ]}
          >
            Messages
          </Text>
          {totalUnreadMessages > 0 ? (
            <View style={[styles.segmentBadge, { backgroundColor: colors.gold }]}>
              <Text style={[styles.segmentBadgeText, { color: colors.textInverse }]}>
                {totalUnreadMessages}
              </Text>
            </View>
          ) : conversations.length > 0 ? (
            <View style={[styles.segmentBadgeSubtle, { backgroundColor: colors.cardElevated }]}>
              <Text style={[styles.segmentBadgeSubtleText, { color: colors.textMuted }]}>
                {conversations.length}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.segmentBtn,
            activeTab === 'requests' && [styles.segmentBtnActive, { backgroundColor: colors.goldMuted, borderColor: colors.gold }],
          ]}
          onPress={() => setActiveTab('requests')}
          activeOpacity={0.75}
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'requests' }}
          testID="chat-tab-requests"
        >
          <Text
            style={[
              styles.segmentBtnText,
              { color: activeTab === 'requests' ? colors.gold : colors.textMuted },
            ]}
          >
            Requests
          </Text>
          {messageRequests.length > 0 && (
            <View style={[styles.segmentBadge, { backgroundColor: colors.ruby || '#E53E3E' }]}>
              <Text style={[styles.segmentBadgeText, { color: '#FFFFFF' }]}>
                {messageRequests.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

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
          {/* ===================== MATCHES TAB ===================== */}
          {activeTab === 'matches' && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Mutual Sparks</Text>
                {matches.length > 0 && (
                  <View style={[styles.countPill, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                    <Text style={[styles.countPillText, { color: colors.gold }]}>{matches.length}</Text>
                  </View>
                )}
              </View>

              {matches.length === 0 ? (
                <View style={[styles.emptyMatchesCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
                  <View style={[styles.emptyMatchesIconCircle, { backgroundColor: colors.cardElevated }]}>
                    <Text style={styles.emptyMatchesIcon}>✨</Text>
                  </View>
                  <Text style={[styles.emptyMatchesTitle, { color: colors.text }]}>No Matches Yet</Text>
                  <Text style={[styles.emptyMatchesBody, { color: colors.textMuted }]}>
                    When both you and another member like each other, your mutual sparks will appear here. Keep exploring to ignite new connections!
                  </Text>
                  <TouchableOpacity
                    style={[styles.discoverBtn, { backgroundColor: colors.gold }]}
                    onPress={() => router.push('/(tabs)')}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.discoverBtnText, { color: colors.textInverse }]}>Explore Discover</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Top quick horizontal carousel */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.matchesRow}
                  >
                    {matches.map((m) => (
                      <TouchableOpacity
                        key={`sparks-carousel-${m.id}`}
                        style={styles.matchItem}
                        onPress={() =>
                          openConversation(
                            m.id,
                            m.target_profile?.display_name || 'Member',
                            m.target_profile?.user_id || m.target_user_id,
                            m.target_profile?.avatar_url || ''
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <View style={[styles.matchAvatarWrap, { borderColor: colors.gold }]}>
                          {m.target_profile?.avatar_url ? (
                            <Image source={{ uri: m.target_profile.avatar_url }} style={styles.matchAvatar} />
                          ) : (
                            <View style={[styles.matchAvatar, styles.avatarPlaceholder, { backgroundColor: colors.card }]}>
                              <Text style={[styles.monogramText, { color: colors.gold }]}>
                                {m.target_profile?.display_name ? m.target_profile.display_name.charAt(0) : 'M'}
                              </Text>
                            </View>
                          )}
                          {m.target_profile?.is_verified && (
                            <View style={styles.verifiedDot}>
                              <Text style={styles.verifiedDotText}>✓</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.matchName} numberOfLines={1}>
                          {m.target_profile?.display_name || 'Member'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Dedicated 2-Column Matches Grid */}
                  <View style={styles.matchesGridHeader}>
                    <Text style={[styles.matchesGridTitle, { color: colors.text }]}>All Matches</Text>
                    <Text style={[styles.matchesGridSubtitle, { color: colors.textMuted }]}>
                      Tap a member to chat
                    </Text>
                  </View>

                  <View style={styles.matchGrid}>
                    {matches.map((m) => (
                      <TouchableOpacity
                        key={`match-card-${m.id}`}
                        style={[styles.matchCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}
                        onPress={() => handleMatchPress(m)}
                        activeOpacity={0.85}
                      >
                        <View style={styles.matchCardImageContainer}>
                          {m.target_profile?.avatar_url ? (
                            <Image
                              source={{ uri: m.target_profile.avatar_url }}
                              style={styles.matchCardImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={[styles.matchCardImage, styles.avatarPlaceholder, { backgroundColor: colors.cardElevated }]}>
                              <Text style={[styles.matchCardMonogram, { color: colors.gold }]}>
                                {m.target_profile?.display_name ? m.target_profile.display_name.charAt(0) : 'M'}
                              </Text>
                            </View>
                          )}
                          {m.target_profile?.is_verified && (
                            <View style={styles.cardVerifiedBadge}>
                              <Text style={styles.cardVerifiedBadgeText}>✓ Verified</Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.matchCardInfo}>
                          <View style={styles.matchCardNameRow}>
                            <Text style={[styles.matchCardName, { color: colors.text }]} numberOfLines={1}>
                              {m.target_profile?.display_name || 'Member'}{m.target_profile?.age ? `, ${m.target_profile.age}` : ''}
                            </Text>
                          </View>

                          <Text style={[styles.matchCardMatchedTime, { color: colors.gold }]}>
                            {formatMatchTime(m.matched_at)}
                          </Text>

                          {Boolean(m.target_profile?.bio) && (
                            <Text style={[styles.matchCardBio, { color: colors.textMuted }]} numberOfLines={1}>
                              {m.target_profile?.bio}
                            </Text>
                          )}

                          <TouchableOpacity
                            style={[styles.matchCardActionBtn, { backgroundColor: colors.gold }]}
                            onPress={() => handleMatchPress(m)}
                            activeOpacity={0.85}
                          >
                            <Text style={[styles.matchCardActionBtnText, { color: colors.textInverse }]}>
                              Message
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* ===================== MESSAGES TAB ===================== */}
          {activeTab === 'messages' && (
            <View style={styles.section}>
              {/* Quick Sparks bar above conversation list */}
              {matches.length > 0 && (
                <View style={styles.messagesSparksSection}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Mutual Sparks</Text>
                    <View style={[styles.countPill, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                      <Text style={[styles.countPillText, { color: colors.gold }]}>{matches.length}</Text>
                    </View>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.matchesRow}
                  >
                    {matches.map((m) => (
                      <TouchableOpacity
                        key={`conv-sparks-${m.id}`}
                        style={styles.matchItem}
                        onPress={() =>
                          openConversation(
                            m.id,
                            m.target_profile?.display_name || 'Member',
                            m.target_profile?.user_id || m.target_user_id,
                            m.target_profile?.avatar_url || ''
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <View style={[styles.matchAvatarWrap, { borderColor: colors.gold }]}>
                          {m.target_profile?.avatar_url ? (
                            <Image source={{ uri: m.target_profile.avatar_url }} style={styles.matchAvatar} />
                          ) : (
                            <View style={[styles.matchAvatar, styles.avatarPlaceholder, { backgroundColor: colors.card }]}>
                              <Text style={[styles.monogramText, { color: colors.gold }]}>
                                {m.target_profile?.display_name ? m.target_profile.display_name.charAt(0) : 'M'}
                              </Text>
                            </View>
                          )}
                          {m.target_profile?.is_verified && (
                            <View style={styles.verifiedDot}>
                              <Text style={styles.verifiedDotText}>✓</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.matchName} numberOfLines={1}>
                          {m.target_profile?.display_name || 'Member'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              <Text style={[styles.sectionTitle, { color: colors.text, marginTop: matches.length > 0 ? spacing.sm : 0 }]}>
                Messages
              </Text>

              {conversations.length === 0 ? (
                <View style={[styles.emptyInboxCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
                  <View style={[styles.emptyInboxIconCircle, { backgroundColor: colors.cardElevated }]}>
                    <Text style={styles.emptyInboxIcon}>💬</Text>
                  </View>
                  <Text style={[styles.emptyInboxTitle, { color: colors.text }]}>Your Inbox is Quiet</Text>
                  <Text style={[styles.emptyInboxBody, { color: colors.textMuted }]}>
                    Conversations become available when both members like each other. Swipe right in Discover to find your match!
                  </Text>
                  <TouchableOpacity
                    style={[styles.discoverBtn, { backgroundColor: colors.gold }]}
                    onPress={() => router.push('/(tabs)')}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.discoverBtnText, { color: colors.textInverse }]}>Explore Discover</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                conversations.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.conversationItem, { borderBottomColor: colors.borderSubtle }]}
                    onPress={() => openConversation(c.id, c.participant_name, c.participant_id, c.participant_avatar)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.convAvatarWrap}>
                      {c.participant_avatar ? (
                        <Image source={{ uri: c.participant_avatar }} style={styles.convAvatar} />
                      ) : (
                        <View style={[styles.convAvatar, styles.avatarPlaceholder, { backgroundColor: colors.card }]}>
                          <Text style={[styles.monogramText, { color: colors.gold }]}>{c.participant_name.charAt(0)}</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.convInfo}>
                      <View style={styles.convHeaderRow}>
                        <Text style={[styles.convName, { color: colors.text }]}>{c.participant_name}</Text>
                        {c.last_message && (
                          <Text style={styles.convTime}>
                            {new Date(c.last_message.created_at).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.convLastMessage, { color: colors.textMuted }]} numberOfLines={1}>
                        {c.last_message ? c.last_message.content : 'Matched! Say hello.'}
                      </Text>
                    </View>

                    {c.unread_count > 0 && (
                      <View style={[styles.unreadBadge, { backgroundColor: colors.gold }]}>
                        <Text style={[styles.unreadBadgeText, { color: colors.textInverse }]}>{c.unread_count}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          )}

          {/* ===================== REQUESTS TAB ===================== */}
          {activeTab === 'requests' && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Message Requests</Text>
                {messageRequests.length > 0 && (
                  <View style={[styles.countPillGold, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]}>
                    <Text style={[styles.countPillGoldText, { color: colors.gold }]}>{messageRequests.length}</Text>
                  </View>
                )}
              </View>

              {messageRequests.length === 0 ? (
                <View style={[styles.emptyRequestsCard, { backgroundColor: colors.card, borderColor: colors.borderSubtle }]}>
                  <View style={[styles.emptyInboxIconCircle, { backgroundColor: colors.cardElevated }]}>
                    <Text style={styles.emptyInboxIcon}>✉️</Text>
                  </View>
                  <Text style={[styles.emptyInboxTitle, { color: colors.text }]}>No Message Requests</Text>
                  <Text style={[styles.emptyInboxBody, { color: colors.textMuted }]}>
                    Introductory notes from members before matching will appear here.
                  </Text>
                </View>
              ) : (
                messageRequests.map((req) => (
                  <View key={req.id} style={[styles.requestCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.requestHeader}>
                      <View style={styles.requestAvatarWrap}>
                        {req.sender_avatar ? (
                          <Image source={{ uri: req.sender_avatar }} style={styles.requestAvatar} />
                        ) : (
                          <View style={[styles.requestAvatar, styles.avatarPlaceholder, { backgroundColor: colors.card }]}>
                            <Text style={[styles.monogramText, { color: colors.gold }]}>
                              {req.sender_name ? req.sender_name.charAt(0) : 'M'}
                            </Text>
                          </View>
                        )}
                        {req.sender_is_verified && (
                          <View style={styles.verifiedDot}>
                            <Text style={styles.verifiedDotText}>✓</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.requestInfo}>
                        <Text style={[styles.requestName, { color: colors.text }]}>
                          {req.sender_name || 'Member'}{req.sender_age ? `, ${req.sender_age}` : ''}
                        </Text>
                        <Text style={styles.requestTimestamp}>
                          {new Date(req.created_at).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.requestBubble, { backgroundColor: colors.backgroundElevated, borderColor: colors.borderSubtle }]}>
                      <Text style={[styles.requestBodyText, { color: colors.text }]}>{req.body}</Text>
                    </View>

                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={[styles.requestActionBtn, styles.acceptBtn, { backgroundColor: colors.gold }]}
                        onPress={() => handleAcceptRequest(req)}
                        disabled={processingRequestId === req.id}
                        activeOpacity={0.8}
                      >
                        {processingRequestId === req.id ? (
                          <ActivityIndicator color={colors.textInverse} size="small" />
                        ) : (
                          <Text style={[styles.acceptBtnText, { color: colors.textInverse }]}>Accept</Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.requestActionBtn, styles.declineBtn, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}
                        onPress={() => handleDeclineRequest(req)}
                        disabled={processingRequestId === req.id}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.declineBtnText, { color: colors.textMuted }]}>Decline</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.requestActionBtn, styles.blockBtn]}
                        onPress={() => handleBlockRequest(req)}
                        disabled={processingRequestId === req.id}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.blockBtnText}>Block</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          )}
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
  segmentedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    padding: 3,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    height: 38,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  segmentBtnActive: {
    borderWidth: 1,
  },
  segmentBtnText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.3,
  },
  segmentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  segmentBadgeSubtle: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBadgeSubtleText: {
    fontSize: 10,
    fontWeight: '600',
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
    paddingTop: spacing.sm,
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
  matchesGridHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  matchesGridTitle: {
    ...typography.bodyLarge,
    fontWeight: '700',
    fontSize: 15,
  },
  matchesGridSubtitle: {
    ...typography.caption,
    fontSize: 11,
  },
  matchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  matchCard: {
    width: MATCH_CARD_WIDTH,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  matchCardImageContainer: {
    width: '100%',
    height: 140,
    position: 'relative',
  },
  matchCardImage: {
    width: '100%',
    height: '100%',
  },
  matchCardMonogram: {
    ...typography.h1,
    fontSize: 32,
    fontWeight: '700',
  },
  cardVerifiedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    borderRadius: borderRadius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cardVerifiedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  matchCardInfo: {
    padding: spacing.sm,
  },
  matchCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchCardName: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 14,
  },
  matchCardMatchedTime: {
    ...typography.caption,
    fontSize: 10,
    marginTop: 2,
    fontWeight: '600',
  },
  matchCardBio: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
  matchCardActionBtn: {
    borderRadius: borderRadius.full,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs + 2,
  },
  matchCardActionBtnText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 11,
  },
  messagesSparksSection: {
    marginBottom: spacing.md,
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
  emptyMatchesCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: spacing.sm,
  },
  emptyMatchesIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyMatchesIcon: {
    fontSize: 26,
  },
  emptyMatchesTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  emptyMatchesBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  emptyRequestsCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: spacing.sm,
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
  countPillGold: {
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  countPillGoldText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.gold,
  },
  requestCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  requestAvatarWrap: {
    position: 'relative',
    marginRight: spacing.sm,
  },
  requestAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  requestInfo: {
    flex: 1,
  },
  requestName: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  requestTimestamp: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  requestBubble: {
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  requestBodyText: {
    ...typography.bodySmall,
    color: colors.text,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  requestActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  requestActionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    backgroundColor: colors.gold,
  },
  acceptBtnText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textInverse,
  },
  declineBtn: {
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declineBtnText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textMuted,
  },
  blockBtn: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.xs,
  },
  blockBtnText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.ruby,
    fontWeight: '600',
  },
});
