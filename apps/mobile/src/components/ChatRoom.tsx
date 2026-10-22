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
  StatusBar,
  LayoutChangeEvent,
  KeyboardEvent,
  Modal,
  BackHandler,
  Dimensions,
  Image,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, useTheme } from '../theme';
import { Message, Conversation } from '../types';
import { chatService, chatWebSocket, ConnectionStatus } from '../services/chat/chatService';
import { discoveryService } from '../services/discovery/discoveryService';
import { privacyManager } from '../services/security/privacyManager';
import { mediaUploader, PickedMedia, UploadedAsset, buildMediaUrl } from '../services/media/mediaUploader';
import { audioService, formatAudioDuration, AudioPlaybackState } from '../services/audio/audioService';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';

export type SafetyModalStep = 'MENU' | 'REPORT' | 'BLOCK_CONFIRM' | 'UNMATCH_CONFIRM';

export const REPORT_REASONS = [
  { key: 'HARASSMENT', label: 'Inappropriate Content / Harassment' },
  { key: 'UNDERAGE_OR_FAKE', label: 'Underage / Fake Profile' },
  { key: 'HATE_SPEECH', label: 'Hate Speech / Discrimination' },
  { key: 'SPAM', label: 'Spam / Commercial Solicitation' },
];

/**
 * Authoritative message comparator for an INVERTED FlatList:
 * In an inverted FlatList, index 0 is rendered at the bottom (newest message),
 * while the highest index is rendered at the top (oldest message).
 *
 * Primary sort key: created_at descending (newest first).
 * Stable tie-breaker: id or client_message_id descending.
 */
export function compareMessagesDesc(a: Message, b: Message): number {
  const timeA = new Date(a.created_at).getTime();
  const timeB = new Date(b.created_at).getTime();
  if (timeA !== timeB) {
    return timeB - timeA;
  }
  const idA = a.id || a.client_message_id || '';
  const idB = b.id || b.client_message_id || '';
  return idB.localeCompare(idA);
}

/**
 * Reconciles and deduplicates incoming messages against current messages array.
 * Reconciles optimistic sends with authoritative server confirmations,
 * merges delivery/read receipts, and guarantees strict descending order.
 */
export function reconcileMessages(prev: Message[], incoming: Message | Message[]): Message[] {
  const incomingList = Array.isArray(incoming) ? incoming : [incoming];
  if (incomingList.length === 0) return prev;

  const merged = [...prev];

  for (const item of incomingList) {
    if (!item) continue;
    const itemClientId = item.client_message_id;
    const itemId = item.id;

    const existingIndex = merged.findIndex((m) => {
      if (m.id && itemId && m.id === itemId) return true;
      if (itemClientId) {
        if (m.client_message_id && m.client_message_id === itemClientId) return true;
        if (m.id === itemClientId) return true;
      }
      if (m.client_message_id && itemId && m.client_message_id === itemId) return true;
      return false;
    });

    if (existingIndex !== -1) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        ...item,
        id: item.id || existing.id,
        media_url: item.media_url || existing.media_url,
        media_asset_id: item.media_asset_id || existing.media_asset_id,
        message_type: item.message_type || existing.message_type,
        audio_duration_ms: item.audio_duration_ms || existing.audio_duration_ms,
        delivered_at: item.delivered_at || existing.delivered_at || null,
        read_at: item.read_at || existing.read_at || null,
        status:
          item.read_at || existing.read_at
            ? 'READ'
            : item.delivered_at || existing.delivered_at
            ? 'DELIVERED'
            : item.status || existing.status,
        created_at: item.created_at || existing.created_at,
      };
    } else {
      merged.push(item);
    }
  }

  return merged.sort(compareMessagesDesc);
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

import { computeAndroidKeyboardCompensation as computeAndroidCompensationUtil } from '../utils/keyboardAvoidance';

export function computeAndroidKeyboardCompensation(params: {
  kbHeight: number;
  idleHeight: number;
  currentHeight: number;
  bottomInset?: number;
  keyboardScreenY?: number;
}): number {
  return computeAndroidCompensationUtil(params);
}

const recipientAvatarCache = new Map<string, string>();

interface ChatRoomProps {
  conversationId: string;
  recipientName: string;
  recipientId: string;
  recipientAvatar?: string;
  onBack: () => void;
  onUnmatched?: () => void;
}

export const ChatRoom: React.FC<ChatRoomProps> = ({
  conversationId,
  recipientName,
  recipientId,
  recipientAvatar,
  onBack,
  onUnmatched,
}) => {
  const { colors } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0);
  const horizontalLeft = Math.max(insets.left, spacing.lg);
  const horizontalRight = Math.max(insets.right, spacing.lg);

  // Recipient Display Profile Picture State
  const [partnerAvatarUri, setPartnerAvatarUri] = useState<string | null>(() => {
    if (recipientAvatar) {
      return buildMediaUrl(recipientAvatar);
    }
    return recipientAvatarCache.get(recipientId) || null;
  });
  const [avatarLoadError, setAvatarLoadError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setAvatarLoadError(false);

    if (recipientAvatar) {
      const resolved = buildMediaUrl(recipientAvatar);
      recipientAvatarCache.set(recipientId, resolved);
      setPartnerAvatarUri(resolved);
      return;
    }

    const cached = recipientAvatarCache.get(recipientId);
    if (cached) {
      setPartnerAvatarUri(cached);
      return;
    }

    if (recipientId) {
      discoveryService
        .getPublicProfile(recipientId)
        .then((profile) => {
          if (!isMounted) return;
          const photoUrl = profile?.photos?.[0]?.url || profile?.photos?.[0]?.thumb_url;
          if (photoUrl) {
            const resolved = buildMediaUrl(photoUrl);
            recipientAvatarCache.set(recipientId, resolved);
            setPartnerAvatarUri(resolved);
          }
        })
        .catch(() => {
          // Fallback monogram will be used
        });
    }

    return () => {
      isMounted = false;
    };
  }, [recipientId, recipientAvatar]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(chatWebSocket.connectionStatus);
  const [isRecipientTyping, setIsRecipientTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [avoidancePadding, setAvoidancePadding] = useState(0);

  // Safety & Member Options modal states
  const [isSafetyModalVisible, setIsSafetyModalVisible] = useState(false);
  const [safetyModalStep, setSafetyModalStep] = useState<SafetyModalStep>('MENU');
  const [isDestructiveInProgress, setIsDestructiveInProgress] = useState(false);

  // Media Attachment States
  const [pendingAttachment, setPendingAttachment] = useState<PickedMedia | null>(null);
  const [isPickingMedia, setIsPickingMedia] = useState(false);
  const [isAttachmentMenuVisible, setIsAttachmentMenuVisible] = useState(false);
  const [uploadStepText, setUploadStepText] = useState<string>('');
  const [viewingImage, setViewingImage] = useState<{ url: string } | null>(null);
  const [viewingVideo, setViewingVideo] = useState<{ url: string; posterUrl?: string } | null>(null);
  const [mediaAssetUrls, setMediaAssetUrls] = useState<Record<string, UploadedAsset>>({});
  const [mediaAssetErrors, setMediaAssetErrors] = useState<Record<string, boolean>>({});
  const [loadingAssetIds, setLoadingAssetIds] = useState<Record<string, boolean>>({});

  // Voice Note Recording & Playback States
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState<{ uri: string; durationMs: number } | null>(null);
  const [previewPlayback, setPreviewPlayback] = useState<AudioPlaybackState | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [messagePlaybackState, setMessagePlaybackState] = useState<AudioPlaybackState | null>(null);
  const [loadingAudioMessageId, setLoadingAudioMessageId] = useState<string | null>(null);

  const hasLoggedClientAudit = useRef(false);
  if (!hasLoggedClientAudit.current) {
    hasLoggedClientAudit.current = true;
    try {
      const gExpo = (globalThis as any).expo;
      const modules = gExpo?.modules ? Object.keys(gExpo.modules) : [];
      console.log('[AURA_NATIVE_CLIENT_AUDIT]', JSON.stringify({
        appOwnership: Constants?.appOwnership || null,
        executionEnvironment: Constants?.executionEnvironment || null,
        expoVersion: Constants?.expoVersion || null,
        nativeAppVersion: Constants?.nativeAppVersion || null,
        nativeBuildVersion: Constants?.nativeBuildVersion || null,
        platform: Platform.OS,
        hasExpoAudio: Boolean(gExpo?.modules?.ExpoAudio),
        isAudioServiceAvailable: audioService.isAvailable(),
        isPlaybackAvailable: audioService.isPlaybackAvailable(),
        installedModulesCount: modules.length,
        installedModules: modules,
      }));
    } catch (e: any) {
      console.log('[AURA_NATIVE_CLIENT_AUDIT_ERROR]', e?.message);
    }
  }

  // Unload audio resources on ChatRoom unmount
  useEffect(() => {
    return () => {
      audioService.unloadCurrentSound().catch(() => {});
      audioService.cancelRecording().catch(() => {});
    };
  }, []);

  // Android hardware back handling for Modals (Safety, Attachment Menu, Media Viewers)
  // While any modal is open, consumes the Back event to dismiss modal without navigating away from chat
  // When all modals are closed, BackHandler listener is completely removed, preserving normal navigation
  useEffect(() => {
    if (!isSafetyModalVisible && !viewingImage && !viewingVideo && !isAttachmentMenuVisible) return;

    const onHardwareBack = () => {
      if (isDestructiveInProgress) {
        return true; // Lock back during destructive in-flight network call
      }
      if (viewingImage) {
        setViewingImage(null);
        return true;
      }
      if (viewingVideo) {
        setViewingVideo(null);
        return true;
      }
      if (isAttachmentMenuVisible) {
        setIsAttachmentMenuVisible(false);
        return true;
      }
      if (safetyModalStep !== 'MENU') {
        setSafetyModalStep('MENU');
        return true; // Dismiss topmost confirmation/reason dialog first
      }
      setIsSafetyModalVisible(false);
      return true; // Dismiss safety modal; prevent leaving chat screen
    };

    const backSub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);

    return () => {
      backSub.remove();
    };
  }, [isSafetyModalVisible, safetyModalStep, isDestructiveInProgress, viewingImage, viewingVideo, isAttachmentMenuVisible]);

  const flatListRef = useRef<FlatList>(null);
  const scrollOffsetRef = useRef<number>(0);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const idleWindowHeightRef = useRef<number>(Dimensions.get('window').height);
  const idleContainerHeightRef = useRef<number>(0);
  const currentContainerHeightRef = useRef<number>(0);
  const isKeyboardVisibleRef = useRef<boolean>(false);
  const lastKeyboardHeightRef = useRef<number>(0);
  const lastKeyboardScreenYRef = useRef<number>(0);
  const avoidancePaddingRef = useRef<number>(0);

  // Diagnostic layout refs for empirical measurement
  const containerRef = useRef<View>(null);
  const headerRef = useRef<View>(null);
  const inputBarRef = useRef<View>(null);
  const headerLayoutRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const messagesListLayoutRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const composerLayoutRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const runLayoutDiagnostic = useCallback((trigger: string, kbMetrics?: any) => {
    try {
      const win = Dimensions.get('window');
      const screen = Dimensions.get('screen');
      const kbVisible = isKeyboardVisibleRef.current;
      const kbH = kbMetrics?.height || lastKeyboardHeightRef.current || 0;
      const kbScreenY =
        kbMetrics?.screenY ||
        lastKeyboardScreenYRef.current ||
        (kbVisible && kbH > 0 ? screen.height - kbH : screen.height);

      containerRef.current?.measureInWindow((cx, cy, cw, ch) => {
        inputBarRef.current?.measureInWindow((ix, iy, iw, ih) => {
          // Convert Window coordinates to Screen coordinates:
          // containerRef starts at the top of the physical screen. cy is the window origin offset.
          // Subtracting cy converts Window coordinates into physical Screen coordinates.
          const composerScreenTop = iy - (cy || 0);
          const composerScreenBottom = composerScreenTop + ih;
          const isCoveredByKeyboard = kbVisible && kbH > 0 && composerScreenBottom > kbScreenY + 2;
          const isOutsideViewport = composerScreenTop >= screen.height || composerScreenBottom > screen.height + 5;
          const isClippedByParent = ch > 0 && (iy + ih > cy + ch + 2);

          let verdict = 'HEALTHY';
          if (isCoveredByKeyboard) {
            verdict = `COVERED_BY_KEYBOARD (composer bottom ${composerScreenBottom.toFixed(1)}px > keyboard top ${kbScreenY.toFixed(1)}px by ${(composerScreenBottom - kbScreenY).toFixed(1)}px)`;
          } else if (isOutsideViewport) {
            verdict = `OUTSIDE_VIEWPORT (composer top ${composerScreenTop.toFixed(1)}px >= screen height ${screen.height}px)`;
          } else if (isClippedByParent) {
            verdict = `CLIPPED_BY_PARENT (composer bottom ${(iy + ih).toFixed(1)}px > container bottom ${(cy + ch).toFixed(1)}px)`;
          }

          console.log('[AURA_CHAT_LAYOUT_AUDIT]', JSON.stringify({
            trigger,
            state: kbVisible ? 'OPEN' : 'CLOSED',
            verdict,
            window: { width: Math.round(win.width), height: Math.round(win.height) },
            screen: { width: Math.round(screen.width), height: Math.round(screen.height) },
            insets: { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right },
            container: { x: Math.round(cx || 0), y: Math.round(cy || 0), width: Math.round(cw || 0), height: Math.round(ch || 0) },
            header: { height: Math.round(headerLayoutRef.current.height) },
            messageList: { height: Math.round(messagesListLayoutRef.current.height) },
            composer: {
              x: Math.round(ix || 0),
              y: Math.round(composerScreenTop || 0),
              width: Math.round(iw || 0),
              height: Math.round(ih || 0),
              bottomEdge: Math.round(composerScreenBottom || 0),
            },
            keyboard: {
              visible: kbVisible,
              height: Math.round(kbH),
              screenY: Math.round(kbScreenY),
            },
            avoidancePadding: avoidancePaddingRef.current,
          }));
        });
      });
    } catch {
      // Diagnostic non-blocking
    }
  }, [insets]);

  const updateAndroidAvoidance = useCallback((kbHeight: number, keyboardScreenY?: number) => {
    if (Platform.OS !== 'android') return;
    const idleH = idleContainerHeightRef.current;
    const currentH = currentContainerHeightRef.current;
    const winH = Dimensions.get('window').height;
    // Consistent container measurements - never mix window height with container height
    const effectiveIdleH = idleH > 0 ? idleH : winH;
    const effectiveCurrentH = currentH > 0 ? currentH : effectiveIdleH;
    const compensation = computeAndroidKeyboardCompensation({
      kbHeight,
      idleHeight: effectiveIdleH,
      currentHeight: effectiveCurrentH,
      bottomInset: insets.bottom,
      keyboardScreenY: keyboardScreenY || lastKeyboardScreenYRef.current,
    });
    avoidancePaddingRef.current = compensation;
    setAvoidancePadding(compensation);
  }, [insets.bottom]);

  // Dynamic layout measurement:
  // Tracks idle container frame height when the keyboard is hidden.
  // Avoids recursive layout loops or overwriting avoidance padding during active animations.
  const handleContainerLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    currentContainerHeightRef.current = height;
    if (!isKeyboardVisibleRef.current && height > 0) {
      if (idleContainerHeightRef.current === 0 || height >= idleContainerHeightRef.current - 50) {
        idleContainerHeightRef.current = height;
      }
    } else if (isKeyboardVisibleRef.current && Platform.OS === 'android') {
      updateAndroidAvoidance(lastKeyboardHeightRef.current, lastKeyboardScreenYRef.current);
    }
    runLayoutDiagnostic('container_layout', {
      containerLayout: {
        x: e.nativeEvent.layout.x,
        y: e.nativeEvent.layout.y,
        width: e.nativeEvent.layout.width,
        height: e.nativeEvent.layout.height,
      },
    });
  };

  // Keyboard avoidance and auto-scroll tracking:
  // Dynamically calculates required avoidance between devices with native window resize (Phone 1)
  // and modern edge-to-edge screens with unresized activity windows (Phone 2).
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent) => {
      setIsKeyboardVisible(true);
      isKeyboardVisibleRef.current = true;
      const kbHeight = e?.endCoordinates?.height || 0;
      const kbScreenY = e?.endCoordinates?.screenY || 0;
      lastKeyboardHeightRef.current = kbHeight;
      if (kbScreenY > 0) {
        lastKeyboardScreenYRef.current = kbScreenY;
      }

      if (Platform.OS === 'android') {
        updateAndroidAvoidance(kbHeight, kbScreenY);
        runLayoutDiagnostic('keyboard_did_show', { height: kbHeight, screenY: kbScreenY });
        // Secondary verification after 60ms to catch deferred Activity window resize passes
        setTimeout(() => {
          if (isKeyboardVisibleRef.current) {
            updateAndroidAvoidance(lastKeyboardHeightRef.current, lastKeyboardScreenYRef.current);
            runLayoutDiagnostic('keyboard_settled', {
              height: lastKeyboardHeightRef.current,
              screenY: lastKeyboardScreenYRef.current,
            });
          }
        }, 60);
      }

      // In an inverted FlatList, offset 0 is the bottom (latest messages).
      // If user is already near the bottom (< 80dp), pin them to bottom on keyboard open.
      if (scrollOffsetRef.current < 80) {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
        }, 80);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
      isKeyboardVisibleRef.current = false;
      lastKeyboardHeightRef.current = 0;
      lastKeyboardScreenYRef.current = 0;
      if (Platform.OS === 'android') {
        avoidancePaddingRef.current = 0;
        setAvoidancePadding(0);
        idleWindowHeightRef.current = Dimensions.get('window').height;
        runLayoutDiagnostic('keyboard_did_hide');
      }
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom, updateAndroidAvoidance, runLayoutDiagnostic]);

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
      setMessages((prev) => reconcileMessages(prev, history));
      if (history.length < 50) {
        setHasMore(false);
      }
      const hasUnread = history.some(
        (m) => m.sender_user_id !== user?.id && m.sender_id !== 'me' && !m.read_at && m.status !== 'READ'
      );
      if (hasUnread) {
        chatService.markConversationAsRead(conversationId);
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [conversationId, user?.id]);

  const loadOlderMessages = async () => {
    if (isLoadingOlder || !hasMore || messages.length === 0) return;

    // In descending array [Newest ... Oldest], oldest message is the last element
    const oldestMessage = messages[messages.length - 1];
    if (!oldestMessage || !oldestMessage.id) return;

    setIsLoadingOlder(true);
    try {
      const older = await chatService.getMessages(conversationId, oldestMessage.id, 50);
      if (older.length === 0) {
        setHasMore(false);
      } else {
        if (older.length < 50) setHasMore(false);
        setMessages((prev) => reconcileMessages(prev, older));
      }
    } catch {
      // Offline fallback
    } finally {
      setIsLoadingOlder(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadMessages();
  };

  useEffect(() => {
    chatService.setActiveConversation(conversationId);
    chatService.markConversationAsRead(conversationId);
    loadMessages();

    if (chatWebSocket.connectionStatus === 'DISCONNECTED') {
      chatWebSocket.connect().catch(() => {
        // Fallback to REST remains intact if socket connection fails
      });
    }

    // Subscribe to incoming WebSocket messages
    const unsubMsg = chatWebSocket.onMessage((newMsg) => {
      if (newMsg.conversation_id === conversationId) {
        setMessages((prev) => reconcileMessages(prev, newMsg));
        if (newMsg.sender_user_id !== user?.id && newMsg.sender_id !== 'me') {
          chatService.markConversationAsRead(conversationId);
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

    // Subscribe to message deleted events (Delete for Everyone)
    const unsubDelete = chatWebSocket.onMessageDeleted((receipt) => {
      if (receipt.conversation_id === conversationId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === receipt.message_id || m.client_message_id === receipt.message_id
              ? {
                  ...m,
                  body: 'This message was deleted',
                  content: 'This message was deleted',
                  deleted_at: receipt.deleted_at,
                  media_asset_id: undefined,
                  media_url: undefined,
                  message_type: 'TEXT',
                }
              : m
          )
        );
      }
    });

    // Subscribe to connection changes
    const unsubConn = chatWebSocket.onConnectionChange((status) => {
      setConnectionStatus(status);
    });

    return () => {
      chatService.setActiveConversation(null);
      chatService.markConversationAsRead(conversationId);
      unsubMsg();
      unsubDelivery();
      unsubRead();
      unsubTyping();
      unsubDelete();
      unsubConn();
    };
  }, [conversationId, recipientId, user?.id, loadMessages]);

  const retryLoadMediaAsset = useCallback((assetId: string) => {
    setMediaAssetErrors((prev) => {
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
    mediaUploader.clearChatAssetCache(assetId);
    setLoadingAssetIds((prev) => ({ ...prev, [assetId]: true }));
    mediaUploader
      .getChatMediaAsset(assetId)
      .then((asset) => {
        if (asset) {
          setMediaAssetUrls((prev) => ({ ...prev, [assetId]: asset }));
        } else {
          setMediaAssetErrors((prev) => ({ ...prev, [assetId]: true }));
        }
      })
      .catch(() => {
        setMediaAssetErrors((prev) => ({ ...prev, [assetId]: true }));
      })
      .finally(() => {
        setLoadingAssetIds((prev) => ({ ...prev, [assetId]: false }));
      });
  }, []);

  // Load media asset URLs for messages that have media_asset_id
  useEffect(() => {
    messages.forEach((msg) => {
      const assetId = msg.media_asset_id;
      if (assetId && !mediaAssetUrls[assetId] && !mediaAssetErrors[assetId] && !loadingAssetIds[assetId]) {
        setLoadingAssetIds((prev) => ({ ...prev, [assetId]: true }));
        mediaUploader
          .getChatMediaAsset(assetId)
          .then((asset) => {
            if (asset) {
              setMediaAssetUrls((prev) => ({ ...prev, [assetId]: asset }));
            } else {
              setMediaAssetErrors((prev) => ({ ...prev, [assetId]: true }));
            }
          })
          .catch(() => {
            setMediaAssetErrors((prev) => ({ ...prev, [assetId]: true }));
          })
          .finally(() => {
            setLoadingAssetIds((prev) => ({ ...prev, [assetId]: false }));
          });
      }
    });
  }, [messages, mediaAssetUrls, mediaAssetErrors, loadingAssetIds]);

  const handlePickPhoto = async () => {
    setIsAttachmentMenuVisible(false);
    setIsPickingMedia(true);
    try {
      const picked = await mediaUploader.pickChatPhoto();
      if (picked) {
        setPendingAttachment(picked);
      }
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        Alert.alert(
          'Photo Library Access Required',
          'Aura needs permission to access your photos so you can share them in chat.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else if (err?.code === 'FILE_TOO_LARGE') {
        Alert.alert('File Too Large', err.message || 'Photo exceeds the 15MB limit.');
      } else {
        Alert.alert('Selection Error', err?.message || 'Could not select photo.');
      }
    } finally {
      setIsPickingMedia(false);
    }
  };

  const handlePickVideo = async () => {
    setIsAttachmentMenuVisible(false);
    setIsPickingMedia(true);
    try {
      const picked = await mediaUploader.pickChatVideo();
      if (picked) {
        setPendingAttachment(picked);
      }
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') {
        Alert.alert(
          'Media Library Access Required',
          'Aura needs permission to access your videos so you can share them in chat.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else if (err?.code === 'VIDEO_TOO_LONG') {
        Alert.alert('Video Too Long', err.message || 'Video duration exceeds maximum allowed length of 60 seconds.');
      } else if (err?.code === 'FILE_TOO_LARGE') {
        Alert.alert('File Too Large', err.message || 'Video exceeds the maximum 100MB limit.');
      } else {
        Alert.alert('Selection Error', err?.message || 'Could not select video.');
      }
    } finally {
      setIsPickingMedia(false);
    }
  };

  const handleCancelAttachment = () => {
    if (recordedAudio) {
      audioService.unloadCurrentSound().catch(() => {});
      setRecordedAudio(null);
      setPreviewPlayback(null);
    }
    setPendingAttachment(null);
    setUploadStepText('');
  };

  const handleRetryMessage = (failedMsg: Message) => {
    if (failedMsg.media_url) {
      const isAud = failedMsg.message_type === 'AUDIO' || failedMsg.message_type === 'VOICE_NOTE';
      const isVid = failedMsg.message_type === 'VIDEO';
      setPendingAttachment({
        uri: failedMsg.media_url,
        width: isAud ? 0 : 720,
        height: isAud ? 0 : 1280,
        mimeType: isAud ? 'audio/mp4' : isVid ? 'video/mp4' : 'image/jpeg',
        mediaType: isAud ? 'AUDIO' : isVid ? 'VIDEO' : 'IMAGE',
        durationMs: failedMsg.audio_duration_ms,
        fileName: isAud ? 'voice_note.m4a' : isVid ? 'attachment.mp4' : 'attachment.jpg',
      });
      if (isAud) {
        setRecordedAudio({
          uri: failedMsg.media_url,
          durationMs: failedMsg.audio_duration_ms || 0,
        });
      }
    }
    if (failedMsg.body) {
      setInputText(failedMsg.body);
    }
    setMessages((prev) => prev.filter((m) => m.id !== failedMsg.id && m.client_message_id !== failedMsg.client_message_id));
  };

  const handleStartRecording = async () => {
    Keyboard.dismiss();
    await audioService.unloadCurrentSound();
    setPlayingMessageId(null);
    setMessagePlaybackState(null);
    setPreviewPlayback(null);

    if (!audioService.isAvailable()) {
      Alert.alert(
        'Voice Notes Unavailable',
        'Voice note recording requires an updated native app build containing audio modules.',
        [{ text: 'OK' }]
      );
      return;
    }

    const { granted } = await audioService.requestMicrophonePermission();
    if (!granted) {
      Alert.alert(
        'Microphone Access Required',
        'Aura needs permission to access your microphone to record voice notes.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }

    setRecordingDurationMs(0);
    setIsRecording(true);
    const started = await audioService.startRecording((ms) => {
      setRecordingDurationMs(ms);
    });

    if (!started) {
      setIsRecording(false);
      setRecordingDurationMs(0);
      Alert.alert('Recording Error', 'Could not start audio recording. Please try again.');
    }
  };

  const handleCancelRecording = async () => {
    await audioService.cancelRecording();
    setIsRecording(false);
    setRecordingDurationMs(0);
  };

  const handleStopRecording = async () => {
    const result = await audioService.stopRecording();
    setIsRecording(false);
    setRecordingDurationMs(0);

    if (!result || !result.uri) {
      return;
    }

    if (result.durationMs < 800) {
      Alert.alert('Voice Note Too Short', 'Please record for at least 1 second.');
      return;
    }

    setRecordedAudio(result);
    setPendingAttachment({
      uri: result.uri,
      mimeType: 'audio/mp4',
      mediaType: 'AUDIO',
      durationMs: result.durationMs,
      fileName: 'voice_note.m4a',
    });
  };

  const handleTogglePlayPreview = async () => {
    if (!recordedAudio) return;
    if (previewPlayback?.isPlaying) {
      await audioService.pauseSound();
      setPreviewPlayback((prev) => (prev ? { ...prev, isPlaying: false } : null));
    } else {
      await audioService.playSound(
        recordedAudio.uri,
        (st) => {
          setPreviewPlayback(st);
        },
        previewPlayback?.positionMs || 0
      );
    }
  };

  const handleDiscardRecordedAudio = async () => {
    await audioService.unloadCurrentSound();
    setRecordedAudio(null);
    setPendingAttachment(null);
    setPreviewPlayback(null);
  };

  const handleTogglePlayVoice = async (msg: Message) => {
    const msgId = msg.id || msg.client_message_id;
    if (!msgId) return;

    if (playingMessageId === msgId) {
      if (messagePlaybackState?.isPlaying) {
        await audioService.pauseSound();
        setMessagePlaybackState((prev) => (prev ? { ...prev, isPlaying: false } : null));
        return;
      } else {
        const soundUri =
          msg.media_url || (msg.media_asset_id ? mediaAssetUrls[msg.media_asset_id]?.audio_url : null);
        if (soundUri) {
          await audioService.playSound(
            soundUri,
            (st) => {
              setMessagePlaybackState(st);
              if (!st.isPlaying && (st.positionMs === 0 || (st.durationMs > 0 && st.positionMs >= st.durationMs))) {
                setPlayingMessageId(null);
                setMessagePlaybackState(null);
              }
            },
            messagePlaybackState?.positionMs || 0
          );
          return;
        }
      }
    }

    let audioUrl =
      msg.media_url || (msg.media_asset_id ? mediaAssetUrls[msg.media_asset_id]?.audio_url : null);

    const isAvail = audioService.isPlaybackAvailable();
    if (!isAvail) {
      const gExpo = (globalThis as any).expo;
      console.log('[AURA_PLAY_VOICE_UNAVAILABLE]', JSON.stringify({
        msgId,
        hasExpoAudio: Boolean(gExpo?.modules?.ExpoAudio),
        isAudioServiceAvailable: audioService.isAvailable(),
        isPlaybackAvailable: isAvail,
        audioUrl,
        msgDurationMs: msg.audio_duration_ms,
      }));
      Alert.alert(
        'Audio Playback Unavailable',
        'Audio playback requires an updated native app build containing audio modules.',
        [{ text: 'OK' }]
      );
      return;
    }

    await audioService.unloadCurrentSound();
    setPlayingMessageId(msgId);
    setMessagePlaybackState(null);

    if (!audioUrl && msg.media_asset_id) {
      setLoadingAudioMessageId(msgId);
      try {
        const asset = await mediaUploader.getChatMediaAsset(msg.media_asset_id);
        if (asset) {
          setMediaAssetUrls((prev) => ({ ...prev, [msg.media_asset_id!]: asset }));
          audioUrl = asset.audio_url || asset.card_url || asset.full_url;
        }
      } catch {
        setMediaAssetErrors((prev) => ({ ...prev, [msg.media_asset_id!]: true }));
      } finally {
        setLoadingAudioMessageId(null);
      }
    }

    if (!audioUrl) {
      setPlayingMessageId(null);
      Alert.alert('Audio Unavailable', 'Could not load audio file. Please try again.');
      return;
    }

    const success = await audioService.playSound(audioUrl, (st) => {
      setMessagePlaybackState(st);
      if (!st.isPlaying && (st.positionMs === 0 || (st.durationMs > 0 && st.positionMs >= st.durationMs))) {
        setPlayingMessageId(null);
        setMessagePlaybackState(null);
      }
    });

    if (!success) {
      setPlayingMessageId(null);
      setMessagePlaybackState(null);
      if (msg.media_asset_id) {
        setMediaAssetErrors((prev) => ({ ...prev, [msg.media_asset_id!]: true }));
      }
      Alert.alert('Playback Failed', 'Could not play voice note.');
    }
  };

  const handleSeekVoice = async (msg: Message, ratio: number) => {
    const msgId = msg.id || msg.client_message_id;
    if (playingMessageId !== msgId || !messagePlaybackState?.durationMs) return;
    const targetMs = Math.round(messagePlaybackState.durationMs * Math.min(1, Math.max(0, ratio)));
    await audioService.seekTo(targetMs);
  };

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
    if ((!text && !pendingAttachment) || isSending) return;

    const attachmentToSend = pendingAttachment;
    setIsSending(true);
    setInputText('');
    setPendingAttachment(null);
    setRecordedAudio(null);
    setPreviewPlayback(null);
    setUploadStepText('');
    chatWebSocket.sendTyping(conversationId, false);

    const clientMsgId = generateUUID();
    const msgType = attachmentToSend ? (attachmentToSend.mediaType || 'IMAGE') : 'TEXT';

    if (attachmentToSend) {
      // Optimistic message with preview uri and PENDING status
      const optimisticMsg: Message = {
        id: clientMsgId,
        client_message_id: clientMsgId,
        conversation_id: conversationId,
        sender_user_id: user?.id || 'me',
        sender_id: user?.id || 'me',
        body: text,
        content: text,
        message_type: msgType,
        media_url: attachmentToSend.uri,
        audio_duration_ms: attachmentToSend.durationMs,
        status: 'PENDING',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => reconcileMessages(prev, optimisticMsg));
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });

      try {
        setUploadStepText('Uploading...');
        const uploaded = await mediaUploader.uploadChatAttachment(attachmentToSend, (step) => {
          if (step === 'STRIPPING_EXIF') setUploadStepText('Optimizing photo...');
          else if (step === 'UPLOADING') setUploadStepText(attachmentToSend.mediaType === 'AUDIO' ? 'Uploading voice note...' : 'Uploading...');
          else if (step === 'PROCESSING') setUploadStepText('Processing...');
        });

        // Send chat message with mediaAssetId
        const sentMsg = await chatService.sendMessage(
          conversationId,
          text,
          user?.id || 'me',
          uploaded.media_id,
          msgType,
          clientMsgId,
          attachmentToSend.durationMs
        );

        setMediaAssetUrls((prev) => ({
          ...prev,
          [uploaded.media_id]: {
            ...uploaded,
            card_url: uploaded.card_url || attachmentToSend.uri,
            full_url: uploaded.full_url || attachmentToSend.uri,
            poster_url: uploaded.poster_url || attachmentToSend.uri,
            audio_url: uploaded.audio_url || attachmentToSend.uri,
            duration_ms: attachmentToSend.durationMs || uploaded.duration_ms,
          },
        }));

        setMessages((prev) => reconcileMessages(prev, {
          ...sentMsg,
          media_url: uploaded.card_url || uploaded.full_url || uploaded.audio_url || attachmentToSend.uri,
          audio_duration_ms: attachmentToSend.durationMs || uploaded.duration_ms,
        }));
      } catch {
        // Mark optimistic message as failed with retry action
        setMessages((prev) =>
          prev.map((m) =>
            m.client_message_id === clientMsgId
              ? { ...m, status: 'FAILED' }
              : m
          )
        );
        Alert.alert(
          'Upload Failed',
          'Could not upload attachment. Tap the failed message to retry or check your connection.'
        );
      } finally {
        setIsSending(false);
        setUploadStepText('');
      }
    } else {
      // Plain text message
      try {
        const sentMsg = await chatService.sendMessage(conversationId, text, user?.id || 'me');
        setMessages((prev) => reconcileMessages(prev, sentMsg));
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      } catch {
        setInputText(text); // Preserve draft when sending fails
        Alert.alert('Message Failed', 'Could not send message. Please check your connection.');
      } finally {
        setIsSending(false);
      }
    }
  };

  const handleSafetyAction = () => {
    setSafetyModalStep('MENU');
    setIsSafetyModalVisible(true);
  };

  const handleCloseSafetyModal = () => {
    if (isDestructiveInProgress) return;
    setIsSafetyModalVisible(false);
    setSafetyModalStep('MENU');
  };

  const handleModalRequestClose = () => {
    if (isDestructiveInProgress) return;
    if (safetyModalStep !== 'MENU') {
      setSafetyModalStep('MENU');
    } else {
      setIsSafetyModalVisible(false);
    }
  };

  const handleSelectReportReason = async (category: string) => {
    setIsDestructiveInProgress(true);
    try {
      await discoveryService.reportUser(recipientId, category, 'Reported via mobile chat safety options');
      setIsSafetyModalVisible(false);
      setSafetyModalStep('MENU');
      Alert.alert(
        'Report Submitted',
        'Our Trust & Safety team will review this report within 1 hour.',
        [{ text: 'OK' }],
        { cancelable: true }
      );
    } catch {
      Alert.alert(
        'Error',
        'Could not submit report. Please try again.',
        [{ text: 'OK' }],
        { cancelable: true }
      );
    } finally {
      setIsDestructiveInProgress(false);
    }
  };

  const handleConfirmBlock = async () => {
    setIsDestructiveInProgress(true);
    try {
      await discoveryService.blockUser(recipientId);
      setIsSafetyModalVisible(false);
      setSafetyModalStep('MENU');
      Alert.alert('Blocked', 'Member has been blocked successfully.', [{ text: 'OK' }], { cancelable: true });
      onUnmatched?.();
      onBack();
    } catch {
      Alert.alert('Error', 'Could not block member. Please try again.', [{ text: 'OK' }], { cancelable: true });
    } finally {
      setIsDestructiveInProgress(false);
    }
  };

  const handleConfirmUnmatch = async () => {
    setIsDestructiveInProgress(true);
    try {
      await chatService.unmatch(conversationId);
      setIsSafetyModalVisible(false);
      setSafetyModalStep('MENU');
      onUnmatched?.();
      onBack();
    } catch {
      Alert.alert('Error', 'Could not unmatch. Please try again.', [{ text: 'OK' }], { cancelable: true });
    } finally {
      setIsDestructiveInProgress(false);
    }
  };

  const confirmDeleteMessage = useCallback((message: Message) => {
    const msgId = message.id || message.client_message_id;
    if (!msgId) return;

    Alert.alert(
      'Delete for Everyone?',
      'This message will be deleted for everyone in this chat. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete for Everyone',
          style: 'destructive',
          onPress: async () => {
            try {
              // Optimistic local update
              setMessages((prev) =>
                prev.map((m) =>
                  (m.id === msgId || m.client_message_id === msgId)
                    ? {
                        ...m,
                        body: 'This message was deleted',
                        content: 'This message was deleted',
                        deleted_at: new Date().toISOString(),
                        media_asset_id: undefined,
                        media_url: undefined,
                        message_type: 'TEXT',
                      }
                    : m
                )
              );
              await chatService.deleteMessageForEveryone(conversationId, msgId);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Could not delete message. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, [conversationId]);

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isMe =
      item.sender_user_id === user?.id ||
      item.sender_id === 'me' ||
      (user?.id ? item.sender_id === user.id : false);
    const timeFormatted = item.created_at
      ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const isDeleted = Boolean(item.deleted_at);
    const textContent = isDeleted ? 'This message was deleted' : (item.body || item.content || '');
    const isRead = Boolean(item.read_at) || item.status === 'READ';
    const isDelivered = Boolean(item.delivered_at) || item.status === 'DELIVERED';
    const isFailed = item.status === 'FAILED';
    const isPending = item.status === 'PENDING';

    const isAudio = !isDeleted && (item.message_type === 'AUDIO' || item.message_type === 'VOICE_NOTE');
    const isVideo = !isDeleted && (item.message_type === 'VIDEO');
    const isImage =
      !isDeleted &&
      (item.message_type === 'IMAGE' || (Boolean(item.media_asset_id) && !isVideo && !isAudio));

    const assetInfo = item.media_asset_id ? mediaAssetUrls[item.media_asset_id] : null;
    const hasMediaError = Boolean(item.media_asset_id && mediaAssetErrors[item.media_asset_id]);
    const mediaUrl = item.media_url || assetInfo?.card_url || assetInfo?.full_url || assetInfo?.thumb_url;
    const posterUrl = assetInfo?.poster_url || item.media_url || assetInfo?.thumb_url;
    const videoUrl = assetInfo?.video_url || item.media_url;

    return (
      <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowThem]}>
        <View
          style={[
            styles.msgBubble,
            isMe
              ? [styles.msgBubbleMe, { backgroundColor: colors.goldMuted, borderColor: colors.gold }]
              : [styles.msgBubbleThem, { backgroundColor: colors.card, borderColor: colors.border }],
          ]}
        >
          {/* Photo Attachment Bubble */}
          {isImage && (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                if (hasMediaError && item.media_asset_id) {
                  retryLoadMediaAsset(item.media_asset_id);
                } else if (mediaUrl) {
                  setViewingImage({ url: mediaUrl });
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={hasMediaError ? 'Retry loading photo' : 'View full photo'}
              testID="chat-photo-bubble"
              style={styles.msgMediaThumbWrap}
            >
              {hasMediaError ? (
                <View style={[styles.msgMediaImage, styles.mediaErrorBox]}>
                  <Text style={styles.mediaErrorIcon}>⚠️</Text>
                  <Text style={styles.mediaErrorText}>Could not load photo</Text>
                  <TouchableOpacity
                    style={styles.mediaRetryBtn}
                    onPress={() => item.media_asset_id && retryLoadMediaAsset(item.media_asset_id)}
                    testID="chat-photo-retry-btn"
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading photo"
                  >
                    <Text style={styles.mediaRetryLink}>Tap to retry</Text>
                  </TouchableOpacity>
                </View>
              ) : mediaUrl ? (
                <Image
                  source={{ uri: mediaUrl }}
                  style={styles.msgMediaImage}
                  resizeMode="cover"
                  onError={() => {
                    if (item.media_asset_id) {
                      setMediaAssetErrors((prev) => ({ ...prev, [item.media_asset_id!]: true }));
                    }
                  }}
                />
              ) : (
                <View style={[styles.msgMediaImage, styles.mediaPlaceholderBox]}>
                  <ActivityIndicator color={colors.gold} size="small" />
                </View>
              )}
              {isPending && (
                <View style={styles.msgPendingOverlay}>
                  <ActivityIndicator color="#ffffff" size="small" />
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Video Attachment Bubble */}
          {isVideo && (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => videoUrl && setViewingVideo({ url: videoUrl, posterUrl })}
              accessibilityRole="button"
              accessibilityLabel="Play video"
              testID="chat-video-bubble"
              style={styles.msgMediaThumbWrap}
            >
              {posterUrl ? (
                <Image
                  source={{ uri: posterUrl }}
                  style={styles.msgMediaVideoPoster}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.msgMediaVideoPoster, styles.mediaPlaceholderBox]}>
                  <Text style={{ fontSize: 32 }}>🎥</Text>
                </View>
              )}
              <View style={styles.msgVideoPlayOverlay}>
                <View style={styles.msgVideoPlayCircle}>
                  <Text style={styles.msgVideoPlayTriangle}>▶</Text>
                </View>
              </View>
              <View style={styles.msgVideoDurationPill}>
                <Text style={styles.msgVideoDurationText}>▶ Video</Text>
              </View>
              {isPending && (
                <View style={styles.msgPendingOverlay}>
                  <ActivityIndicator color="#ffffff" size="small" />
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* Voice Note Attachment Bubble */}
          {isAudio && (
            <View style={styles.voiceBubbleContainer} testID="voice-message-bubble">
              {hasMediaError ? (
                <View style={styles.voiceErrorContainer}>
                  <Text style={styles.mediaErrorIcon}>⚠️</Text>
                  <Text style={styles.mediaErrorText}>Could not load voice note</Text>
                  <TouchableOpacity
                    style={styles.mediaRetryBtn}
                    onPress={() => item.media_asset_id && retryLoadMediaAsset(item.media_asset_id)}
                    testID="voice-retry-btn"
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading voice note"
                  >
                    <Text style={styles.mediaRetryLink}>Tap to retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.voiceControlsRow}>
                  <TouchableOpacity
                    style={[
                      styles.voicePlayPauseBtn,
                      {
                        backgroundColor: isMe ? colors.gold : colors.goldMuted,
                        borderColor: colors.gold,
                      },
                    ]}
                    onPress={() => handleTogglePlayVoice(item)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      playingMessageId === (item.id || item.client_message_id) && messagePlaybackState?.isPlaying
                        ? 'Pause voice note'
                        : 'Play voice note'
                    }
                    testID="voice-play-pause-btn"
                    disabled={isPending}
                  >
                    {loadingAudioMessageId === (item.id || item.client_message_id) ||
                    (playingMessageId === (item.id || item.client_message_id) && messagePlaybackState?.isBuffering) ? (
                      <ActivityIndicator color={isMe ? colors.textInverse : colors.gold} size="small" />
                    ) : (
                      <Text
                        style={[
                          styles.voicePlayPauseIcon,
                          { color: isMe ? colors.textInverse : colors.gold },
                        ]}
                      >
                        {playingMessageId === (item.id || item.client_message_id) && messagePlaybackState?.isPlaying
                          ? '⏸'
                          : '▶'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <View style={styles.voiceWaveformCol}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={styles.voiceTrackContainer}
                      onPress={(e) => {
                        const width = 140;
                        const x = e.nativeEvent.locationX;
                        handleSeekVoice(item, Math.max(0, Math.min(1, x / width)));
                      }}
                      accessibilityLabel="Audio timeline scrubber"
                    >
                      <View
                        style={[
                          styles.voiceTrackBg,
                          { backgroundColor: isMe ? 'rgba(255, 255, 255, 0.2)' : colors.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.voiceTrackProgress,
                            {
                              backgroundColor: colors.gold,
                              width: `${
                                playingMessageId === (item.id || item.client_message_id) && messagePlaybackState?.durationMs
                                  ? Math.min(
                                      100,
                                      Math.max(
                                        0,
                                        (messagePlaybackState.positionMs / messagePlaybackState.durationMs) * 100
                                      )
                                    )
                                  : 0
                              }%`,
                            },
                          ]}
                        />
                      </View>
                    </TouchableOpacity>

                    <View style={styles.voiceMetaRow}>
                      <Text
                        style={[
                          styles.voiceDurationText,
                          { color: isMe ? colors.text : colors.textMuted },
                        ]}
                      >
                        {playingMessageId === (item.id || item.client_message_id) && messagePlaybackState
                          ? `${formatAudioDuration(messagePlaybackState.positionMs)} / ${formatAudioDuration(
                              messagePlaybackState.durationMs || item.audio_duration_ms || assetInfo?.duration_ms || 0
                            )}`
                          : formatAudioDuration(item.audio_duration_ms || assetInfo?.duration_ms || 0)}
                      </Text>
                      <Text style={[styles.voiceTypeBadge, { color: colors.gold }]}>
                        🎙️ Voice note
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {isPending && (
                <View style={styles.msgPendingOverlay}>
                  <ActivityIndicator color="#ffffff" size="small" />
                </View>
              )}
            </View>
          )}

          {/* Text / Caption */}
          {Boolean(textContent) && (
            <Text
              style={[
                styles.msgText,
                isMe ? styles.msgTextMe : styles.msgTextThem,
                { color: isDeleted ? colors.textSubtle : colors.text },
                isDeleted && { fontStyle: 'italic' },
              ]}
            >
              {textContent}
            </Text>
          )}

          {/* Failed / Retry row */}
          {isFailed && (
            <TouchableOpacity
              style={styles.retryBubbleRow}
              onPress={() => handleRetryMessage(item)}
              accessibilityRole="button"
              accessibilityLabel="Retry failed upload"
              testID="retry-upload-btn"
            >
              <Text style={styles.retryBubbleText}>⚠️ Failed to send • Tap to retry</Text>
            </TouchableOpacity>
          )}

          {/* Metadata Row */}
          <View style={styles.msgMetaRow}>
            <Text style={[styles.msgTime, { color: colors.textSubtle }]}>{timeFormatted}</Text>
            {isMe && !isDeleted && !isPending && !isFailed && (
              <TouchableOpacity
                onPress={() => confirmDeleteMessage(item)}
                accessibilityRole="button"
                accessibilityLabel="Delete message for everyone"
                testID="delete-message-btn"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginLeft: 6 }}
              >
                <Text style={{ fontSize: 11, color: colors.textSubtle }}>🗑️</Text>
              </TouchableOpacity>
            )}
            {isMe && (
              <Text style={isRead ? [styles.readReceiptGold, { color: colors.gold }] : [styles.readReceipt, { color: colors.textSubtle }]}>
                {isFailed ? ' ⚠️' : isPending ? ' 🕒' : isRead ? ' ✓✓' : isDelivered ? ' ✓✓' : ' ✓'}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View ref={containerRef} style={styles.container} onLayout={handleContainerLayout}>
      <KeyboardAvoidingView
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingBottom: avoidancePadding,
          },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View
          ref={headerRef}
          onLayout={(e) => {
            headerLayoutRef.current = {
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            };
            runLayoutDiagnostic('header_layout');
          }}
          style={[
            styles.header,
            {
              backgroundColor: colors.card,
              borderBottomColor: colors.border,
              paddingTop: topInset > 0 ? topInset + 6 : spacing.md,
              paddingLeft: horizontalLeft,
              paddingRight: horizontalRight,
            },
          ]}
        >
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={[styles.backButtonText, { color: colors.gold }]}>←</Text>
        </TouchableOpacity>

        <View
          style={[
            styles.headerAvatarContainer,
            { borderColor: colors.border, backgroundColor: colors.cardMuted },
          ]}
          testID="chat-header-avatar-container"
        >
          {partnerAvatarUri && !avatarLoadError ? (
            <Image
              source={{ uri: partnerAvatarUri }}
              style={styles.headerAvatarImage}
              resizeMode="cover"
              onError={() => setAvatarLoadError(true)}
              testID="chat-header-avatar-image"
              accessibilityRole="image"
              accessibilityLabel={`${recipientName}'s profile picture`}
            />
          ) : (
            <View
              style={[
                styles.headerAvatarFallback,
                { backgroundColor: colors.backgroundElevated },
              ]}
              testID="chat-header-avatar-fallback"
            >
              <Text style={[styles.headerAvatarInitial, { color: colors.gold }]}>
                {recipientName ? recipientName.trim().charAt(0).toUpperCase() : '?'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
            {recipientName}
          </Text>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                connectionStatus === 'CONNECTED' ? styles.statusDotOnline : styles.statusDotOffline,
              ]}
            />
            <Text style={[styles.statusPillText, { color: colors.textMuted }]}>
              {connectionStatus === 'CONNECTED'
                ? 'Encrypted (In-Transit)'
                : connectionStatus === 'CONNECTING'
                ? 'Connecting...'
                : 'REST Fallback'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.menuButton}
          onPress={handleSafetyAction}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Safety and Member Options"
          testID="chat-safety-menu-btn"
        >
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
          style={styles.messagesListFlex}
          data={messages}
          keyExtractor={(item) => item.id || item.client_message_id || `${item.created_at}`}
          renderItem={renderMessageItem}
          inverted
          contentContainerStyle={styles.messagesList}
          onLayout={(e) => {
            messagesListLayoutRef.current = {
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            };
            runLayoutDiagnostic('flatlist_layout');
            if (isKeyboardVisible && scrollOffsetRef.current < 80) {
              flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
            }
          }}
          onScroll={(e) => {
            scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          onEndReached={loadOlderMessages}
          onEndReachedThreshold={0.2}
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          ListFooterComponent={
            isLoadingOlder ? (
              <ActivityIndicator
                size="small"
                color={colors.gold}
                style={{ marginVertical: spacing.sm }}
              />
            ) : null
          }
        />
      )}

      {/* Typing indicator */}
      {isRecipientTyping && (
        <View style={styles.typingContainer}>
          <Text style={[styles.typingText, { color: colors.gold }]}>{recipientName} is typing...</Text>
        </View>
      )}

      {/* Pending attachment preview tray */}
      {pendingAttachment && (
        <View
          style={[
            styles.attachmentPreviewTray,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
            },
          ]}
          testID="chat-attachment-preview"
        >
          {pendingAttachment.mediaType === 'AUDIO' ? (
            <View style={styles.audioPreviewContainer} testID="chat-audio-preview-tray">
              <TouchableOpacity
                style={[styles.audioPreviewPlayBtn, { backgroundColor: colors.gold }]}
                onPress={handleTogglePlayPreview}
                accessibilityRole="button"
                accessibilityLabel={previewPlayback?.isPlaying ? 'Pause preview' : 'Play preview'}
                testID="chat-audio-preview-play-btn"
              >
                <Text style={[styles.audioPreviewPlayText, { color: colors.textInverse }]}>
                  {previewPlayback?.isPlaying ? '⏸' : '▶'}
                </Text>
              </TouchableOpacity>
              <View style={styles.audioPreviewInfo}>
                <Text style={[styles.attachPreviewTitle, { color: colors.text }]}>Voice Note Preview</Text>
                <View style={styles.audioPreviewTrack}>
                  <View
                    style={[
                      styles.audioPreviewProgress,
                      {
                        backgroundColor: colors.gold,
                        width: `${
                          previewPlayback?.durationMs && previewPlayback.durationMs > 0
                            ? Math.min(100, Math.max(0, (previewPlayback.positionMs / previewPlayback.durationMs) * 100))
                            : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.attachPreviewStatus, { color: uploadStepText ? colors.gold : colors.textMuted }]}>
                  {uploadStepText ||
                    `${formatAudioDuration(previewPlayback?.positionMs || 0)} / ${formatAudioDuration(
                      pendingAttachment.durationMs || 0
                    )}`}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.attachPreviewCloseBtn, { backgroundColor: colors.backgroundElevated }]}
                onPress={handleDiscardRecordedAudio}
                accessibilityRole="button"
                accessibilityLabel="Discard voice note"
                testID="chat-discard-audio-preview-btn"
              >
                <Text style={[styles.attachPreviewCloseText, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.attachPreviewThumbWrap}>
                <Image
                  source={{ uri: pendingAttachment.uri }}
                  style={styles.attachPreviewThumb}
                  resizeMode="cover"
                />
                {pendingAttachment.mediaType === 'VIDEO' && (
                  <View style={styles.attachPreviewVideoBadge}>
                    <Text style={styles.attachPreviewVideoBadgeText}>▶</Text>
                  </View>
                )}
              </View>
              <View style={styles.attachPreviewInfo}>
                <Text style={[styles.attachPreviewTitle, { color: colors.text }]} numberOfLines={1}>
                  {pendingAttachment.mediaType === 'VIDEO' ? 'Video Attachment' : 'Photo Attachment'}
                </Text>
                <Text style={[styles.attachPreviewStatus, { color: uploadStepText ? colors.gold : colors.textMuted }]}>
                  {uploadStepText ||
                    (pendingAttachment.mediaType === 'VIDEO' && pendingAttachment.durationMs
                      ? `${Math.round(pendingAttachment.durationMs / 1000)}s`
                      : 'Ready to send')}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.attachPreviewCloseBtn, { backgroundColor: colors.backgroundElevated }]}
                onPress={handleCancelAttachment}
                accessibilityRole="button"
                accessibilityLabel="Cancel attachment"
                testID="chat-cancel-attachment-btn"
              >
                <Text style={[styles.attachPreviewCloseText, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Input bar */}
      <View
        ref={inputBarRef}
        onLayout={(e) => {
          composerLayoutRef.current = {
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          };
          runLayoutDiagnostic('input_bar_layout');
        }}
        style={[
          styles.inputBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: isKeyboardVisible ? spacing.sm : Math.max(insets.bottom, spacing.sm),
            paddingLeft: Math.max(insets.left, spacing.md),
            paddingRight: Math.max(insets.right, spacing.md),
          },
        ]}
      >
        {isRecording ? (
          <View style={styles.recordingRow}>
            {/* Cancel Recording button */}
            <TouchableOpacity
              style={[styles.recordingCancelBtn, { backgroundColor: colors.backgroundElevated }]}
              onPress={handleCancelRecording}
              accessibilityRole="button"
              accessibilityLabel="Cancel recording"
              testID="chat-cancel-recording-btn"
            >
              <Text style={styles.recordingCancelIcon}>🗑️</Text>
            </TouchableOpacity>

            {/* Recording Live Indicator & Timer */}
            <View style={styles.recordingLiveContainer}>
              <View style={styles.recordingPulseDot} />
              <Text style={[styles.recordingTimerText, { color: colors.ruby }]}>
                Recording {formatAudioDuration(recordingDurationMs)}
              </Text>
            </View>

            {/* Stop / Finish Recording button */}
            <TouchableOpacity
              style={[styles.recordingDoneBtn, { backgroundColor: colors.gold }]}
              onPress={handleStopRecording}
              accessibilityRole="button"
              accessibilityLabel="Stop recording"
              testID="chat-stop-recording-btn"
            >
              <Text style={[styles.recordingDoneText, { color: colors.textInverse }]}>✓</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.attachButton, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
              onPress={() => setIsAttachmentMenuVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Add attachment"
              testID="chat-attach-btn"
              disabled={isSending || isPickingMedia}
            >
              {isPickingMedia ? (
                <ActivityIndicator color={colors.gold} size="small" />
              ) : (
                <Text style={[styles.attachButtonText, { color: colors.gold }]}>📎</Text>
              )}
            </TouchableOpacity>

            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundElevated, borderColor: colors.border, color: colors.text }]}
              value={inputText}
              onChangeText={handleInputChange}
              placeholder="Send a private message..."
              placeholderTextColor={colors.textSubtle}
              multiline
              maxLength={1000}
            />

            <TouchableOpacity
              style={[styles.micButton, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
              onPress={handleStartRecording}
              accessibilityRole="button"
              accessibilityLabel="Record voice note"
              testID="chat-mic-btn"
              disabled={isSending || isPickingMedia}
            >
              <Text style={[styles.micButtonText, { color: colors.gold }]}>🎙️</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sendButton,
                { backgroundColor: colors.gold },
                (!inputText.trim() && !pendingAttachment) || isSending ? [styles.sendButtonDisabled, { backgroundColor: colors.cardMuted }] : null,
              ]}
              onPress={handleSend}
              disabled={(!inputText.trim() && !pendingAttachment) || isSending}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Send Message"
              testID="chat-send-btn"
            >
              {isSending ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <Text style={[styles.sendButtonText, { color: colors.textInverse }]}>↑</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Safety & Member Options Modal */}
      <Modal
        visible={isSafetyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleModalRequestClose}
        statusBarTranslucent
        testID="safety-options-modal"
      >
        <View style={styles.safetyBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleCloseSafetyModal}
            disabled={isDestructiveInProgress}
            accessibilityLabel="Dismiss options"
            accessibilityRole="button"
            testID="safety-modal-backdrop"
          />

          <View
            style={[
              styles.safetyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            testID="safety-card-container"
          >
            {/* Header */}
            <View style={[styles.safetyHeader, { borderBottomColor: colors.border }]}>
              <View style={styles.safetyHeaderTitleCol}>
                <Text style={[styles.safetyTitle, { color: colors.text }]}>
                  {safetyModalStep === 'MENU' && 'Safety & Member Options'}
                  {safetyModalStep === 'REPORT' && 'Report Member'}
                  {safetyModalStep === 'BLOCK_CONFIRM' && 'Block Member?'}
                  {safetyModalStep === 'UNMATCH_CONFIRM' && 'Unmatch Member?'}
                </Text>
                <Text style={[styles.safetySubtitle, { color: colors.textMuted }]}>
                  {safetyModalStep === 'MENU' && `Manage your conversation with ${recipientName}`}
                  {safetyModalStep === 'REPORT' && 'Select the reason for this report:'}
                  {safetyModalStep === 'BLOCK_CONFIRM' && `You will never see ${recipientName} again`}
                  {safetyModalStep === 'UNMATCH_CONFIRM' && `Remove conversation with ${recipientName}`}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.safetyCloseBtn, { backgroundColor: colors.backgroundElevated }]}
                onPress={handleCloseSafetyModal}
                disabled={isDestructiveInProgress}
                accessibilityLabel="Close safety modal"
                accessibilityRole="button"
                testID="safety-close-btn"
              >
                <Text style={[styles.safetyCloseText, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Step 1: Main Menu */}
            {safetyModalStep === 'MENU' && (
              <View style={styles.safetyBody}>
                <TouchableOpacity
                  style={[styles.safetyOptionRow, { borderBottomColor: colors.border }]}
                  onPress={() => setSafetyModalStep('REPORT')}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.7}
                  testID="safety-option-report"
                >
                  <Text style={styles.safetyOptionIcon}>🚩</Text>
                  <View style={styles.safetyOptionTextWrap}>
                    <Text style={[styles.safetyOptionTitle, { color: colors.gold }]}>Report Member</Text>
                    <Text style={[styles.safetyOptionDesc, { color: colors.textSubtle }]}>
                      Report harassment, fake profiles, or safety violations
                    </Text>
                  </View>
                  <Text style={[styles.safetyOptionChevron, { color: colors.textSubtle }]}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.safetyOptionRow, { borderBottomColor: colors.border }]}
                  onPress={() => setSafetyModalStep('BLOCK_CONFIRM')}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.7}
                  testID="safety-option-block"
                >
                  <Text style={styles.safetyOptionIcon}>🚫</Text>
                  <View style={styles.safetyOptionTextWrap}>
                    <Text style={[styles.safetyOptionTitle, { color: colors.ruby }]}>Block Member</Text>
                    <Text style={[styles.safetyOptionDesc, { color: colors.textSubtle }]}>
                      Permanently block and hide all conversation history
                    </Text>
                  </View>
                  <Text style={[styles.safetyOptionChevron, { color: colors.textSubtle }]}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.safetyOptionRow, { borderBottomColor: colors.border }]}
                  onPress={() => setSafetyModalStep('UNMATCH_CONFIRM')}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.7}
                  testID="safety-option-unmatch"
                >
                  <Text style={styles.safetyOptionIcon}>💔</Text>
                  <View style={styles.safetyOptionTextWrap}>
                    <Text style={[styles.safetyOptionTitle, { color: colors.ruby }]}>Unmatch</Text>
                    <Text style={[styles.safetyOptionDesc, { color: colors.textSubtle }]}>
                      Remove this match and conversation from your feed
                    </Text>
                  </View>
                  <Text style={[styles.safetyOptionChevron, { color: colors.textSubtle }]}>›</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.safetyCancelBtn,
                    { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                  ]}
                  onPress={handleCloseSafetyModal}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.8}
                  testID="safety-cancel-btn"
                >
                  <Text style={[styles.safetyCancelBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 2: Report Reasons */}
            {safetyModalStep === 'REPORT' && (
              <View style={styles.safetyBody}>
                {REPORT_REASONS.map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.safetyReasonRow, { borderBottomColor: colors.border }]}
                    onPress={() => handleSelectReportReason(r.key)}
                    disabled={isDestructiveInProgress}
                    activeOpacity={0.7}
                    testID={`safety-report-reason-${r.key.toLowerCase()}`}
                  >
                    <Text style={[styles.safetyReasonText, { color: colors.text }]}>{r.label}</Text>
                    <Text style={[styles.safetyOptionChevron, { color: colors.gold }]}>›</Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity
                  style={[
                    styles.safetyCancelBtn,
                    { backgroundColor: colors.backgroundElevated, borderColor: colors.border, marginTop: spacing.md },
                  ]}
                  onPress={() => setSafetyModalStep('MENU')}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.8}
                  testID="safety-report-back-btn"
                >
                  <Text style={[styles.safetyCancelBtnText, { color: colors.text }]}>← Back to Options</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 3: Block Confirmation */}
            {safetyModalStep === 'BLOCK_CONFIRM' && (
              <View style={styles.safetyBody}>
                <Text style={[styles.safetyConfirmWarning, { color: colors.textMuted }]}>
                  Are you sure you want to block <Text style={{ color: colors.text, fontWeight: '700' }}>{recipientName}</Text>?
                  {'\n\n'}You will never see each other again, and all conversation history will be permanently hidden.
                </Text>

                <TouchableOpacity
                  style={[styles.safetyDestructiveBtn, { backgroundColor: colors.ruby }]}
                  onPress={handleConfirmBlock}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.8}
                  testID="safety-confirm-block-btn"
                >
                  {isDestructiveInProgress ? (
                    <ActivityIndicator color={colors.textInverse} size="small" />
                  ) : (
                    <Text style={[styles.safetyDestructiveBtnText, { color: colors.textInverse }]}>
                      Yes, Block {recipientName}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.safetyCancelBtn,
                    { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                  ]}
                  onPress={() => setSafetyModalStep('MENU')}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.8}
                  testID="safety-block-cancel-btn"
                >
                  <Text style={[styles.safetyCancelBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 4: Unmatch Confirmation */}
            {safetyModalStep === 'UNMATCH_CONFIRM' && (
              <View style={styles.safetyBody}>
                <Text style={[styles.safetyConfirmWarning, { color: colors.textMuted }]}>
                  Are you sure you want to unmatch <Text style={{ color: colors.text, fontWeight: '700' }}>{recipientName}</Text>?
                  {'\n\n'}This conversation will be permanently removed.
                </Text>

                <TouchableOpacity
                  style={[styles.safetyDestructiveBtn, { backgroundColor: colors.ruby }]}
                  onPress={handleConfirmUnmatch}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.8}
                  testID="safety-confirm-unmatch-btn"
                >
                  {isDestructiveInProgress ? (
                    <ActivityIndicator color={colors.textInverse} size="small" />
                  ) : (
                    <Text style={[styles.safetyDestructiveBtnText, { color: colors.textInverse }]}>
                      Yes, Unmatch
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.safetyCancelBtn,
                    { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                  ]}
                  onPress={() => setSafetyModalStep('MENU')}
                  disabled={isDestructiveInProgress}
                  activeOpacity={0.8}
                  testID="safety-unmatch-cancel-btn"
                >
                  <Text style={[styles.safetyCancelBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Attachment Options Modal */}
      <Modal
        visible={isAttachmentMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAttachmentMenuVisible(false)}
        statusBarTranslucent
        testID="chat-attachment-menu"
      >
        <View style={styles.safetyBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsAttachmentMenuVisible(false)}
            accessibilityLabel="Dismiss attachment options"
            accessibilityRole="button"
          />
          <View
            style={[
              styles.safetyCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[styles.safetyHeader, { borderBottomColor: colors.border }]}>
              <View style={styles.safetyHeaderTitleCol}>
                <Text style={[styles.safetyTitle, { color: colors.text }]}>Share Media</Text>
                <Text style={[styles.safetySubtitle, { color: colors.textMuted }]}>
                  Private attachment for {recipientName}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.safetyCloseBtn, { backgroundColor: colors.backgroundElevated }]}
                onPress={() => setIsAttachmentMenuVisible(false)}
                accessibilityLabel="Close media menu"
                accessibilityRole="button"
              >
                <Text style={[styles.safetyCloseText, { color: colors.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.safetyBody}>
              <TouchableOpacity
                style={[styles.safetyOptionRow, { borderBottomColor: colors.border }]}
                onPress={handlePickPhoto}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Share Photo"
                testID="chat-attach-photo-btn"
              >
                <Text style={styles.safetyOptionIcon}>🖼️</Text>
                <View style={styles.safetyOptionTextWrap}>
                  <Text style={[styles.safetyOptionTitle, { color: colors.text }]}>Share Photo</Text>
                  <Text style={[styles.safetyOptionDesc, { color: colors.textSubtle }]}>
                    Select photo from device library (max 15MB)
                  </Text>
                </View>
                <Text style={[styles.safetyOptionChevron, { color: colors.gold }]}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.safetyOptionRow, { borderBottomColor: colors.border }]}
                onPress={handlePickVideo}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Share Video"
                testID="chat-attach-video-btn"
              >
                <Text style={styles.safetyOptionIcon}>🎥</Text>
                <View style={styles.safetyOptionTextWrap}>
                  <Text style={[styles.safetyOptionTitle, { color: colors.text }]}>Share Video</Text>
                  <Text style={[styles.safetyOptionDesc, { color: colors.textSubtle }]}>
                    Select video from device library (max 60s, 100MB)
                  </Text>
                </View>
                <Text style={[styles.safetyOptionChevron, { color: colors.gold }]}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.safetyOptionRow, { borderBottomColor: colors.border }]}
                onPress={() => {
                  setIsAttachmentMenuVisible(false);
                  setTimeout(() => {
                    handleStartRecording();
                  }, 150);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Record Voice Note"
                testID="chat-attach-voice-btn"
              >
                <Text style={styles.safetyOptionIcon}>🎙️</Text>
                <View style={styles.safetyOptionTextWrap}>
                  <Text style={[styles.safetyOptionTitle, { color: colors.text }]}>Voice Note</Text>
                  <Text style={[styles.safetyOptionDesc, { color: colors.textSubtle }]}>
                    Record and share a compact voice message
                  </Text>
                </View>
                <Text style={[styles.safetyOptionChevron, { color: colors.gold }]}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.safetyCancelBtn,
                  { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
                ]}
                onPress={() => setIsAttachmentMenuVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.safetyCancelBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Fullscreen Photo Viewer Modal */}
      <Modal
        visible={Boolean(viewingImage)}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingImage(null)}
        statusBarTranslucent
        testID="chat-image-viewer-modal"
      >
        <View style={styles.mediaViewerBackdrop}>
          <TouchableOpacity
            style={styles.mediaViewerCloseBtn}
            onPress={() => setViewingImage(null)}
            accessibilityRole="button"
            accessibilityLabel="Close image viewer"
            testID="chat-image-viewer-close-btn"
          >
            <Text style={styles.mediaViewerCloseText}>✕</Text>
          </TouchableOpacity>
          {viewingImage && (
            <Image
              source={{ uri: viewingImage.url }}
              style={styles.mediaViewerFullImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

      {/* Video Player / Viewer Modal */}
      <Modal
        visible={Boolean(viewingVideo)}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingVideo(null)}
        statusBarTranslucent
        testID="chat-video-viewer-modal"
      >
        <View style={styles.mediaViewerBackdrop}>
          <TouchableOpacity
            style={styles.mediaViewerCloseBtn}
            onPress={() => setViewingVideo(null)}
            accessibilityRole="button"
            accessibilityLabel="Close video viewer"
            testID="chat-video-viewer-close-btn"
          >
            <Text style={styles.mediaViewerCloseText}>✕</Text>
          </TouchableOpacity>
          {viewingVideo && (
            <View style={styles.videoPlayerContainer}>
              {viewingVideo.posterUrl ? (
                <Image
                  source={{ uri: viewingVideo.posterUrl }}
                  style={styles.videoPlayerPoster}
                  resizeMode="contain"
                />
              ) : null}
              <View style={styles.videoPlayerControls}>
                <TouchableOpacity
                  style={[styles.videoPlayExternalBtn, { backgroundColor: colors.gold }]}
                  onPress={() => {
                    if (viewingVideo.url) {
                      Linking.openURL(viewingVideo.url).catch(() => {
                        Alert.alert('Unable to Play Video', 'Could not open video player.');
                      });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Play video externally"
                  testID="chat-video-play-external-btn"
                >
                  <Text style={[styles.videoPlayExternalBtnText, { color: colors.textInverse }]}>
                    ▶ Play Full Video
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  </View>
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
  headerAvatarContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    backgroundColor: colors.cardMuted,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  headerAvatarImage: {
    width: '100%',
    height: '100%',
  },
  headerAvatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 19,
    backgroundColor: colors.backgroundElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarInitial: {
    ...typography.body,
    fontWeight: '700',
    color: colors.gold,
    fontSize: 16,
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
  messagesListFlex: {
    flex: 1,
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
  safetyBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  safetyCard: {
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'android' ? spacing.xl : 36,
    paddingHorizontal: spacing.lg,
  },
  safetyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    marginBottom: spacing.xs,
  },
  safetyHeaderTitleCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  safetyTitle: {
    ...typography.h3,
    fontSize: 18,
    fontWeight: '700',
  },
  safetySubtitle: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 2,
  },
  safetyCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  safetyCloseText: {
    fontSize: 14,
    fontWeight: '700',
  },
  safetyBody: {
    paddingVertical: spacing.xs,
  },
  safetyOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  safetyOptionIcon: {
    fontSize: 20,
    marginRight: spacing.md,
  },
  safetyOptionTextWrap: {
    flex: 1,
  },
  safetyOptionTitle: {
    ...typography.body,
    fontSize: 15,
    fontWeight: '600',
  },
  safetyOptionDesc: {
    ...typography.caption,
    fontSize: 12,
    marginTop: 2,
  },
  safetyOptionChevron: {
    fontSize: 18,
    fontWeight: '700',
    paddingLeft: spacing.xs,
  },
  safetyCancelBtn: {
    height: 46,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  safetyCancelBtnText: {
    ...typography.button,
    fontSize: 14,
    fontWeight: '600',
  },
  safetyReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  safetyReasonText: {
    ...typography.body,
    fontSize: 14,
  },
  safetyConfirmWarning: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
    marginVertical: spacing.md,
  },
  safetyDestructiveBtn: {
    height: 46,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  safetyDestructiveBtnText: {
    ...typography.button,
    fontSize: 14,
    fontWeight: '700',
  },
  attachButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
    borderWidth: 1,
  },
  attachButtonText: {
    fontSize: 18,
  },
  attachmentPreviewTray: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
  },
  attachPreviewThumbWrap: {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    backgroundColor: colors.backgroundElevated,
  },
  attachPreviewThumb: {
    width: 48,
    height: 48,
  },
  attachPreviewVideoBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  attachPreviewVideoBadgeText: {
    color: '#ffffff',
    fontSize: 8,
    fontWeight: '700',
  },
  attachPreviewInfo: {
    flex: 1,
    marginLeft: spacing.sm,
    justifyContent: 'center',
  },
  attachPreviewTitle: {
    ...typography.caption,
    fontSize: 13,
    fontWeight: '600',
  },
  attachPreviewStatus: {
    ...typography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  attachPreviewCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  attachPreviewCloseText: {
    fontSize: 12,
    fontWeight: '700',
  },
  msgMediaThumbWrap: {
    position: 'relative',
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    marginBottom: 4,
    backgroundColor: colors.backgroundElevated,
    minWidth: 160,
    maxWidth: 240,
    aspectRatio: 4 / 3,
  },
  msgMediaImage: {
    width: '100%',
    height: '100%',
  },
  msgMediaVideoPoster: {
    width: '100%',
    height: '100%',
  },
  mediaPlaceholderBox: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
  },
  mediaErrorBox: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  mediaErrorIcon: {
    fontSize: 22,
    marginBottom: 2,
  },
  mediaErrorText: {
    ...typography.caption,
    color: colors.ruby,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  mediaRetryBtn: {
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  mediaRetryLink: {
    ...typography.caption,
    color: colors.ruby,
    fontSize: 11,
    fontWeight: '700',
  },
  msgVideoPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  msgVideoPlayCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  msgVideoPlayTriangle: {
    color: '#ffffff',
    fontSize: 18,
    marginLeft: 3,
  },
  msgVideoDurationPill: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  msgVideoDurationText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '600',
  },
  msgPendingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBubbleRow: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  retryBubbleText: {
    ...typography.caption,
    color: colors.ruby,
    fontSize: 11,
    fontWeight: '600',
  },
  mediaViewerBackdrop: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerCloseBtn: {
    position: 'absolute',
    top: 44,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaViewerCloseText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  mediaViewerFullImage: {
    width: '100%',
    height: '100%',
  },
  videoPlayerContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayerPoster: {
    width: '100%',
    height: '70%',
  },
  videoPlayerControls: {
    position: 'absolute',
    bottom: 60,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  videoPlayExternalBtn: {
    height: 48,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  videoPlayExternalBtnText: {
    ...typography.button,
    fontSize: 15,
    fontWeight: '700',
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
    borderWidth: 1,
  },
  micButtonText: {
    fontSize: 18,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  recordingCancelBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  recordingCancelIcon: {
    fontSize: 18,
  },
  recordingLiveContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  recordingPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.ruby,
    marginRight: 8,
  },
  recordingTimerText: {
    ...typography.body,
    fontWeight: '700',
    fontSize: 14,
  },
  recordingDoneBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingDoneText: {
    fontSize: 20,
    fontWeight: '700',
  },
  audioPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  audioPreviewPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  audioPreviewPlayText: {
    fontSize: 16,
  },
  audioPreviewInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  audioPreviewTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginVertical: 4,
    overflow: 'hidden',
  },
  audioPreviewProgress: {
    height: '100%',
    borderRadius: 2,
  },
  voiceBubbleContainer: {
    paddingVertical: 4,
    minWidth: 190,
    maxWidth: 250,
  },
  voiceErrorContainer: {
    alignItems: 'center',
    padding: spacing.xs,
  },
  voiceControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  voicePlayPauseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  voicePlayPauseIcon: {
    fontSize: 16,
    fontWeight: '700',
  },
  voiceWaveformCol: {
    flex: 1,
    justifyContent: 'center',
  },
  voiceTrackContainer: {
    paddingVertical: 6,
  },
  voiceTrackBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  voiceTrackProgress: {
    height: '100%',
    borderRadius: 3,
  },
  voiceMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  voiceDurationText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
  },
  voiceTypeBadge: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
  },
});
