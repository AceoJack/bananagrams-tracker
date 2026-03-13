import { useState, useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { SaveGameModal } from "../../components/SaveGameModal";
import { FadeInView } from "../../components/FadeInView";
import { formatDuration } from "../../utils/format";
import * as Haptics from "expo-haptics";

export default function SplitScreen() {
  const [running, setRunning] = useState(false);
  const [startMs, setStartMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const [saveOpen, setSaveOpen] = useState(false);
  const [playedAtISO, setPlayedAtISO] = useState<string>("");

  useEffect(() => {
    if (!running || startMs === null) return;

    const id = setInterval(() => {
      const now = Date.now();
      setElapsedSec(Math.floor((now - startMs) / 1000));
    }, 250);

    return () => clearInterval(id);
  }, [running, startMs]);

  const start = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const now = Date.now();
    setStartMs(now);
    setElapsedSec(0);
    setRunning(true);
  };

  const stop = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setRunning(false);
    setPlayedAtISO(new Date().toISOString());
    setSaveOpen(true);
  };

  const reset = () => {
    setRunning(false);
    setStartMs(null);
    setElapsedSec(0);
  };

  const hapticButton = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const btnScale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(btnScale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1,    useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  return (
    <FadeInView>
    <View style={{ flex: 1, padding: 16, gap: 16, justifyContent: "center" }}>

      <Text style={{ fontSize: 48, fontWeight: "800", textAlign: "center" }}>
        {formatDuration(elapsedSec)}
      </Text>

      <Animated.View style={{ transform: [{ scale: btnScale }] }}>
        {!running ? (
          <Pressable
            onPress={start}
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={{
              padding: 16,
              borderRadius: 14,
              backgroundColor: "#FFED29",
              alignItems: "center",
              shadowColor: "#FFED29",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.5,
              shadowRadius: 12,
              elevation: 6,
            }}
          >
            <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>SPLIT</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={stop}
            onPressIn={pressIn}
            onPressOut={pressOut}
            style={{
              padding: 16,
              borderRadius: 14,
              backgroundColor: "#2bff00ff",
              alignItems: "center",
              shadowColor: "#2bff00ff",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.5,
              shadowRadius: 12,
              elevation: 6,
            }}
          >
            <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>BANANAGRAMS</Text>
          </Pressable>
        )}
      </Animated.View>

      <SaveGameModal
        visible={saveOpen}
        onClose={() => {
          setSaveOpen(false);
          reset();
          hapticButton();
        }}
        durationSeconds={elapsedSec}
        playedAtISO={playedAtISO}
        onSaved={async () => {
          setSaveOpen(false);
          reset();
          hapticButton();
        }}
      />
    </View>
    </FadeInView>
  );
}