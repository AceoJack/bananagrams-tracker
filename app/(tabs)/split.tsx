import { useState, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { SaveGameModal } from "../../components/SaveGameModal";
import { formatDuration } from "../../utils/format";

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

  const start = () => {
    const now = Date.now();
    setStartMs(now);
    setElapsedSec(0);
    setRunning(true);
  };

  const stop = () => {
    setRunning(false);
    setPlayedAtISO(new Date().toISOString());
    setSaveOpen(true);
  };

  const reset = () => {
    setRunning(false);
    setStartMs(null);
    setElapsedSec(0);
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 16, justifyContent: "center" }}>
      <Text style={{ fontSize: 24, fontWeight: "700", textAlign: "center" }}>Split</Text>

      <Text style={{ fontSize: 48, fontWeight: "800", textAlign: "center" }}>
        {formatDuration(elapsedSec)}
      </Text>

      {!running ? (
        <Pressable
          onPress={start}
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: "#111",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>SPLIT</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={stop}
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: "#111",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "white", fontSize: 18, fontWeight: "700" }}>STOP</Text>
        </Pressable>
      )}

      <Pressable onPress={reset} style={{ alignItems: "center" }}>
        <Text style={{ color: "#444" }}>Reset</Text>
      </Pressable>

      <SaveGameModal
        visible={saveOpen}
        onClose={() => setSaveOpen(false)}
        durationSeconds={elapsedSec}
        playedAtISO={playedAtISO}
        onSaved={async () => {
          // after save, reset timer so next game is clean
          reset();
        }}
      />
    </View>
  );
}