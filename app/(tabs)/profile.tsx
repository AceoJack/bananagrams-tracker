import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getFirebaseAuth } from "../../utils/firebase";
import { logout } from "../../utils/auth.google";
import {
  getOrCreateUserProfile,
  updateUserProfile,
  getFriends,
  addFriend,
  removeFriend,
  searchUsers,
  listGuests,
  createGuest,
  type UserProfile,
  type FriendProfile,
  type Guest,
} from "../../db/queries.firestore";
import { AvatarCircle } from "../../components/AvatarCircle";
import { C } from "../../utils/designSystem";

// ── Bottom sheet wrapper ───────────────────────────────────────────────────────

function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: C.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 16,
            paddingBottom: 32,
          }}
          onPress={() => {}}
        >
          {/* Drag handle */}
          <View style={{
            width: 36, height: 4, borderRadius: 2,
            backgroundColor: C.border, alignSelf: "center", marginBottom: 20,
          }} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ value, label, valueColor = C.textPrimary }: {
  value: string;
  label: string;
  valueColor?: string;
}) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: C.surfaceSecondary,
      borderRadius: C.radiusSm,
      padding: 10,
      alignItems: "center",
    }}>
      <Text style={{ fontSize: 20, fontWeight: "500", color: valueColor }}>{value}</Text>
      <Text style={{ fontSize: 10, color: C.textTertiary, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

// ── Settings link row ─────────────────────────────────────────────────────────

function SettingsRow({
  icon,
  label,
  onPress,
  danger = false,
  last = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: C.borderTertiary,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 18, color: danger ? C.dangerBorder : C.textSecondary, width: 22, textAlign: "center" }}>
        {icon}
      </Text>
      <Text style={{ flex: 1, fontSize: 14, color: danger ? C.danger : C.textPrimary }}>
        {label}
      </Text>
      {!danger && (
        <Text style={{ fontSize: 14, color: C.textTertiary }}>›</Text>
      )}
    </Pressable>
  );
}

// ── Add Friend sheet ──────────────────────────────────────────────────────────

function AddFriendSheet({
  visible,
  onClose,
  user,
  friendUids,
  onFriendAdded,
}: {
  visible: boolean;
  onClose: () => void;
  user: User;
  friendUids: Set<string>;
  onFriendAdded: (profile: UserProfile) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<Set<string>>(new Set());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  useEffect(() => {
    if (!visible) { setSearchTerm(""); setResults([]); setSearchError(null); }
  }, [visible]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = searchTerm.trim();
    if (!trimmed) { setResults([]); setSearchError(null); return; }

    debounce.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await searchUsers(trimmed, user.uid);
        if (isMounted.current) setResults(res);
      } catch {
        if (isMounted.current) setSearchError("Search failed. Try again.");
      } finally {
        if (isMounted.current) setSearching(false);
      }
    }, 350);

    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [searchTerm, user.uid]);

  const handleAdd = async (profile: UserProfile) => {
    setPendingAdd((s) => new Set(s).add(profile.uid));
    try {
      await addFriend(user.uid, profile);
      if (isMounted.current) onFriendAdded(profile);
    } catch {
      // silently fail
    } finally {
      if (isMounted.current)
        setPendingAdd((s) => { const n = new Set(s); n.delete(profile.uid); return n; });
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 16, fontWeight: "500", marginBottom: 16, color: C.textPrimary }}>
        Add friend
      </Text>

      {/* Search input */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        borderWidth: 0.5, borderColor: C.border, borderRadius: C.radiusSm,
        paddingHorizontal: 12, gap: 8, marginBottom: 16,
      }}>
        <Text style={{ fontSize: 14, color: C.textTertiary }}>🔍</Text>
        <TextInput
          value={searchTerm}
          onChangeText={setSearchTerm}
          placeholder="Search by username"
          placeholderTextColor={C.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          style={{ flex: 1, fontSize: 14, paddingVertical: 10, color: C.textPrimary }}
        />
        {searching && <ActivityIndicator size="small" color={C.brand} />}
      </View>

      {/* Results */}
      {searchError && (
        <Text style={{ color: C.dangerBorder, fontSize: 13, marginBottom: 8 }}>{searchError}</Text>
      )}

      {results.length > 0 && (
        <View style={{
          borderWidth: 0.5, borderColor: C.borderTertiary, borderRadius: C.radiusSm,
          overflow: "hidden", marginBottom: 12,
        }}>
          {results.map((result, i) => {
            const alreadyFriend = friendUids.has(result.uid);
            const isAdding = pendingAdd.has(result.uid);
            return (
              <View key={result.uid} style={{
                flexDirection: "row", alignItems: "center", gap: 12,
                padding: 12,
                borderTopWidth: i === 0 ? 0 : 0.5,
                borderTopColor: C.borderTertiary,
                opacity: alreadyFriend ? 0.6 : 1,
              }}>
                <AvatarCircle uid={result.uid} displayName={result.displayName} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "500", color: C.textPrimary }}>
                    {result.displayName}
                  </Text>
                </View>
                {alreadyFriend ? (
                  <Text style={{ fontSize: 11, color: C.textTertiary }}>Already added</Text>
                ) : (
                  <Pressable
                    onPress={() => handleAdd(result)}
                    disabled={isAdding}
                    style={{
                      backgroundColor: C.infoBg, borderRadius: C.radiusSm,
                      paddingHorizontal: 12, paddingVertical: 5,
                      opacity: isAdding ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "500", color: C.info }}>
                      {isAdding ? "Adding…" : "Add"}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      {searchTerm.trim().length > 0 && !searching && results.length === 0 && !searchError && (
        <Text style={{ color: C.textSecondary, fontSize: 13, textAlign: "center", marginBottom: 12 }}>
          No users found for "@{searchTerm.trim()}"
        </Text>
      )}

      <Text style={{ fontSize: 11, color: C.textTertiary, textAlign: "center" }}>
        Friends can join your game rooms quickly
      </Text>
    </BottomSheet>
  );
}

// ── Add Guest sheet ───────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#85B7EB", "#97C459", "#F0997B", "#AFA9EC", "#ED93B1", "#FAC775", "#B4B2A9",
];

function AddGuestSheet({
  visible,
  onClose,
  onGuestCreated,
  uid,
}: {
  visible: boolean;
  onClose: () => void;
  onGuestCreated: (guest: Guest) => void;
  uid: string;
}) {
  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) { setName(""); setSelectedColor(AVATAR_COLORS[0]); setError(null); }
  }, [visible]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const guest = await createGuest(uid, trimmed);
      onGuestCreated(guest);
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed to create guest.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={{ fontSize: 16, fontWeight: "500", color: C.textPrimary }}>
        Add a guest
      </Text>
      <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 20 }}>
        Track scores for someone who doesn't have the app
      </Text>

      {/* Name input */}
      <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Mum, Dad, Dave"
        placeholderTextColor={C.textTertiary}
        style={{
          borderWidth: 0.5, borderColor: C.border, borderRadius: C.radiusSm,
          padding: 10, fontSize: 14, color: C.textPrimary, marginBottom: 16,
        }}
      />

      {/* Colour picker */}
      <Text style={{ fontSize: 12, color: C.textSecondary, marginBottom: 8 }}>Avatar colour</Text>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
        {AVATAR_COLORS.map((color) => (
          <Pressable
            key={color}
            onPress={() => setSelectedColor(color)}
            style={{
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: color,
              borderWidth: selectedColor === color ? 2 : 0,
              borderColor: C.textPrimary,
            }}
          />
        ))}
      </View>

      {/* Preview */}
      <View style={{
        flexDirection: "row", alignItems: "center", gap: 12,
        backgroundColor: C.surfaceSecondary, borderRadius: C.radiusSm,
        padding: 12, marginBottom: 20,
      }}>
        <View style={{
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: selectedColor + "22",
          borderWidth: 1, borderStyle: "dashed", borderColor: selectedColor,
          alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: selectedColor }}>
            {name.trim() ? name.trim().slice(0, 2).toUpperCase() : "?"}
          </Text>
        </View>
        <View>
          <Text style={{ fontSize: 14, fontWeight: "500", color: C.textSecondary }}>
            {name.trim() || "Guest name"}
          </Text>
          <Text style={{ fontSize: 11, color: C.textTertiary }}>Guest · managed by you</Text>
        </View>
      </View>

      {error && (
        <Text style={{ color: C.dangerBorder, fontSize: 13, marginBottom: 8 }}>{error}</Text>
      )}

      <Pressable
        onPress={handleCreate}
        disabled={creating || !name.trim()}
        style={({ pressed }) => ({
          backgroundColor: name.trim() ? (pressed ? C.brandShadow : C.brand) : C.surfaceSecondary,
          borderRadius: C.radiusLg, padding: 14, alignItems: "center",
        })}
      >
        <Text style={{
          fontSize: 15, fontWeight: "500",
          color: name.trim() ? C.brandText : C.textTertiary,
        }}>
          {creating ? "Creating…" : "Create guest"}
        </Text>
      </Pressable>
      <Text style={{ fontSize: 11, color: C.textTertiary, textAlign: "center", marginTop: 12 }}>
        You'll scan their boards and manage their stats
      </Text>
    </BottomSheet>
  );
}

// ── Profile screen ────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit name
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Sheets
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showAddGuest, setShowAddGuest] = useState(false);

  // Friends remove
  const [pendingRemove, setPendingRemove] = useState<Set<string>>(new Set());

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
      setError(null);

      Promise.all([
        getOrCreateUserProfile({
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
        }),
        getFriends(user.uid),
        listGuests(user.uid),
      ])
        .then(([prof, friendList, guestList]) => {
          if (!cancelled) {
            setProfile(prof);
            setFriends(friendList);
            setGuests(guestList);
            setLoading(false);
          }
        })
        .catch((e: any) => {
          if (!cancelled) {
            setError(e?.message ?? "Failed to load profile.");
            setLoading(false);
          }
        });

      return () => { cancelled = true; };
    }, [user])
  );

  const handleSaveName = async () => {
    if (!user || !profile) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === profile.displayName) { setEditingName(false); return; }
    setSavingName(true);
    try {
      await updateUserProfile(user.uid, { displayName: trimmed });
      setProfile((p) => p ? { ...p, displayName: trimmed } : p);
      setEditingName(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save name.");
    } finally {
      setSavingName(false);
    }
  };

  const handleRemoveFriend = async (friendUid: string) => {
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: C.bg }}>
        <ActivityIndicator size="large" color={C.brand} />
      </View>
    );
  }

  if (!profile || !user) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: C.bg }}>
        <Text style={{ color: C.dangerBorder }}>{error ?? "Not signed in."}</Text>
      </View>
    );
  }

  const totalGames = (profile.wins ?? 0) + (profile.losses ?? 0);
  const winRate = totalGames > 0 ? Math.round(((profile.wins ?? 0) / totalGames) * 100) : 0;
  const friendUids = new Set(friends.map((f) => f.uid));
  const shownFriends = friends.slice(0, 3);

  return (
    <>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        style={{ flex: 1, backgroundColor: C.bg }}
      >
        {/* ── Profile header ── */}
        <View style={{ padding: 24, paddingBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <AvatarCircle uid={user.uid} displayName={profile.displayName} size={64} />

            <View style={{ flex: 1 }}>
              {editingName ? (
                <View style={{ gap: 8 }}>
                  <TextInput
                    value={nameInput}
                    onChangeText={setNameInput}
                    autoFocus
                    style={{
                      borderWidth: 0.5, borderColor: C.brand, borderRadius: C.radiusSm,
                      padding: 8, fontSize: 16, color: C.textPrimary, backgroundColor: C.surface,
                    }}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={handleSaveName}
                      disabled={savingName}
                      style={{
                        flex: 1, backgroundColor: C.brand,
                        borderRadius: C.radiusSm, padding: 7, alignItems: "center",
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "500", color: C.brandText }}>
                        {savingName ? "Saving…" : "Save"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setEditingName(false)}
                      style={{
                        flex: 1, borderWidth: 0.5, borderColor: C.border,
                        borderRadius: C.radiusSm, padding: 7, alignItems: "center",
                      }}
                    >
                      <Text style={{ fontSize: 13, color: C.textSecondary }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={{ fontSize: 20, fontWeight: "500", color: C.textPrimary }}>
                    {profile.displayName}
                  </Text>
                  {profile.email && (
                    <Text style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
                      {profile.email}
                    </Text>
                  )}
                  <Text style={{ fontSize: 11, color: C.textTertiary, marginTop: 2 }}>
                    ★ Signed in with Google
                  </Text>
                </>
              )}
            </View>

            {!editingName && (
              <Pressable
                onPress={() => { setNameInput(profile.displayName); setEditingName(true); }}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6,
                  borderWidth: 0.5, borderColor: C.border, borderRadius: C.radiusSm,
                }}
              >
                <Text style={{ fontSize: 12, color: C.textSecondary }}>Edit</Text>
              </Pressable>
            )}
          </View>

          {error && (
            <Text style={{ color: C.dangerBorder, fontSize: 13, marginTop: 8 }}>{error}</Text>
          )}
        </View>

        {/* ── Stats grid ── */}
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 20 }}>
          <StatCard value={String(totalGames)} label="Games" />
          <StatCard value={String(profile.wins ?? 0)} label="Wins" valueColor={C.success} />
          <StatCard value={String(profile.losses ?? 0)} label="Rotten" valueColor={C.danger} />
          <StatCard value={`${winRate}%`} label="Win rate" />
        </View>

        {/* Divider */}
        <View style={{ height: 0.5, backgroundColor: C.borderTertiary, marginHorizontal: 20 }} />

        {/* ── Friends section ── */}
        <View style={{ padding: 20, paddingBottom: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: "500", color: C.textPrimary }}>
              Friends ({friends.length})
            </Text>
            <Pressable onPress={() => setShowAddFriend(true)}>
              <Text style={{ fontSize: 13, fontWeight: "500", color: C.info }}>Add friend</Text>
            </Pressable>
          </View>

          {shownFriends.length === 0 ? (
            <Text style={{ fontSize: 13, color: C.textTertiary, textAlign: "center", paddingVertical: 8 }}>
              No friends yet — tap Add friend to search
            </Text>
          ) : (
            shownFriends.map((friend, i) => {
              const isRemoving = pendingRemove.has(friend.uid);
              return (
                <View key={friend.uid} style={{
                  flexDirection: "row", alignItems: "center", gap: 12,
                  paddingVertical: 10,
                  borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
                }}>
                  <AvatarCircle uid={friend.uid} displayName={friend.displayName} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "500", color: C.textPrimary }}>
                      {friend.displayName}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemoveFriend(friend.uid)}
                    disabled={isRemoving}
                    style={({ pressed }) => ({
                      opacity: isRemoving || pressed ? 0.5 : 1,
                      paddingHorizontal: 8, paddingVertical: 4,
                    })}
                  >
                    <Text style={{ fontSize: 13, color: C.textTertiary }}>✕</Text>
                  </Pressable>
                </View>
              );
            })
          )}

          {friends.length > 3 && (
            <Text style={{ fontSize: 13, color: C.info, textAlign: "center", paddingVertical: 10 }}>
              See all friends ({friends.length})
            </Text>
          )}
        </View>

        {/* Divider */}
        <View style={{ height: 0.5, backgroundColor: C.borderTertiary, marginHorizontal: 20 }} />

        {/* ── Guests section ── */}
        <View style={{ padding: 20, paddingBottom: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: "500", color: C.textPrimary }}>
              Your guests ({guests.length})
            </Text>
            <Pressable onPress={() => setShowAddGuest(true)}>
              <Text style={{ fontSize: 13, fontWeight: "500", color: C.info }}>Add guest</Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: 12, color: C.textTertiary, marginBottom: 12 }}>
            People you track scores for who don't have the app
          </Text>

          {guests.length === 0 ? (
            <Text style={{ fontSize: 13, color: C.textTertiary, textAlign: "center", paddingVertical: 8 }}>
              No guests yet — tap Add guest to create one
            </Text>
          ) : (
            guests.map((guest) => (
              <View key={guest.id} style={{
                flexDirection: "row", alignItems: "center", gap: 12,
                paddingVertical: 10,
                borderBottomWidth: 0.5, borderBottomColor: C.borderTertiary,
              }}>
                <AvatarCircle uid={guest.id} displayName={guest.name} size={36} guest />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "500", color: C.textSecondary }}>
                    {guest.name}
                  </Text>
                  <Text style={{ fontSize: 11, color: C.textTertiary }}>
                    {guest.wins + guest.losses} games · {guest.wins} wins
                  </Text>
                </View>
                <View style={{
                  backgroundColor: C.surfaceSecondary, borderRadius: C.radiusFull,
                  paddingHorizontal: 8, paddingVertical: 3,
                }}>
                  <Text style={{ fontSize: 11, color: C.textTertiary }}>Guest</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Divider */}
        <View style={{ height: 0.5, backgroundColor: C.borderTertiary, marginHorizontal: 20 }} />

        {/* ── Settings links ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}>
          <SettingsRow
            icon="🕐"
            label="Game history"
            onPress={() => router.push("/(tabs)/stats")}
          />
          <Pressable
            onPress={logout}
            style={({ pressed }) => ({
              marginTop: 8,
              backgroundColor: pressed ? "#7A1A1A" : "#8B2020",
              borderRadius: C.radiusMd,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            })}
          >
            <Text style={{ fontSize: 14, color: "#FFAAAA", fontWeight: "500" }}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* ── Sheets ── */}
      <AddFriendSheet
        visible={showAddFriend}
        onClose={() => setShowAddFriend(false)}
        user={user}
        friendUids={friendUids}
        onFriendAdded={async () => {
          const updated = await getFriends(user.uid);
          if (isMounted.current) setFriends(updated);
        }}
      />

      <AddGuestSheet
        visible={showAddGuest}
        onClose={() => setShowAddGuest(false)}
        uid={user.uid}
        onGuestCreated={(guest) => {
          setGuests((prev) => [...prev, guest]);
        }}
      />
    </>
  );
}
