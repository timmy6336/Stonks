import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { WatchlistScreen } from '../screens/WatchlistScreen';
import { TrendingScreen } from '../screens/TrendingScreen';
import { StockDetailScreen } from '../screens/StockDetailScreen';
import { PortfolioScreen } from '../screens/PortfolioScreen';
import { ProfilesScreen } from '../screens/ProfilesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { PortfolioStackParamList, RootTabParamList, TrendingStackParamList, WatchlistStackParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();
const WatchlistStack = createNativeStackNavigator<WatchlistStackParamList>();
const TrendingStack = createNativeStackNavigator<TrendingStackParamList>();
const PortfolioStack = createNativeStackNavigator<PortfolioStackParamList>();

function WatchlistStackScreen() {
  return (
    <WatchlistStack.Navigator>
      <WatchlistStack.Screen name="Watchlist" component={WatchlistScreen} options={{ title: 'Watchlist' }} />
      <WatchlistStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }) => ({ title: route.params.symbol })}
      />
    </WatchlistStack.Navigator>
  );
}

function TrendingStackScreen() {
  return (
    <TrendingStack.Navigator>
      <TrendingStack.Screen name="Trending" component={TrendingScreen} options={{ title: 'Trending' }} />
      <TrendingStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }) => ({ title: route.params.symbol })}
      />
    </TrendingStack.Navigator>
  );
}

function PortfolioStackScreen() {
  return (
    <PortfolioStack.Navigator>
      <PortfolioStack.Screen name="Portfolio" component={PortfolioScreen} options={{ title: 'Portfolio' }} />
      <PortfolioStack.Screen name="Profiles" component={ProfilesScreen} options={{ title: 'Saves' }} />
    </PortfolioStack.Navigator>
  );
}

const TAB_ICONS: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  WatchlistTab: 'eye',
  TrendingTab: 'trending-up',
  PortfolioTab: 'wallet',
  Settings: 'settings',
};

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: '#0a7d32',
          tabBarInactiveTintColor: '#8a8a8a',
          tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name]} color={color} size={size} />,
        })}
      >
        <Tab.Screen name="WatchlistTab" component={WatchlistStackScreen} options={{ title: 'Watchlist' }} />
        <Tab.Screen name="TrendingTab" component={TrendingStackScreen} options={{ title: 'Trending' }} />
        <Tab.Screen name="PortfolioTab" component={PortfolioStackScreen} options={{ title: 'Portfolio' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
