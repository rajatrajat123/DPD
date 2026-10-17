import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../theme';
import { Message, Conversation } from '../types';
import { chatService, chatWebSocket, ConnectionStatus } from '../services/chat/chatService';
import { discoveryService } from '../services/discovery/discoveryService';
import { privacyManager } from '../services/security/privacyManager';
import { useAuth } from '../context/AuthContext';

interface ChatRoomProps {
  conversationId: string;
  recipientName: string;
  recipientId: string;
  onBack: () => void;
  onUnmatched?: () => void;
}

export const ChatRoom: React.FC<ChatRoomProps> = ({
  conversationId,
  recipientName,
  recipientId,
  onBack,
  onUnmatched,
}) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(chatWebSocket.connectionStatus);
  const [isRecipientTyping, setIsRecipientTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll to latest messages when keyboard appears
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return () => {
      sub.remove();
    };
  }, []);

  // Enable Android screenshot protection while viewing private chat
  useEffect(() => {
    privacyManager.enableScreenCaptureProtection();
    return () => {
      privacyManager.disableScreenCaptureProtection();
    };
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      const history = await chatService.getMessages(conversationId);
      setMessages(history);
    } catch {
      // Offline fallback
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    loadMessages();

    // Subscribe to incoming WebSocket messages
    const unsubMsg = chatWebSocket.onMessage((newMsg) => {
      if (newMsg.conversation_id === conversationId) {
        setMessages((prev) => {
          if (newMsg.client_message_id) {
            const index = prev.findIndex(
              (m) => m.client_message_id === newMsg.client_message_id || m.id === newMsg.id
            );
            if (index !== -1) {
              const copy = [...prev];
              copy[index] = newMsg;
              return copy;
            }
          } else {
            const index = prev.findIndex((m) => m.id === newMsg.id);
            if (index !== -1) {
              const copy = [...prev];
              copy[index] = newMsg;
              return copy;
            }
          }
          return [newMsg, ...prev];
        });
        if (newMsg.sender_user_id !== user?.id) {
          chatWebSocket.sendReadReceipt(conversationId, newMsg.id);
        }
      }
    });

    // Subscribe to delivery receipts
    const unsubDelivery = chatWebSocket.onDelivery((receipt) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (
            (receipt.client_message_id && m.client_message_id === receipt.client_message_id) ||
            m.id === receipt.message_id
          ) {
            return {
              ...m,
              id: receipt.message_id,
              delivered_at: receipt.delivered_at,
              status: m.status === 'READ' ? 'READ' : 'DELIVERED',
            };
          }
          return m;
        })
      );
    });

    // Subscribe to read receipts
    const unsubRead = chatWebSocket.onReadReceipt((receipt) => {
      if (receipt.conversation_id === conversationId) {
        setMessages((prev) =>
          prev.map((m) => {
            const isMyMsg =
              m.sender_user_id === user?.id ||
              m.sender_id === 'me' ||
              (user?.id ? m.sender_id === user.id : false);
            if (isMyMsg && !m.read_at) {
              return {
                ...m,
                read_at: receipt.read_at,
                status: 'READ',
              };
            }
            return m;
          })
        );
      }
    });

    // Subscribe to typing indicator
    const unsubTyping = chatWebSocket.onTyping((data) => {
      if (data.conversation_id === conversationId && data.user_id === recipientId) {
        setIsRecipientTyping(data.is_typing);
      }
    });

    // Subscribe to connection changes
    const unsubConn = chatWebSocket.onConnectionChange((status) => {
      setConnectionStatus(status);
    });

    return () => {
      unsubMsg();
      unsubDelivery();
      unsubRead();
      unsubTyping();
      unsubConn();
    };
  }, [conversationId, recipientId, user?.id, loadMessages]);

  const handleInputChange = (text: string) => {
    setInputText(text);

    // Broadcast typing event
    chatWebSocket.sendTyping(conversationId, true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      chatWebSocket.sendTyping(conversationId, false);
    }, 2000);
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setInputText('');
    chatWebSocket.sendTyping(conversationId, false);

    try {
      const sentMsg = await chatService.sendMessage(conversationId, text, user?.id || 'me');
      setMessages((prev) => {
        if (prev.some((m) => (sentMsg.client_message_id && m.client_message_id === sentMsg.client_message_id) || m.id === sentMsg.id)) {
          return prev;
        }
        return [sentMsg, ...prev];
      });
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch {
      setInputText(text); // Preserve draft when sending fails
      Alert.alert('Message Failed', 'Could not send message. Please check your connection.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSafetyAction = () => {
    Alert.alert(
      'Safety & Member Options',
      `Manage your conversation with ${recipientName}`,
      [
        {
          text: 'Report Member',
          style: 'destructive',
          onPress: () => handleReport(),
        },
        {
          text: 'Block Member',
          style: 'destructive',
          onPress: () => handleBlock(),
        },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: () => handleUnmatch(),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  const handleBlock = () => {
    Alert.alert(
      'Block Member?',
      `Are you sure you want to block ${recipientName}? You will never see each other again, and all conversation history will be permanently hidden.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await discoveryService.blockUser(recipientId);
              Alert.alert('Blocked', 'Member has been blocked successfully.');
              onUnmatched?.();
              onBack();
            } catch {
              Alert.alert('Error', 'Could not block member.');
            }
          },
        },
      ]
    );
  };

  const handleReport = () => {
    Alert.alert(
      'Report Member',
      'Please select the reason for reporting:',
      [
        { text: 'Inappropriate Content / Harassment', onPress: () => submitReport('HARASSMENT') },
        { text: 'Underage / Fake Profile', onPress: () => submitReport('UNDERAGE_OR_FAKE') },
        { text: 'Hate Speech / Discrimination', onPress: () => submitReport('HATE_SPEECH') },
        { text: 'Spam / Commercial Solicitation', onPress: () => submitReport('SPAM') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const submitReport = async (category: string) => {
    try {
      await discoveryService.reportUser(recipientId, category, 'Reported via mobile chat safety options');
      Alert.alert('Report Submitted', 'Our Trust & Safety team will review this report within 1 hour.');
    } catch {
      Alert.alert('Error', 'Could not submit report.');
    }
  };

  const handleUnmatch = () => {
    Alert.alert(
      'Unmatch?',
      `Are you sure you want to unmatch ${recipientName}? This conversation will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmatch',
          style: 'destructive',
          onPress: async () => {
            try {
              await chatService.unmatch(conversationId);
              onUnmatched?.();
              onBack();
            } catch {
              Alert.alert('Error', 'Could not unmatch.');
            }
          },
        },
      ]
    );
  };

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isMe =
      item.sender_user_id === user?.id ||
      item.sender_id === 'me' ||
      (user?.id ? item.sender_id === user.id : false);
    const timeFormatted = item.created_at
      ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const textContent = item.body || item.content || '';
    const isRead = Boolean(item.read_at) || item.status === 'READ';
    const isDelivered = Boolean(item.delivered_at) || item.status === 'DELIVERED';

    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowThem]}>
        <View style={[styles.msgBubble, isMe ? styles.msgBubbleMe : styles.msgBubbleThem]}>
          <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextThem]}>{textContent}</Text>
          <View style={styles.msgMetaRow}>
            <Text style={styles.msgTime}>{timeFormatted}</Text>
            {isMe && (
              <Text style={isRead ? styles.readReceiptGold : styles.readReceipt}>
                {isRead ? ' ✓✓' : isDelivered ? ' ✓✓' : ' ✓'}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>{recipientName}</Text>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                connectionStatus === 'CONNECTED' ? styles.statusDotOnline : styles.statusDotOffline,
              ]}
            />
            <Text style={styles.statusPillText}>
              {connectionStatus === 'CONNECTED'
                ? 'Encrypted (In-Transit)'
                : connectionStatus === 'CONNECTING'
                ? 'Connecting...'
                : 'REST Fallback'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.menuButton} onPress={handleSafetyAction} activeOpacity={0.7}>
          <Text style={styles.menuButtonText}>🛡️</Text>
        </TouchableOpacity>
      </View>

      {/* Messages List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          inverted
          contentContainerStyle={styles.messagesList}
        />
      )}

      {/* Typing indicator */}
      {isRecipientTyping && (
        <View style={styles.typingContainer}>
          <Text style={styles.typingText}>{recipientName} is typing...</Text>
        </View>
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={handleInputChange}
          placeholder="Send a private message..."
          placeholderTextColor={colors.textSubtle}
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || isSending) ? styles.sendButtonDisabled : null]}
          onPress={handleSend}
          disabled={!inputText.trim() || isSending}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Send Message"
          testID="chat-send-btn"
        >
          {isSending ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.sendButtonText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: spacing.xs,
    marginRight: spacing.sm,
  },
  backButtonText: {
    ...typography.h2,
    color: colors.gold,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusDotOnline: {
    backgroundColor: colors.emerald,
  },
  statusDotOffline: {
    backgroundColor: colors.amber,
  },
  statusPillText: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
  },
  menuButton: {
    padding: spacing.xs,
  },
  menuButtonText: {
    fontSize: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesList: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  msgRow: {
    marginVertical: spacing.xs,
    flexDirection: 'row',
  },
  msgRowMe: {
    justifyContent: 'flex-end',
  },
  msgRowThem: {
    justifyContent: 'flex-start',
  },
  msgBubble: {
    maxWidth: '78%',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  msgBubbleMe: {
    backgroundColor: '#322B1D',
    borderWidth: 1,
    borderColor: colors.goldDark,
    borderBottomRightRadius: 2,
  },
  msgBubbleThem: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 2,
  },
  msgText: {
    ...typography.body,
    lineHeight: 20,
  },
  msgTextMe: {
    color: colors.text,
  },
  msgTextThem: {
    color: colors.text,
  },
  msgMetaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 4,
  },
  msgTime: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textSubtle,
  },
  readReceipt: {
    fontSize: 11,
    color: colors.textSubtle,
  },
  readReceiptGold: {
    fontSize: 11,
    color: colors.gold,
    fontWeight: '700',
  },
  typingContainer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
  },
  typingText: {
    ...typography.caption,
    color: colors.gold,
    fontStyle: 'italic',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: colors.backgroundElevated,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    ...typography.body,
  },
  sendButton: {
    minWidth: 44,
    minHeight: 44,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.gold,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.cardMuted,
    opacity: 0.5,
  },
  sendButtonText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textInverse,
  },
});
