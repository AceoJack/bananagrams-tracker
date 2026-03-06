import { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import {
  clearTemplateCache,
  getTemplateDataUrls,
  loadTemplates,
  processTemplatePhoto,
  uploadTemplate,
} from '../utils/templates';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

type LetterState = 'empty' | 'uploading' | 'done' | 'error';

interface LetterStatus {
  state: LetterState;
  previewUrl?: string; // processed template preview (object URL)
}

export function TemplateSetup({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [statuses, setStatuses] = useState<Record<string, LetterStatus>>(() =>
    Object.fromEntries(LETTERS.map((l) => [l, { state: 'empty' }])),
  );
  const [pendingLetter, setPendingLetter] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pendingPixels, setPendingPixels] = useState<Uint8Array | null>(null);
  const [checking, setChecking] = useState(false);

  // On open, load all uploaded templates and show their actual processed images
  useEffect(() => {
    if (!visible) return;
    setChecking(true);
    loadTemplates()
      .then((templateMap) => {
        const dataUrls = getTemplateDataUrls(templateMap);
        setStatuses((prev) => {
          const next = { ...prev };
          for (const [letter, dataUrl] of dataUrls) {
            next[letter] = { state: 'done', previewUrl: dataUrl };
          }
          return next;
        });
      })
      .catch(console.error)
      .finally(() => setChecking(false));
  }, [visible]);

  const uploadedCount = Object.values(statuses).filter((s) => s.state === 'done').length;

  const handlePickPhoto = (letter: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setStatuses((prev) => ({
        ...prev,
        [letter]: { state: 'uploading' },
      }));

      try {
        const { pixels, previewUrl } = await processTemplatePhoto(file);
        setPendingLetter(letter);
        setPendingPreview(previewUrl);
        setPendingPixels(pixels);
        setStatuses((prev) => ({ ...prev, [letter]: { state: 'empty' } }));
      } catch (e) {
        console.error('[TemplateSetup] processing failed:', e);
        setStatuses((prev) => ({ ...prev, [letter]: { state: 'error' } }));
        Alert.alert('Processing failed', String(e));
      }
    };

    input.click();
  };

  const handleConfirmUpload = async () => {
    if (!pendingLetter || !pendingPixels) return;
    const letter = pendingLetter;

    setStatuses((prev) => ({ ...prev, [letter]: { state: 'uploading' } }));
    setPendingLetter(null);

    try {
      await uploadTemplate(letter, pendingPixels);
      clearTemplateCache();
      setStatuses((prev) => ({
        ...prev,
        [letter]: { state: 'done', previewUrl: pendingPreview ?? undefined },
      }));
    } catch (e) {
      console.error('[TemplateSetup] upload failed:', e);
      setStatuses((prev) => ({ ...prev, [letter]: { state: 'error' } }));
      Alert.alert('Upload failed', String(e));
    } finally {
      setPendingPixels(null);
      setPendingPreview(null);
    }
  };

  const handleCancelUpload = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingLetter(null);
    setPendingPreview(null);
    setPendingPixels(null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={{ flex: 1, backgroundColor: 'white' }}>
        {/* Header */}
        <View
          style={{
            paddingTop: 56,
            paddingHorizontal: 20,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: '#eee',
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '700' }}>Letter Templates</Text>
            <Pressable onPress={onClose} style={{ padding: 8 }}>
              <Text style={{ fontSize: 16, color: '#666' }}>Done</Text>
            </Pressable>
          </View>
          <Text style={{ color: '#666', marginTop: 4 }}>
            {checking
              ? 'Checking existing templates…'
              : `${uploadedCount} / 26 uploaded. Tap any letter to upload its reference photo.`}
          </Text>
          {uploadedCount < 26 && !checking && (
            <Text style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
              Tip: crop each photo to remove the shadow edge before selecting.
            </Text>
          )}
        </View>

        {/* Letter grid */}
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {LETTERS.map((letter) => {
              const status = statuses[letter];
              const isDone = status.state === 'done';
              const isUploading = status.state === 'uploading';
              const isError = status.state === 'error';

              return (
                <Pressable
                  key={letter}
                  onPress={() => !isUploading && handlePickPhoto(letter)}
                  style={{
                    width: 58,
                    height: 70,
                    borderRadius: 8,
                    borderWidth: 2,
                    borderColor: isDone ? '#4caf50' : isError ? '#f44336' : '#ddd',
                    backgroundColor: isDone ? '#f1f8f1' : isError ? '#fff0f0' : '#fafafa',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {/* Show processed template preview if we have it, otherwise just the letter */}
                  {isDone && status.previewUrl ? (
                    <Image
                      source={{ uri: status.previewUrl }}
                      style={{ width: 54, height: 54, borderRadius: 6 }}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text
                      style={{
                        fontSize: 26,
                        fontWeight: '700',
                        fontFamily: 'monospace',
                        color: isDone ? '#2e7d32' : isError ? '#c62828' : '#333',
                      }}
                    >
                      {isUploading ? '…' : letter}
                    </Text>
                  )}
                  {/* Status indicator dot */}
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: isDone ? '#4caf50' : isError ? '#f44336' : '#ccc',
                      position: 'absolute',
                      bottom: 5,
                      right: 5,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>

          <View
            style={{
              marginTop: 24,
              padding: 14,
              backgroundColor: '#f5f5f5',
              borderRadius: 10,
              gap: 6,
            }}
          >
            <Text style={{ fontWeight: '600' }}>How to get the best templates</Text>
            <Text style={{ color: '#555', lineHeight: 20 }}>
              • Lay the tile flat on any surface{'\n'}
              • Hold phone directly overhead (perpendicular to tile){'\n'}
              • Use even, diffuse light — avoid harsh shadows{'\n'}
              • Crop out the shadow at the tile edge before uploading{'\n'}
              • Letter must be right-side up
            </Text>
          </View>
        </ScrollView>

        {/* Confirmation overlay */}
        {pendingLetter && pendingPreview && pendingPixels && (
          <View
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 32,
            }}
          >
            <View
              style={{
                backgroundColor: 'white',
                borderRadius: 16,
                padding: 24,
                width: '100%',
                gap: 16,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '700' }}>
                Upload template for "{pendingLetter}"?
              </Text>
              <Text style={{ color: '#666', textAlign: 'center' }}>
                This is the processed image Tesseract will compare against. The letter should be
                clearly visible as black on white.
              </Text>
              <Image
                source={{ uri: pendingPreview }}
                style={{
                  width: 160,
                  height: 160,
                  borderRadius: 8,
                  backgroundColor: '#f0f0f0',
                  borderWidth: 1,
                  borderColor: '#ddd',
                }}
                resizeMode="contain"
              />
              <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                <Pressable
                  onPress={handleCancelUpload}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#ddd',
                    alignItems: 'center',
                  }}
                >
                  <Text>Retake</Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirmUpload}
                  style={{
                    flex: 1,
                    padding: 14,
                    borderRadius: 10,
                    backgroundColor: '#111',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: 'white', fontWeight: '600' }}>Upload</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
