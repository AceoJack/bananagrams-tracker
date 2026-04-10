import { useCallback, useRef } from "react";
import { Animated, View } from "react-native";
import { useFocusEffect } from "expo-router";

export function FadeInView({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    }, [])
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#30302E" }}>
      <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>
    </View>
  );
}
