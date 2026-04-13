import { useEffect, useRef } from "react";
import { Animated, Image, Modal, Platform, Pressable, Text, View } from "react-native";
import { Audio } from "expo-av";
import { playSound } from "../utils/sound";

export function CelebrationOverlay({
  type,
  playerName,
  onDone,
}: {
  type: "bananas" | "rotten";
  playerName?: string;
  onDone: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.7)).current;
  const isBananas = type === "bananas";

  useEffect(() => {
    // Animate in
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 180 }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    // Play sound
    let soundObj: Audio.Sound | null = null;
    if (Platform.OS === "web") {
      playSound(isBananas ? "bananas" : "rotten");
    } else {
      (async () => {
        try {
          await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false });
          const source = isBananas
            ? require("../assets/sounds/bananas.mp3")
            : require("../assets/sounds/rotten-bananas.mp3");
          const { sound } = await Audio.Sound.createAsync(source);
          soundObj = sound;
          await sound.playAsync();
        } catch (e) {
          // Sound is optional — silently ignore errors
        }
      })();
    }

    // Fire confetti on web for valid boards
    if (isBananas && Platform.OS === "web") {
      import("canvas-confetti").then(({ default: confetti }) => {
        const burst = (x: number, angle: number) =>
          confetti({
            particleCount: 70, spread: 60, origin: { x, y: 1 }, angle, startVelocity: 55,
            colors: ["#FFD700", "#FFA500", "#FFEC47", "#FFF176", "#FF8F00", "#ffffff"],
          });
        burst(0.2, 70);
        setTimeout(() => burst(0.8, 110), 150);
        setTimeout(() => burst(0.5, 90), 300);
      });
    }

    // Auto-dismiss after 2.8 s
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(onDone);
    }, 2800);

    return () => {
      clearTimeout(timer);
      soundObj?.unloadAsync();
    };
  }, []);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDone}>
      <Pressable
        style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.45)" }}
        onPress={() =>
          Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(onDone)
        }
      >
        <Animated.View style={{ opacity, transform: [{ scale }], alignItems: "center" }}>
          {isBananas ? (
            <Text style={{ fontSize: 64, marginBottom: 8 }}>🍌</Text>
          ) : (
            <Image
              source={require("../assets/images/rotten-bananas.png")}
              style={{ width: 80, height: 80, marginBottom: 8 }}
              resizeMode="contain"
            />
          )}
          <View
            style={{
              paddingHorizontal: 36, paddingVertical: 20, borderRadius: 20,
              backgroundColor: isBananas ? "#FFF8E1" : "#EFEBE9",
              borderWidth: 2, borderColor: isBananas ? "#F9A825" : "#795548",
              shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 }, elevation: 8,
              alignItems: "center",
            }}
          >
            {playerName && !isBananas && (
              <Text style={{ fontSize: 18, fontWeight: "700", color: "#4E342E", marginBottom: 4 }}>
                {playerName}
              </Text>
            )}
            <Text
              style={{
                fontSize: 32, fontWeight: "800",
                color: isBananas ? "#E65100" : "#4E342E", letterSpacing: 0.5,
              }}
            >
              {isBananas ? "Bananas!" : "Rotten Banana!"}
            </Text>
            <Text style={{ fontSize: 13, color: isBananas ? "#F57F17" : "#6D4C41", marginTop: 6 }}>
              {isBananas
                ? "All words are valid — nice board!"
                : "Some words aren't in the dictionary."}
            </Text>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
