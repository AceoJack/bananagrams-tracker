let dict: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;

export async function loadDictionary(): Promise<Set<string>> {
  if (dict) return dict;
  if (loading) return loading;

  loading = fetch("CSW24.txt")
    .then((r) => {
      if (!r.ok) throw new Error(`Failed to load dictionary: ${r.status}`);
      return r.text();
    })
    .then((text) => {
      dict = new Set(text.split("\n").map((w) => w.trim().toUpperCase()).filter(Boolean));
      return dict;
    })
    .catch((e) => {
      loading = null; // allow retry on next call
      throw e;
    });

  return loading;
}

/** Returns true if the word is valid, or null if the dictionary hasn't loaded yet. */
export function checkWord(word: string): boolean | null {
  if (!dict) return null;
  return dict.has(word.toUpperCase());
}
