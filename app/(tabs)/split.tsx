import { useState, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { SaveGameModal } from "../../components/SaveGameModal";
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

  return (
    <View style={{ flex: 1, padding: 16, gap: 16, justifyContent: "center" }}>

      <Text style={{ fontSize: 48, fontWeight: "800", textAlign: "center" }}>
        {formatDuration(elapsedSec)}
      </Text>

      {!running ? (
        <Pressable
          onPress={start}
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: "#FFED29",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>SPLIT</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={stop}
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: "#2bff00ff",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>BANANAGRAMS</Text>
        </Pressable>
      )}

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
  );
}