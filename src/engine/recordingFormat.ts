export interface RecordingFormat {
  mimeType: string;
  extension: 'mp4' | 'webm';
  label: 'MP4' | 'WebM';
}

const RECORDING_FORMAT_CANDIDATES: RecordingFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', label: 'MP4' },
  { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4' },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm', label: 'WebM' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', label: 'WebM' },
  { mimeType: 'video/webm', extension: 'webm', label: 'WebM' },
];

export function findSupportedRecordingFormat(
  isTypeSupported: (mimeType: string) => boolean
): RecordingFormat | null {
  for (const candidate of RECORDING_FORMAT_CANDIDATES) {
    try {
      if (isTypeSupported(candidate.mimeType)) return candidate;
    } catch {
      // Continue to the next browser-recognized container.
    }
  }
  return null;
}

export function resolveRecordingFormat(
  actualMimeType: string,
  fallback: RecordingFormat
): RecordingFormat | null {
  const normalizedMimeType = actualMimeType.toLowerCase().trim();
  if (!normalizedMimeType) return fallback;
  if (normalizedMimeType.startsWith('video/mp4')) {
    return { mimeType: actualMimeType, extension: 'mp4', label: 'MP4' };
  }
  if (normalizedMimeType.startsWith('video/webm')) {
    return { mimeType: actualMimeType, extension: 'webm', label: 'WebM' };
  }
  return null;
}
