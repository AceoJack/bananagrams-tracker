import "react-native-get-random-values";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { initDb } from "../db/database";

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await initDb();
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}