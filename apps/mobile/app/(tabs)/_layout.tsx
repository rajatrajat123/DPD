import React from 'react';
import { Tabs } from 'expo-router';
import { Text, Platform, StyleSheet } from 'react-native';
import { colors, typography, spacing } from '../../src/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
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
    height: Platform.OS === 'ios' ? 88 : 66,
    paddingBottom: Platform.OS === 'ios' ? 26 : 10,
    paddingTop: 8,
  },
  tabBarLabel: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
