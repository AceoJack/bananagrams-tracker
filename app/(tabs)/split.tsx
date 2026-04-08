import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { Animated, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SaveGameModal } from "../../components/SaveGameModal";
import { CelebrationOverlay } from "../../components/CelebrationOverlay";
import { AddPlayerSheet } from "../../components/AddPlayerSheet";
import { PlayerMultiSelect } from "../../components/PlayerMultiSelect";
import { FadeInView } from "../../components/FadeInView";
import { formatDuration } from "../../utils/format";
import { createGame, createPlayer, listPlayers } from "../../db/queries.firestore";
import type { Elimination, Player, StoredBoard } from "../../db/queries.firestore";
import * as Haptics from "expo-haptics";

// ── Types ─────────────────────────────────────────────────────────────────────

type GamePhase = "setup" | "playing" | "checking" | "ended";

// Checking sub-state: pick who called → show options → manual sub-check
type CheckSubMode = "pick" | "options" | "manual";

interface EliminationRecord {
  playerId: string;
  playerName: string;
  eliminatedAt: number; // elapsed ms when eliminated
}

interface PendingLastStanding {
  winnerId: string;
  winnerName: string;
  eliminations: EliminationRecord[];
  finalMs: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SplitScreen() {

  // ── Setup phase ───────────────────────────────────────────────────────────
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [setupSelectedIds, setSetupSelectedIds] = useState<string[]>([]);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);

  // ── Game state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<GamePhase>("setup");
  const [gamePlayers, setGamePlayers] = useState<Player[]>([]);
  const [eliminations, setEliminations] = useState<EliminationRecord[]>([]);
  const [playedAtISO, setPlayedAtISO] = useState("");

  // ── Timer (refs for interval accuracy, state for display) ─────────────────
  // accMsRef: total ms accumulated before the current segment
  // segStartRef: Date.now() when the current playing segment began (null = paused)
  const accMsRef = useRef(0);
  const segStartRef = useRef<number | null>(null);
  const [displayedSec, setDisplayedSec] = useState(0);

  // ── Checking phase ────────────────────────────────────────────────────────
  const [checkingPlayerId, setCheckingPlayerId] = useState<string | null>(null);
  const [checkSubMode, setCheckSubMode] = useState<CheckSubMode>("pick");
  const [checkBoardOpen, setCheckBoardOpen] = useState(false);

  // ── Last-standing board upload (optional, after game ends) ────────────────
  const [pendingLastStanding, setPendingLastStanding] = useState<PendingLastStanding | null>(null);
  const [uploadBoardOpen, setUploadBoardOpen] = useState(false);

  // ── Result ────────────────────────────────────────────────────────────────
  const [celebration, setCelebration] = useState<{ type: "bananas" | "rotten"; playerName?: string } | null>(null);
  // When a rotten result ends the game, we queue the bananas overlay to play after the rotten one
  const [queuedCelebration, setQueuedCelebration] = useState<{ type: "bananas"; playerName?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Button animation ──────────────────────────────────────────────────────
  const btnScale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(btnScale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1,    useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  // ── Derived ───────────────────────────────────────────────────────────────
  const activePlayers = gamePlayers.filter(p => !eliminations.some(e => e.playerId === p.id));
  const checkingPlayer = gamePlayers.find(p => p.id === checkingPlayerId) ?? null;

  // ── Load players on mount ─────────────────────────────────────────────────
  // Reload players whenever the tab gains focus — handles login after mount
  useFocusEffect(useCallback(() => { loadAllPlayers(); }, []));

  const loadAllPlayers = async () => {
    try {
      setAllPlayers(await listPlayers());
    } catch (e) {
      console.warn("[SplitScreen] failed to load players:", e);
    }
  };

  // ── Timer interval (only ticks when playing) ──────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      if (segStartRef.current !== null) {
        setDisplayedSec(Math.floor((accMsRef.current + Date.now() - segStartRef.current) / 1000));
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  // ── Timer helpers ─────────────────────────────────────────────────────────
  const pauseTimer = () => {
    if (segStartRef.current !== null) {
      accMsRef.current += Date.now() - segStartRef.current;
      segStartRef.current = null;
    }
  };

  const resumeTimer = () => {
    segStartRef.current = Date.now();
  };

  /** Returns total elapsed ms right now (safe to call while paused or running). */
  const snapshotElapsedMs = () =>
    accMsRef.current + (segStartRef.current !== null ? Date.now() - segStartRef.current : 0);

  // ── Setup handlers ────────────────────────────────────────────────────────
  const toggleSetupPlayer = (id: string) =>
    setSetupSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const handleCreatePlayer = async (name: string) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const p = await createPlayer(name);
    await loadAllPlayers();
    setSetupSelectedIds(prev => [...prev, p.id]);
  };

  const handleStartGame = async () => {
    if (setupSelectedIds.length === 0) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const locked = allPlayers.filter(p => setupSelectedIds.includes(p.id));
    setGamePlayers(locked);
    setEliminations([]);
    setPlayedAtISO(new Date().toISOString());
    setSaveError(null);

    accMsRef.current = 0;
    segStartRef.current = Date.now();
    setDisplayedSec(0);
    setPhase("playing");
  };

  // ── BANANAS press ─────────────────────────────────────────────────────────
  const handleBananas = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    pauseTimer();
    setCheckingPlayerId(null);
    setCheckSubMode("pick");
    setPhase("checking");
  };

  // ── Checking overlay handlers ─────────────────────────────────────────────
  const handleCancelChecking = () => {
    setCheckingPlayerId(null);
    setCheckSubMode("pick");
    resumeTimer();
    setPhase("playing");
  };

  const handleSelectCheckingPlayer = (id: string) => {
    setCheckingPlayerId(id);
    setCheckSubMode("options");
  };

  /** Called when a check result is determined (scan or manual). */
  const handleCheckResult = async (valid: boolean, board: StoredBoard | null) => {
    if (valid) {
      await saveGame(checkingPlayerId!, "bananas", board, eliminations);
    } else {
      // Rotten banana — record elimination (timer already paused)
      const playerName = checkingPlayer?.name ?? "Player";
      const newElimination: EliminationRecord = {
        playerId: checkingPlayerId!,
        playerName,
        eliminatedAt: accMsRef.current, // ms at pause point
      };
      const newEliminations = [...eliminations, newElimination];
      setEliminations(newEliminations);
      setCheckingPlayerId(null);
      setCheckSubMode("pick");

      const remaining = gamePlayers.filter(
        p => !newEliminations.some(e => e.playerId === p.id)
      );

      if (remaining.length <= 1) {
        if (remaining.length === 1) {
          // Last player standing — capture game data now (timer is already paused)
          // and give the winner a chance to upload their board before saving.
          const winner = remaining[0];
          setPendingLastStanding({
            winnerId: winner.id,
            winnerName: winner.name,
            eliminations: newEliminations,
            finalMs: accMsRef.current,
          });
          setPhase("ended");
          // Play rotten for the eliminated player, then bananas for the winner
          setQueuedCelebration({ type: "bananas", playerName: winner.name });
          setCelebration({ type: "rotten", playerName });
        } else {
          // Edge case: all players somehow eliminated — just reset
          resetToSetup();
        }
      } else {
        // Resume the game for the remaining players
        setPhase("playing");
        resumeTimer();
        setCelebration({ type: "rotten", playerName });
      }
    }
  };

  // ── Save game ─────────────────────────────────────────────────────────────
  const saveGame = async (
    winnerId: string,
    outcome: "bananas" | "last_standing",
    board: StoredBoard | null,
    currentEliminations: EliminationRecord[],
    rottenPlayerName?: string, // when set, play rotten first then bananas
  ) => {
    const finalMs = snapshotElapsedMs();
    setPhase("ended");
    setSaving(true);
    try {
      const elimsPayload: Elimination[] = currentEliminations.map(e => ({
        playerId: e.playerId,
        eliminatedAt: e.eliminatedAt,
        reason: "rotten",
      }));

      await createGame({
        playedAtISO,
        durationSeconds: Math.floor(finalMs / 1000),
        playerIds: gamePlayers.map(p => p.id),
        winnerId,
        board: board ?? undefined,
        ...(elimsPayload.length ? { eliminations: elimsPayload } : {}),
        outcome,
      });

      const winnerName = gamePlayers.find(p => p.id === winnerId)?.name;
      if (rottenPlayerName) {
        // Sequence: rotten (loser) → bananas (winner)
        setQueuedCelebration({ type: "bananas", playerName: winnerName });
        setCelebration({ type: "rotten", playerName: rottenPlayerName });
      } else {
        setCelebration({ type: "bananas", playerName: winnerName });
      }
    } catch (e: any) {
      setSaveError(e?.message ?? "Could not save game");
      // Revert so the user can try again or reset
      setPhase("ended");
    } finally {
      setSaving(false);
    }
  };

  // ── Complete last-standing save (with optional board) ─────────────────────
  const completePendingSave = async (board?: StoredBoard) => {
    if (!pendingLastStanding) return;
    const { winnerId, eliminations: elims, finalMs } = pendingLastStanding;
    setSaving(true);
    setSaveError(null);
    try {
      const elimsPayload: Elimination[] = elims.map(e => ({
        playerId: e.playerId,
        eliminatedAt: e.eliminatedAt,
        reason: "rotten",
      }));
      await createGame({
        playedAtISO,
        durationSeconds: Math.floor(finalMs / 1000),
        playerIds: gamePlayers.map(p => p.id),
        winnerId,
        ...(board ? { board } : {}),
        ...(elimsPayload.length ? { eliminations: elimsPayload } : {}),
        outcome: "last_standing",
      });
      setPendingLastStanding(null);
      resetToSetup();
    } catch (e: any) {
      setSaveError(e?.message ?? "Could not save game");
    } finally {
      setSaving(false);
    }
  };

  // ── Reset to setup ────────────────────────────────────────────────────────
  const resetToSetup = () => {
    accMsRef.current = 0;
    segStartRef.current = null;
    setDisplayedSec(0);
    setPhase("setup");
    setGamePlayers([]);
    setEliminations([]);
    setCheckingPlayerId(null);
    setCheckSubMode("pick");
    setCheckBoardOpen(false);
    setPendingLastStanding(null);
    setUploadBoardOpen(false);
    setSaveError(null);
    setCelebration(null);
    setQueuedCelebration(null);
    loadAllPlayers();
  };

  // ── Render: Setup phase ───────────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <FadeInView>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 40, gap: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ fontSize: 28, fontWeight: "800" }}>New Game</Text>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: "#333" }}>Select Players</Text>
            {allPlayers.length === 0 ? (
              <Text style={{ color: "#999", fontStyle: "italic" }}>No players yet. Add one below.</Text>
            ) : (
              <PlayerMultiSelect
                players={allPlayers}
                selectedIds={setupSelectedIds}
                onToggle={toggleSetupPlayer}
              />
            )}
            <Pressable onPress={() => setAddPlayerOpen(true)} style={{ alignSelf: "flex-start", paddingVertical: 4 }}>
              <Text style={{ fontSize: 15, color: "#555" }}>+ Add Player</Text>
            </Pressable>
          </View>

          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable
              onPress={handleStartGame}
              onPressIn={pressIn}
              onPressOut={pressOut}
              disabled={setupSelectedIds.length === 0}
              style={{
                padding: 16, borderRadius: 14,
                backgroundColor: setupSelectedIds.length === 0 ? "#ddd" : "#FFED29",
                alignItems: "center",
                shadowColor: setupSelectedIds.length === 0 ? "transparent" : "#FFED29",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.5, shadowRadius: 12, elevation: 6,
              }}
            >
              <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>SPLIT</Text>
            </Pressable>
          </Animated.View>
        </ScrollView>

        <AddPlayerSheet
          visible={addPlayerOpen}
          onClose={async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setAddPlayerOpen(false);
          }}
          onCreate={handleCreatePlayer}
        />
      </FadeInView>
    );
  }

  // ── Render: Timer screen (playing / checking / ended) ─────────────────────
  return (
    <FadeInView>
      <View style={{ flex: 1, padding: 16, gap: 16, justifyContent: "center" }}>

        {/* Timer */}
        <Text style={{ fontSize: 48, fontWeight: "800", textAlign: "center" }}>
          {formatDuration(displayedSec)}
        </Text>
        {phase === "checking" && (
          <Text style={{ textAlign: "center", color: "#888", fontSize: 13 }}>Timer paused</Text>
        )}

        {/* Player list */}
        {gamePlayers.length > 0 && (
          <View style={{ gap: 4 }}>
            {gamePlayers.map(p => {
              const elim = eliminations.find(e => e.playerId === p.id);
              return (
                <View
                  key={p.id}
                  style={{
                    flexDirection: "row", justifyContent: "space-between",
                    paddingHorizontal: 12, paddingVertical: 8,
                    borderRadius: 10,
                    backgroundColor: elim ? "#f5f5f5" : "#fff",
                    borderWidth: 1,
                    borderColor: elim ? "#eee" : "#f0f0f0",
                  }}
                >
                  <Text style={{
                    fontSize: 15,
                    color: elim ? "#bbb" : "#222",
                    textDecorationLine: elim ? "line-through" : "none",
                  }}>
                    {p.name}
                  </Text>
                  {elim && (
                    <Text style={{ fontSize: 12, color: "#bbb" }}>
                      Rotten @ {formatDuration(Math.floor(elim.eliminatedAt / 1000))}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* BANANAS button */}
        {phase === "playing" && (
          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable
              onPress={handleBananas}
              onPressIn={pressIn}
              onPressOut={pressOut}
              style={{
                padding: 16, borderRadius: 14,
                backgroundColor: "#2bff00ff",
                alignItems: "center",
                shadowColor: "#2bff00ff",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.5, shadowRadius: 12, elevation: 6,
              }}
            >
              <Text style={{ color: "black", fontSize: 18, fontWeight: "700" }}>BANANAGRAMS</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* Saving indicator — only for direct bananas wins (upload prompt has its own) */}
        {saving && !pendingLastStanding && (
          <Text style={{ textAlign: "center", color: "#888" }}>Saving…</Text>
        )}
        {saveError && !pendingLastStanding && (
          <Text style={{ textAlign: "center", color: "#c00" }}>{saveError}</Text>
        )}

        {/* Last-standing board upload prompt */}
        {phase === "ended" && pendingLastStanding && !celebration && (
          <View style={{
            borderRadius: 16, borderWidth: 1, borderColor: "#eee",
            backgroundColor: "#fafafa", padding: 20, gap: 14,
          }}>
            <Text style={{ fontSize: 17, fontWeight: "700", textAlign: "center" }}>
              {pendingLastStanding.winnerName}, upload your board?
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setUploadBoardOpen(true)}
                style={{
                  flex: 1, padding: 14, borderRadius: 12,
                  backgroundColor: "#111", alignItems: "center",
                }}
              >
                <Text style={{ color: "white", fontWeight: "700" }}>Scan Board</Text>
              </Pressable>
              <Pressable
                onPress={() => completePendingSave()}
                disabled={saving}
                style={{
                  flex: 1, padding: 14, borderRadius: 12,
                  borderWidth: 1, borderColor: "#ddd", alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "600", color: "#555" }}>
                  {saving ? "Saving…" : "Skip"}
                </Text>
              </Pressable>
            </View>
            {saveError && (
              <Text style={{ textAlign: "center", color: "#c00", fontSize: 13 }}>{saveError}</Text>
            )}
          </View>
        )}

        {/* Reset / new game — hide when upload prompt is showing */}
        {!(phase === "ended" && pendingLastStanding && !celebration) && (
          <Pressable onPress={resetToSetup} style={{ alignSelf: "center", padding: 8 }}>
            <Text style={{ color: "#bbb", fontSize: 13 }}>
              {phase === "ended" ? "New Game" : "Reset"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Checking overlay ───────────────────────────────────────────── */}
      <Modal visible={phase === "checking"} transparent animationType="fade">
        <View style={{
          flex: 1, backgroundColor: "rgba(0,0,0,0.72)",
          justifyContent: "center", padding: 24,
        }}>
          <View style={{
            backgroundColor: "white", borderRadius: 20, padding: 24, gap: 16,
            shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 16, elevation: 10,
          }}>

            {/* ── State A: pick who called ── */}
            {checkSubMode === "pick" && (
              <>
                <Text style={{ fontSize: 22, fontWeight: "800", textAlign: "center" }}>
                  Who called Bananas?
                </Text>
                <View style={{ gap: 10 }}>
                  {activePlayers.map(p => (
                    <Pressable
                      key={p.id}
                      onPress={() => handleSelectCheckingPlayer(p.id)}
                      style={{
                        padding: 14, borderRadius: 12,
                        backgroundColor: "#FFED29",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ fontWeight: "700", fontSize: 16 }}>{p.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={handleCancelChecking} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: "#aaa", fontSize: 14 }}>Cancel (resume timer)</Text>
                </Pressable>
              </>
            )}

            {/* ── State B: scan or manual choice ── */}
            {checkSubMode === "options" && checkingPlayer && (
              <>
                <Text style={{ fontSize: 20, fontWeight: "800", textAlign: "center" }}>
                  {checkingPlayer.name} called Bananas!
                </Text>
                <Pressable
                  onPress={() => setCheckBoardOpen(true)}
                  style={{
                    padding: 14, borderRadius: 12,
                    backgroundColor: "#111",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>Scan Board</Text>
                </Pressable>
                <Pressable
                  onPress={() => setCheckSubMode("manual")}
                  style={{
                    padding: 14, borderRadius: 12,
                    borderWidth: 1, borderColor: "#ddd",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "600", fontSize: 15 }}>Manual Check</Text>
                </Pressable>
                <Pressable onPress={() => setCheckSubMode("pick")} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: "#aaa" }}>← Back</Text>
                </Pressable>
              </>
            )}

            {/* ── State C: manual yes/no ── */}
            {checkSubMode === "manual" && checkingPlayer && (
              <>
                <Text style={{ fontSize: 20, fontWeight: "800", textAlign: "center" }}>
                  Is {checkingPlayer.name}'s board valid?
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Pressable
                    onPress={() => handleCheckResult(true, null)}
                    style={{
                      flex: 1, padding: 16, borderRadius: 12,
                      backgroundColor: "#2bff00ff",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "800", fontSize: 18 }}>✓ Valid</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleCheckResult(false, null)}
                    style={{
                      flex: 1, padding: 16, borderRadius: 12,
                      backgroundColor: "#FFEBEE", borderWidth: 1, borderColor: "#FFCDD2",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "800", fontSize: 18, color: "#C62828" }}>✗ Rotten</Text>
                  </Pressable>
                </View>
                <Pressable onPress={() => setCheckSubMode("options")} style={{ alignSelf: "center", padding: 8 }}>
                  <Text style={{ color: "#aaa" }}>← Back</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Board scan modal (check mode) ─────────────────────────────── */}
      <SaveGameModal
        visible={checkBoardOpen}
        mode="check"
        onClose={() => setCheckBoardOpen(false)}
        durationSeconds={displayedSec}
        playedAtISO={playedAtISO}
        onSaved={() => {}}
        onCheckResult={({ valid, board }) => {
          setCheckBoardOpen(false);
          handleCheckResult(valid, board);
        }}
      />

      {/* ── Last-standing board upload modal ─────────────────────────── */}
      <SaveGameModal
        visible={uploadBoardOpen}
        mode="upload"
        onClose={() => setUploadBoardOpen(false)}
        durationSeconds={displayedSec}
        playedAtISO={playedAtISO}
        onSaved={() => {}}
        onCheckResult={({ board }) => {
          setUploadBoardOpen(false);
          completePendingSave(board ?? undefined);
        }}
      />

      {/* ── Celebration overlay ───────────────────────────────────────── */}
      {celebration && (
        <CelebrationOverlay
          key={celebration.type + (celebration.playerName ?? "")}
          type={celebration.type}
          playerName={celebration.playerName}
          onDone={() => {
            if (queuedCelebration) {
              setCelebration(queuedCelebration);
              setQueuedCelebration(null);
            } else {
              setCelebration(null);
              // If there's a pending last-standing save, show the board upload prompt.
              // Otherwise reset to setup (normal bananas win or mid-game rotten resume).
              if (phase === "ended" && !pendingLastStanding) resetToSetup();
            }
          }}
        />
      )}
    </FadeInView>
  );
}
