import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChatRoom } from '../../src/components/ChatRoom';
import { colors } from '../../src/theme';

export default function ChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; name?: string; recipientId?: string }>();

  const conversationId = params.id || '';
  const recipientName = params.name || 'Member';
  const recipientId = params.recipientId || '';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ChatRoom
        conversationId={conversationId}
        recipientName={recipientName}
        recipientId={recipientId}
        onBack={() => router.back()}
        onUnmatched={() => router.replace('/(tabs)/matches')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
