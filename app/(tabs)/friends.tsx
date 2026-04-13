import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { AvatarCircle } from "../../components/AvatarCircle";
import { C } from "../../utils/designSystem";

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

  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (u) => {
      if (isMounted.current) setUser(u);
    });
  }, []);

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

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const trimmed = searchTerm.trim();
    if (!trimmed) { setSearchResults([]); setSearchError(null); return; }
    searchDebounce.current = setTimeout(async () => {
      if (!user) return;
      setSearching(true);
      setSearchError(null);
      try {
        const results = await searchUsers(trimmed, user.uid);
        if (isMounted.current) setSearchResults(results);
      } catch {
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
      // silently fail
    } finally {
      if (isMounted.current)
        setPendingAdd((s) => { const n = new Set(s); n.delete(profile.uid); return n; });
    }
  };

  const handleRemove = async (friendUid: string) => {
    if (!user) return;
    const confirmed = Platform.OS === "web" ? window.confirm("Remove this friend?") : true;
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
        style={{ flex: 1, backgroundColor: C.bg }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{
          paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20,
          backgroundColor: C.surface,
          borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
        }}>
          <Text style={{ fontSize: 22, fontWeight: "600", color: C.textPrimary }}>Friends</Text>
        </View>

        <View style={{ padding: 20, gap: 20 }}>

          {/* Search bar */}
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 10,
            backgroundColor: C.surfaceSecondary,
            borderRadius: C.radiusMd,
            borderWidth: 0.5, borderColor: C.border,
            paddingHorizontal: 14,
          }}>
            <Text style={{ fontSize: 15, color: C.textTertiary }}>🔍</Text>
            <TextInput
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search by username…"
              placeholderTextColor={C.textTertiary}
              style={{ flex: 1, fontSize: 14, paddingVertical: 12, color: C.textPrimary }}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searching && <ActivityIndicator size="small" color={C.brand} />}
            {searchTerm.length > 0 && !searching && (
              <Pressable onPress={() => { setSearchTerm(""); setSearchResults([]); }} style={{ padding: 4 }}>
                <Text style={{ fontSize: 16, color: C.textTertiary }}>✕</Text>
              </Pressable>
            )}
          </View>

          {/* Search error */}
          {searchError && (
            <Text style={{ color: C.danger, fontSize: 13 }}>{searchError}</Text>
          )}

          {/* Search results */}
          {searchResults.length > 0 && (
            <View style={{
              borderRadius: C.radiusMd,
              borderWidth: 0.5, borderColor: C.borderTertiary,
              overflow: "hidden",
            }}>
              {searchResults.map((result, i) => {
                const alreadyFriend = friendUids.has(result.uid);
                const isAdding = pendingAdd.has(result.uid);
                return (
                  <View
                    key={result.uid}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 12,
                      paddingVertical: 12, paddingHorizontal: 16,
                      backgroundColor: C.surface,
                      borderBottomWidth: i < searchResults.length - 1 ? 0.5 : 0,
                      borderBottomColor: C.borderTertiary,
                    }}
                  >
                    <AvatarCircle uid={result.uid} displayName={result.displayName} size={40} />
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: "500", color: C.textPrimary }}>
                      {result.displayName}
                    </Text>
                    {alreadyFriend ? (
                      <Text style={{ fontSize: 12, color: C.textTertiary, fontWeight: "500" }}>
                        Added
                      </Text>
                    ) : (
                      <Pressable
                        onPress={() => handleAdd(result)}
                        disabled={isAdding}
                        style={{
                          backgroundColor: C.brand,
                          borderRadius: C.radiusSm,
                          paddingHorizontal: 14, paddingVertical: 6,
                          opacity: isAdding ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: C.brandText, fontWeight: "500", fontSize: 13 }}>
                          {isAdding ? "Adding…" : "Add"}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {searchTerm.trim().length > 0 && !searching && searchResults.length === 0 && !searchError && (
            <Text style={{ color: C.textTertiary, fontSize: 14, textAlign: "center" }}>
              No users found for "{searchTerm.trim()}"
            </Text>
          )}

          {/* Friends list */}
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 13, color: C.textSecondary, fontWeight: "500", letterSpacing: 0.5 }}>
              MY FRIENDS{friends.length > 0 ? ` (${friends.length})` : ""}
            </Text>

            {loading ? (
              <ActivityIndicator color={C.brand} style={{ marginTop: 8 }} />
            ) : friends.length === 0 ? (
              <View style={{
                paddingVertical: 32, alignItems: "center", gap: 8,
                borderWidth: 0.5, borderColor: C.borderTertiary,
                borderRadius: C.radiusMd, borderStyle: "dashed",
              }}>
                <Text style={{ fontSize: 28 }}>👥</Text>
                <Text style={{ color: C.textSecondary, fontSize: 14 }}>No friends yet</Text>
                <Text style={{ color: C.textTertiary, fontSize: 13 }}>Search for someone above</Text>
              </View>
            ) : (
              <View style={{
                borderRadius: C.radiusMd,
                borderWidth: 0.5, borderColor: C.borderTertiary,
                overflow: "hidden",
              }}>
                {friends.map((friend, i) => {
                  const isRemoving = pendingRemove.has(friend.uid);
                  return (
                    <View
                      key={friend.uid}
                      style={{
                        flexDirection: "row", alignItems: "center", gap: 12,
                        paddingVertical: 12, paddingHorizontal: 16,
                        backgroundColor: C.surface,
                        borderBottomWidth: i < friends.length - 1 ? 0.5 : 0,
                        borderBottomColor: C.borderTertiary,
                      }}
                    >
                      <AvatarCircle uid={friend.uid} displayName={friend.displayName} size={40} />
                      <Text style={{ flex: 1, fontSize: 14, fontWeight: "500", color: C.textPrimary }}>
                        {friend.displayName}
                      </Text>
                      <Pressable
                        onPress={() => handleRemove(friend.uid)}
                        disabled={isRemoving}
                        style={({ pressed }) => ({
                          paddingHorizontal: 12, paddingVertical: 6,
                          borderRadius: C.radiusSm,
                          backgroundColor: pressed ? C.dangerBg : "transparent",
                          borderWidth: 0.5, borderColor: C.dangerBorder,
                          opacity: isRemoving ? 0.5 : 1,
                        })}
                      >
                        <Text style={{ color: C.danger, fontWeight: "500", fontSize: 13 }}>
                          {isRemoving ? "…" : "Remove"}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}
