import { Tabs, usePathname } from "expo-router";
import { useRef, useEffect } from "react";
import { Animated, Pressable, Text, View, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { C } from "../../utils/designSystem";

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
  { name: "split",   label: "Split",   icon: "timer"   } as const,
  { name: "friends", label: "Friends", icon: "people"  } as const,
  { name: "profile", label: "Profile", icon: "person"  } as const,
];

// ── Tab button ────────────────────────────────────────────────────────────────

function TabButton({
  label, icon, active, onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  active: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn  = () =>
    Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 30 }).start();
  const handlePressOut = () =>
    Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 20 }).start();

  const color = active ? C.brandShadow : C.textTertiary;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={{ flex: 1, alignItems: "center" }}
    >
      <Animated.View
        style={{
          transform: [{ scale }],
          alignItems: "center",
          paddingVertical: 8,
          gap: 3,
        }}
      >
        <Ionicons
          name={active ? icon : (`${icon}-outline` as any)}
          size={22}
          color={color}
        />
        <Text style={{
          fontSize: 11,
          fontWeight: active ? "500" : "400",
          color,
        }}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ── Custom tab bar ────────────────────────────────────────────────────────────

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={{
      position: "absolute",
      bottom: 0, left: 0, right: 0,
      paddingBottom: Platform.OS === "ios" ? 20 : 8,
      paddingTop: 8,
      paddingHorizontal: 16,
      backgroundColor: C.surface,
      borderTopWidth: 0.5,
      borderTopColor: C.borderTertiary,
      flexDirection: "row",
      alignItems: "center",
    }}>
      {TABS.map((tab) => {
        const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
        const active = state.index === routeIndex;
        return (
          <TabButton
            key={tab.name}
            label={tab.label}
            icon={tab.icon}
            active={active}
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: state.routes[routeIndex].key,
                canPreventDefault: true,
              });
              if (!active && !event.defaultPrevented) navigation.navigate(tab.name);
            }}
          />
        );
      })}
    </View>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="split"
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false, tabBarStyle: { display: "none" }, contentStyle: { backgroundColor: "#30302E" } }}
    >
      {/* Visible tabs */}
      <Tabs.Screen name="split"   />
      <Tabs.Screen name="friends" />
      <Tabs.Screen name="profile" />
      {/* Hidden — still routable */}
      <Tabs.Screen name="index"   />
      <Tabs.Screen name="stats"   />
    </Tabs>
  );
}
