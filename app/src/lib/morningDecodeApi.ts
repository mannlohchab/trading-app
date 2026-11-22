// Morning Decode (`GET /api/v1/ai/morning-decode`). Shared audio briefing; no transcript.
import { api, ApiError } from './api';
import { authHeaders } from './authClient';
import { API_URL } from './config';
import { DEMO_MODE } from './demoMode';

export type MorningDecode = {
  date: string;
  title: string;
  sessionLabel: string;
  durationSeconds: number | null;
  hasAudio: boolean;
  available: boolean;
  generatedAt: string | null;
  disclaimer: string;
};

export async function fetchMorningDecode(signal?: AbortSignal): Promise<MorningDecode> {
  if (DEMO_MODE) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      date: today,
      title: 'Morning Decode',
      sessionLabel: 'Previous session · demo',
      durationSeconds: null,
      hasAudio: false,
      available: false,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Educational market briefing only — not investment advice.',
    };
  }
  return api<MorningDecode>('/api/v1/ai/morning-decode', { signal });
}

/** Fetches today's shared TTS audio as a data URI for in-app playback. */
export async function fetchMorningDecodeAudioDataUri(signal?: AbortSignal): Promise<string> {
  if (DEMO_MODE) throw new ApiError(404, 'Audio unavailable in demo mode.', 'AUDIO_UNAVAILABLE');
  const auth = await authHeaders();
  const res = await fetch(`${API_URL}/api/v1/ai/morning-decode/audio`, {
    method: 'GET',
    signal,
    credentials: auth.credentials,
    headers: { ...auth.headers },
  });
  if (!res.ok) {
    if (res.status === 404) throw new ApiError(404, 'Morning Decode audio is not available yet.', 'AUDIO_UNAVAILABLE');
    throw new ApiError(res.status, 'Could not download Morning Decode audio.');
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const contentType = res.headers.get('content-type') || 'audio/mpeg';
  return `data:${contentType};base64,${btoa(binary)}`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—:—';
  const s = Math.floor(totalSeconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}
