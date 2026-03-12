import { Tabs, usePathname } from "expo-router";
import { useRef, useEffect } from "react";
import { Animated, Pressable, Text, View, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = [
  { name: "index",  label: "Home",  icon: "home"          } as const,
  { name: "split",  label: "Split", icon: "timer"           } as const,
  { name: "stats",  label: "Stats", icon: "stats-chart"    } as const,
];

// ── Animated tab button ───────────────────────────────────────────────────────

function TabButton({
  label, icon, active, onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  active: boolean;
  onPress: () => void;
}) {
  const bg    = useRef(new Animated.Value(active ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(bg, { toValue: active ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [active]);

  const bgColor = bg.interpolate({ inputRange: [0, 1], outputRange: ["rgba(0,0,0,0)", "rgba(17,17,17,1)"] });

  const handlePressIn  = () => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 30 }).start();
  const handlePressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 20 }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={{ flex: 1, alignItems: "center" }}
    >
      <Animated.View style={{
        transform: [{ scale }],
        alignItems: "center",
        paddingVertical: 8,
        paddingHorizontal: 18,
        borderRadius: 20,
        backgroundColor: bgColor,
        minWidth: 64,
        gap: 3,
      }}>
        <Ionicons
          name={active ? icon : (`${icon}-outline` as any)}
          size={22}
          color={active ? "#fff" : "#999"}
        />
        <Text style={{ fontSize: 11, fontWeight: active ? "700" : "400", color: active ? "#fff" : "#999" }}>
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
      position: "absolute", bottom: 0, left: 0, right: 0,
      paddingBottom: Platform.OS === "ios" ? 28 : 12,
      paddingTop: 10,
      paddingHorizontal: 16,
      backgroundColor: "#fff",
      borderTopWidth: 1,
      borderTopColor: "#f0f0f0",
      flexDirection: "row",
      alignItems: "center",
      // Shadow
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 16,
    }}>
      {TABS.map((tab, i) => {
        const active = state.index === i;
        return (
          <TabButton
            key={tab.name}
            label={tab.label}
            icon={tab.icon}
            active={active}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: state.routes[i].key, canPreventDefault: true });
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
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="split" />
      <Tabs.Screen name="stats" />
    </Tabs>
  );
}
