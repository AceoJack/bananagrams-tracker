import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { FadeInView } from "../../components/FadeInView";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "../../utils/firebase";
import { getOrCreateUserProfile, listGuests, type UserProfile, type Guest } from "../../db/queries.firestore";
import { useFocusEffect } from "expo-router";

interface StatRow {
  name: string;
  wins: number;
  losses: number;
  tag?: string;
}

export default function Home() {
  const [rows, setRows] = useState<StatRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      setError(null);
    });
    return () => unsub();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      let cancelled = false;

      (async () => {
        try {
          const auth = getFirebaseAuth();
          const user = auth.currentUser;
          if (!user) return;

          const [profile, guests] = await Promise.all([
            getOrCreateUserProfile({
              uid: user.uid,
              displayName: user.displayName,
              email: user.email,
              photoURL: user.photoURL,
            }),
            listGuests(user.uid),
          ]);

          if (cancelled) return;

          const allRows: StatRow[] = [
            { name: profile.displayName, wins: profile.wins ?? 0, losses: profile.losses ?? 0, tag: "You" },
            ...guests.map((g) => ({ name: g.name, wins: g.wins, losses: g.losses, tag: "Guest" })),
          ];

          // Sort by wins desc, then losses asc
          allRows.sort((a, b) =>
            b.wins !== a.wins ? b.wins - a.wins : a.losses - b.losses
          );

          setRows(allRows);
        } catch (e: any) {
          console.error("Home load failed:", e);
          if (!cancelled) setError(e?.message ?? "Failed to load stats");
        }
      })();

      return () => { cancelled = true; };
    }, [uid])
  );

  if (error) return <Text style={{ padding: 16, color: "#c00" }}>{error}</Text>;

  return (
    <FadeInView>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: "700" }}>Player Stats</Text>

        <View style={{ borderWidth: 1, borderColor: "#ddd", borderRadius: 12, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", padding: 12, backgroundColor: "#f3f3f3" }}>
            <Text style={{ flex: 2, fontWeight: "700" }}>Player</Text>
            <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Wins</Text>
            <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Losses</Text>
            <Text style={{ flex: 1, fontWeight: "700", textAlign: "right" }}>Win %</Text>
          </View>

          {rows.length === 0 ? (
            <View style={{ padding: 12 }}>
              <Text style={{ color: "#666" }}>
                No stats yet. Play some games to see your record here.
              </Text>
            </View>
          ) : (
            rows.map((r, i) => {
              const played = r.wins + r.losses;
              const pct = played === 0 ? "—" : `${Math.round((r.wins / played) * 100)}%`;
              return (
                <View
                  key={i}
                  style={{ flexDirection: "row", padding: 12, borderTopWidth: 1, borderTopColor: "#eee", alignItems: "center" }}
                >
                  <View style={{ flex: 2, flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text>{r.name}</Text>
                    {r.tag === "You" && (
                      <View style={{ backgroundColor: "#F9A825", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>YOU</Text>
                      </View>
                    )}
                    {r.tag === "Guest" && (
                      <View style={{ backgroundColor: "#eee", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 10, fontWeight: "600", color: "#888" }}>GUEST</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ flex: 1, textAlign: "right" }}>{r.wins}</Text>
                  <Text style={{ flex: 1, textAlign: "right" }}>{r.losses}</Text>
                  <Text style={{
                    flex: 1, textAlign: "right", fontWeight: "600",
                    color: played === 0 ? "#aaa" : r.wins / played >= 0.5 ? "#2E7D32" : "#C62828",
                  }}>
                    {pct}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
