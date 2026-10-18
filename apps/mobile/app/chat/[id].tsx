import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChatRoom } from '../../src/components/ChatRoom';
import { useTheme } from '../../src/theme';

export default function ChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string; recipientId?: string; avatar?: string }>();

  const conversationId = params.id || '';
  const recipientName = params.name || 'Member';
  const recipientId = params.recipientId || '';
  const recipientAvatar = params.avatar;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ChatRoom
        conversationId={conversationId}
        recipientName={recipientName}
        recipientId={recipientId}
        recipientAvatar={recipientAvatar}
        onBack={() => router.back()}
        onUnmatched={() => router.replace('/(tabs)/matches')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
