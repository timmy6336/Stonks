import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { WatchlistScreen } from '../screens/WatchlistScreen';
import { TrendingScreen } from '../screens/TrendingScreen';
import { CompareScreen } from '../screens/CompareScreen';
import { StockDetailScreen } from '../screens/StockDetailScreen';
import { AlertsScreen } from '../screens/AlertsScreen';
import { PortfolioScreen } from '../screens/PortfolioScreen';
import { ProfilesScreen } from '../screens/ProfilesScreen';
import { AiDecisionDetailScreen } from '../screens/AiDecisionDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { HowItWorksScreen } from '../screens/HowItWorksScreen';
import { SignalTrackRecordScreen } from '../screens/SignalTrackRecordScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { getAppStateValue, setAppStateValue } from '../db/database';
import { maybeSendDailyDigest } from '../notifications/dailyDigest';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useTheme } from '../theme/ThemeContext';
import type {
  PortfolioStackParamList,
  RootTabParamList,
  SettingsStackParamList,
  TrendingStackParamList,
  WatchlistStackParamList,
} from './types';

const ONBOARDED_KEY = 'has_onboarded';

const Tab = createBottomTabNavigator<RootTabParamList>();
const WatchlistStack = createNativeStackNavigator<WatchlistStackParamList>();
const TrendingStack = createNativeStackNavigator<TrendingStackParamList>();
const PortfolioStack = createNativeStackNavigator<PortfolioStackParamList>();
const SettingsStack = createNativeStackNavigator<SettingsStackParamList>();

function WatchlistStackScreen() {
  const { colors } = useTheme();
  return (
    <WatchlistStack.Navigator>
      <WatchlistStack.Screen
        name="Watchlist"
        component={WatchlistScreen}
        options={({ navigation }) => ({
          title: 'Watchlist',
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate('Alerts')} hitSlop={8} style={{ marginRight: 4 }}>
              <Ionicons name="notifications-outline" size={22} color={colors.accent} />
            </Pressable>
          ),
        })}
      />
      <WatchlistStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }) => ({ title: route.params.symbol })}
      />
      <WatchlistStack.Screen name="Alerts" component={AlertsScreen} options={{ title: 'Alerts' }} />
    </WatchlistStack.Navigator>
  );
}

function TrendingStackScreen() {
  const { colors } = useTheme();
  return (
    <TrendingStack.Navigator>
      <TrendingStack.Screen
        name="Trending"
        component={TrendingScreen}
        options={({ navigation }) => ({
          title: 'Trending',
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate('Compare')} hitSlop={8} style={{ marginRight: 4 }}>
              <Ionicons name="git-compare-outline" size={22} color={colors.accent} />
            </Pressable>
          ),
        })}
      />
      <TrendingStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }) => ({ title: route.params.symbol })}
      />
      <TrendingStack.Screen name="Compare" component={CompareScreen} options={{ title: 'Compare' }} />
    </TrendingStack.Navigator>
  );
}

function PortfolioStackScreen() {
  return (
    <PortfolioStack.Navigator>
      <PortfolioStack.Screen name="Portfolio" component={PortfolioScreen} options={{ title: 'Portfolio' }} />
      <PortfolioStack.Screen name="Profiles" component={ProfilesScreen} options={{ title: 'Saves' }} />
      <PortfolioStack.Screen
        name="AiDecisionDetail"
        component={AiDecisionDetailScreen}
        options={{ title: 'AI Decision' }}
      />
    </PortfolioStack.Navigator>
  );
}

function SettingsStackScreen() {
  return (
    <SettingsStack.Navigator>
      <SettingsStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <SettingsStack.Screen name="HowItWorks" component={HowItWorksScreen} options={{ title: 'How this works' }} />
      <SettingsStack.Screen
        name="SignalTrackRecord"
        component={SignalTrackRecordScreen}
        options={{ title: 'Signal track record' }}
      />
    </SettingsStack.Navigator>
  );
}

const TAB_ICONS: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  WatchlistTab: 'eye',
  TrendingTab: 'trending-up',
  PortfolioTab: 'wallet',
  SettingsTab: 'settings',
};

function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => <Ionicons name={TAB_ICONS[route.name]} color={color} size={size} />,
      })}
    >
      <Tab.Screen name="WatchlistTab" options={{ title: 'Watchlist' }}>
        {() => (
          <ErrorBoundary>
            <WatchlistStackScreen />
          </ErrorBoundary>
        )}
      </Tab.Screen>
      <Tab.Screen name="TrendingTab" options={{ title: 'Trending' }}>
        {() => (
          <ErrorBoundary>
            <TrendingStackScreen />
          </ErrorBoundary>
        )}
      </Tab.Screen>
      <Tab.Screen name="PortfolioTab" options={{ title: 'Portfolio' }}>
        {() => (
          <ErrorBoundary>
            <PortfolioStackScreen />
          </ErrorBoundary>
        )}
      </Tab.Screen>
      <Tab.Screen name="SettingsTab" options={{ title: 'Settings' }}>
        {() => (
          <ErrorBoundary>
            <SettingsStackScreen />
          </ErrorBoundary>
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { colors, scheme } = useTheme();
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    (async () => {
      const onboarded = await getAppStateValue(ONBOARDED_KEY);
      setNeedsOnboarding(!onboarded);
      setCheckingOnboarding(false);
      if (onboarded) {
        maybeSendDailyDigest().catch(() => {}); // best-effort; never block startup on it
      }
    })();
  }, []);

  const handleOnboardingDone = () => {
    setAppStateValue(ONBOARDED_KEY, '1').catch(() => {});
    setNeedsOnboarding(false);
    maybeSendDailyDigest().catch(() => {});
  };

  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.accent,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
    },
  };

  if (checkingOnboarding) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (needsOnboarding) {
    return <OnboardingScreen onDone={handleOnboardingDone} />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <MainTabs />
    </NavigationContainer>
  );
}
