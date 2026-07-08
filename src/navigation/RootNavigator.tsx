import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WatchlistScreen } from '../screens/WatchlistScreen';
import { StockDetailScreen } from '../screens/StockDetailScreen';
import { PortfolioScreen } from '../screens/PortfolioScreen';
import { ProfilesScreen } from '../screens/ProfilesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { PortfolioStackParamList, RootTabParamList, WatchlistStackParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();
const WatchlistStack = createNativeStackNavigator<WatchlistStackParamList>();
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

function PortfolioStackScreen() {
  return (
    <PortfolioStack.Navigator>
      <PortfolioStack.Screen name="Portfolio" component={PortfolioScreen} options={{ title: 'Portfolio' }} />
      <PortfolioStack.Screen name="Profiles" component={ProfilesScreen} options={{ title: 'Saves' }} />
    </PortfolioStack.Navigator>
  );
}

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="WatchlistTab" component={WatchlistStackScreen} options={{ title: 'Watchlist' }} />
        <Tab.Screen name="PortfolioTab" component={PortfolioStackScreen} options={{ title: 'Portfolio' }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
