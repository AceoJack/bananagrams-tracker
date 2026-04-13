/**
 * Mobile-web-safe audio playback.
 *
 * iOS Safari only allows audio.play() when called synchronously inside a user
 * gesture handler. By the time a useEffect fires (even one triggered by a button
 * press), Safari has already dropped the gesture context and will block playback.
 *
 * Fix: call unlockAudio() synchronously inside any onPress that could eventually
 * trigger a celebration. This plays+immediately pauses each pre-loaded element,
 * which registers a real gesture with Safari and permanently unlocks the context
 * for subsequent plays — even those fired from async callbacks or useEffect.
 */

import { Platform } from "react-native";

const SOURCES = {
  bananas: require("../assets/sounds/bananas.mp3") as string,
  rotten:  require("../assets/sounds/rotten-bananas.mp3") as string,
};

type SoundKey = keyof typeof SOURCES;

// Audio elements created once and reused — never recreated
const _cache: Partial<Record<SoundKey, HTMLAudioElement>> = {};
let _unlocked = false;

function getEl(key: SoundKey): HTMLAudioElement | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  if (!_cache[key]) {
    const el = new (window as any).Audio(SOURCES[key]) as HTMLAudioElement;
    el.preload = "auto";
    el.load();
    _cache[key] = el;
  }
  return _cache[key]!;
}

/**
 * Call this synchronously inside any onPress handler that could lead to a
 * celebration (e.g. BANANAS!, Valid, Rotten). Safe to call multiple times.
 */
export function unlockAudio(): void {
  if (_unlocked || Platform.OS !== "web") return;
  _unlocked = true;
  for (const key of Object.keys(SOURCES) as SoundKey[]) {
    const el = getEl(key);
    if (!el) continue;
    el.play().then(() => { el.pause(); el.currentTime = 0; }).catch(() => {});
  }
}

/**
 * Play a sound. If the audio context hasn't been unlocked yet this will still
 * attempt playback (works on Android and desktop where autoplay is permitted).
 */
export function playSound(key: SoundKey): void {
  if (Platform.OS !== "web") return; // native handled separately via expo-av
  const el = getEl(key);
  if (!el) return;
  el.currentTime = 0;
  el.play().catch(() => {});
}
