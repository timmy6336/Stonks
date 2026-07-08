import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WatchlistScreen } from '../screens/WatchlistScreen';
import { StockDetailScreen } from '../screens/StockDetailScreen';
import { PortfolioScreen } from '../screens/PortfolioScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { RootTabParamList, WatchlistStackParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();
const WatchlistStack = createNativeStackNavigator<WatchlistStackParamList>();

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

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="WatchlistTab" component={WatchlistStackScreen} options={{ title: 'Watchlist' }} />
        <Tab.Screen name="Portfolio" component={PortfolioScreen} options={{ headerShown: true }} />
        <Tab.Screen name="Settings" component={SettingsScreen} options={{ headerShown: true }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
