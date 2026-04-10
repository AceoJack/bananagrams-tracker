import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "../../utils/firebase";
import {
  searchUsers,
  getFriends,
  addFriend,
  removeFriend,
  type UserProfile,
  type FriendProfile,
} from "../../db/queries.firestore";
import { FadeInView } from "../../components/FadeInView";

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({
  photoURL,
  displayName,
  size = 44,
}: {
  photoURL: string | null;
  displayName: string;
  size?: number;
}) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#eee" }}
      />
    );
  }
  const initial = displayName.trim()[0]?.toUpperCase() ?? "?";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#F9A825",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.42, fontWeight: "700", color: "#fff" }}>{initial}</Text>
    </View>
  );
}

// ── Friend row ────────────────────────────────────────────────────────────────

function FriendRow({
  name,
  photoURL,
  right,
}: {
  name: string;
  photoURL: string | null;
  right: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderBottomWidth: 1,
        borderBottomColor: "#f0f0f0",
      }}
    >
      <Avatar photoURL={photoURL} displayName={name} />
      <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: "#1a1a1a" }}>{name}</Text>
      {right}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [pendingAdd, setPendingAdd] = useState<Set<string>>(new Set());
  const [pendingRemove, setPendingRemove] = useState<Set<string>>(new Set());

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // Track auth user
  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (u) => {
      if (isMounted.current) setUser(u);
    });
  }, []);

  // Load friends on focus
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      setLoading(true);

      getFriends(user.uid)
        .then((data) => { if (!cancelled) { setFriends(data); setLoading(false); } })
        .catch(() => { if (!cancelled) setLoading(false); });

      return () => { cancelled = true; };
    }, [user])
  );

  // Debounced search
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);

    const trimmed = searchTerm.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    searchDebounce.current = setTimeout(async () => {
      if (!user) return;
      setSearching(true);
      setSearchError(null);
      try {
        const results = await searchUsers(trimmed, user.uid);
        if (isMounted.current) setSearchResults(results);
      } catch (e: any) {
        if (isMounted.current) setSearchError("Search failed. Try again.");
      } finally {
        if (isMounted.current) setSearching(false);
      }
    }, 350);

    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchTerm, user]);

  const friendUids = new Set(friends.map((f) => f.uid));

  const handleAdd = async (profile: UserProfile) => {
    if (!user) return;
    setPendingAdd((s) => new Set(s).add(profile.uid));
    try {
      await addFriend(user.uid, profile);
      const updated = await getFriends(user.uid);
      if (isMounted.current) setFriends(updated);
    } catch {
      // silently fail — user can retry
    } finally {
      if (isMounted.current)
        setPendingAdd((s) => { const n = new Set(s); n.delete(profile.uid); return n; });
    }
  };

  const handleRemove = async (friendUid: string) => {
    if (!user) return;
    const confirmed =
      Platform.OS === "web" ? window.confirm("Remove this friend?") : true;
    if (!confirmed) return;

    setPendingRemove((s) => new Set(s).add(friendUid));
    try {
      await removeFriend(user.uid, friendUid);
      if (isMounted.current) setFriends((prev) => prev.filter((f) => f.uid !== friendUid));
    } catch {
      // silently fail
    } finally {
      if (isMounted.current)
        setPendingRemove((s) => { const n = new Set(s); n.delete(friendUid); return n; });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <FadeInView>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        style={{ flex: 1, backgroundColor: "#FFFDE7" }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ padding: 20, gap: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: "#1a1a1a" }}>Friends</Text>

          {/* ── Search bar ── */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "#fff",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#e0e0e0",
              paddingHorizontal: 14,
              gap: 8,
              shadowColor: "#000",
              shadowOpacity: 0.04,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 1 },
              elevation: 1,
            }}
          >
            <Text style={{ fontSize: 16, color: "#aaa" }}>🔍</Text>
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search by username…"
              placeholderTextColor="#bbb"
              style={{ flex: 1, fontSize: 15, paddingVertical: 12, color: "#1a1a1a" }}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searching && <ActivityIndicator size="small" color="#F9A825" />}
            {searchTerm.length > 0 && !searching && (
              <Pressable onPress={() => { setSearchTerm(""); setSearchResults([]); }}>
                <Text style={{ fontSize: 18, color: "#bbb", lineHeight: 22 }}>✕</Text>
              </Pressable>
            )}
          </View>

          {/* ── Search results ── */}
          {searchError && (
            <Text style={{ color: "#c00", fontSize: 13 }}>{searchError}</Text>
          )}

          {searchResults.length > 0 && (
            <View
              style={{
                backgroundColor: "#fff",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#eee",
                overflow: "hidden",
              }}
            >
              {searchResults.map((result) => {
                const alreadyFriend = friendUids.has(result.uid);
                const isAdding = pendingAdd.has(result.uid);
                return (
                  <FriendRow
                    key={result.uid}
                    name={result.displayName}
                    photoURL={result.photoURL}
                    right={
                      alreadyFriend ? (
                        <Text style={{ fontSize: 12, color: "#aaa", fontWeight: "600" }}>
                          Added
                        </Text>
                      ) : (
                        <Pressable
                          onPress={() => handleAdd(result)}
                          disabled={isAdding}
                          style={({ pressed }) => ({
                            backgroundColor: pressed ? "#e8a800" : "#F9A825",
                            borderRadius: 8,
                            paddingHorizontal: 14,
                            paddingVertical: 6,
                            opacity: isAdding ? 0.6 : 1,
                          })}
                        >
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                            {isAdding ? "Adding…" : "Add"}
                          </Text>
                        </Pressable>
                      )
                    }
                  />
                );
              })}
            </View>
          )}

          {searchTerm.trim().length > 0 && !searching && searchResults.length === 0 && !searchError && (
            <Text style={{ color: "#aaa", fontSize: 14, textAlign: "center" }}>
              No users found for "{searchTerm.trim()}"
            </Text>
          )}

          {/* ── Friends list ── */}
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#555", marginTop: 4 }}>
            My Friends {friends.length > 0 ? `(${friends.length})` : ""}
          </Text>

          {loading ? (
            <ActivityIndicator color="#F9A825" />
          ) : friends.length === 0 ? (
            <Text style={{ color: "#bbb", fontSize: 14, textAlign: "center", marginTop: 8 }}>
              No friends yet — search for someone above.
            </Text>
          ) : (
            <View
              style={{
                backgroundColor: "#fff",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#eee",
                overflow: "hidden",
              }}
            >
              {friends.map((friend) => {
                const isRemoving = pendingRemove.has(friend.uid);
                return (
                  <FriendRow
                    key={friend.uid}
                    name={friend.displayName}
                    photoURL={friend.photoURL}
                    right={
                      <Pressable
                        onPress={() => handleRemove(friend.uid)}
                        disabled={isRemoving}
                        style={({ pressed }) => ({
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 8,
                          backgroundColor: pressed ? "#fee" : "#fff0f0",
                          borderWidth: 1,
                          borderColor: "#fcc",
                          opacity: isRemoving ? 0.5 : 1,
                        })}
                      >
                        <Text style={{ color: "#c00", fontWeight: "600", fontSize: 13 }}>
                          {isRemoving ? "…" : "Remove"}
                        </Text>
                      </Pressable>
                    }
                  />
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}
