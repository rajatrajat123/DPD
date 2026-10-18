import React from 'react';
import { Tabs } from 'expo-router';
import { Text, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, useTheme } from '../../src/theme';
import { chatService } from '../../src/services/chat/chatService';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [totalUnread, setTotalUnread] = React.useState<number>(chatService.getTotalUnreadCount());

  React.useEffect(() => {
    chatService.refreshUnreadCount().catch(() => {});
    const unsub = chatService.onUnreadCountChange((count) => {
      setTotalUnread(count);
    });
    return unsub;
  }, []);

  // Dynamic bottom inset: on Android adapt to 3-button nav, gesture nav, or curved screens
  const bottomInset = Platform.OS === 'android'
    ? Math.max(insets.bottom, 16)
    : (insets.bottom > 0 ? insets.bottom : 12);

  // Tab content area height (icon + label + spacing) is ~52dp, guaranteeing >= 48dp touch targets
  const tabContentHeight = 52;
  const tabBarHeight = tabContentHeight + bottomInset;

  // Horizontal insets prevent edge tabs (Discover and Profile) from clipping on curved displays
  const horizontalInset = Math.max(insets.left, insets.right, 6);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.borderSubtle,
            height: tabBarHeight,
            paddingBottom: bottomInset + 4,
            paddingHorizontal: horizontalInset,
          },
        ],
        tabBarItemStyle: styles.tabBarItem,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarLabelStyle: styles.tabBarLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 19 }}>✦</Text>,
        }}
      />
      <Tabs.Screen
        name="likes"
        options={{
          title: 'Likes',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>♥</Text>,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💬</Text>,
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.gold,
            color: colors.textInverse,
            fontSize: 10,
            fontWeight: '700',
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            lineHeight: Platform.OS === 'android' ? 16 : 18,
            textAlign: 'center',
          },
        }}
      />
      <Tabs.Screen
        name="membership"
        options={{
          title: 'Aura VIP',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👑</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👤</Text>,
        }}
      />

      {/* Hidden secondary screens accessible from Profile / Links */}
      <Tabs.Screen
        name="matches"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="vip"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0E1017',
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 6,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  tabBarItem: {
    minHeight: 48,
    paddingVertical: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBarLabel: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
});
