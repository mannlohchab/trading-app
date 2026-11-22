// Home daily market brief (`GET /api/v1/ai/daily-brief`). Cached per UTC day on the server.
import { api, ApiError } from './api';
import { authHeaders } from './authClient';
import { API_URL } from './config';
import { DEMO_MODE } from './demoMode';

export type DailyBrief = {
  date: string;
  content: string;
  hasAudio: boolean;
  generatedAt: string;
  disclaimer: string;
};

export async function fetchDailyBrief(signal?: AbortSignal): Promise<DailyBrief> {
  if (DEMO_MODE) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      date: today,
      content: `Market brief · ${today}\nBias cue: demo movers are mixed.\n• BTCUSDT +1.2%\n• ETHUSDT −0.4%\nWatch confirmation on the 4h chart before sizing a paper trade.`,
      hasAudio: false,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Educational market summary only — not investment advice.',
    };
  }
  return api<DailyBrief>('/api/v1/ai/daily-brief', { signal });
}

/** Fetches today's TTS audio as a data URI for in-app playback (no native audio module required). */
export async function fetchDailyBriefAudioDataUri(signal?: AbortSignal): Promise<string> {
  if (DEMO_MODE) throw new ApiError(404, 'Audio unavailable in demo mode.', 'AUDIO_UNAVAILABLE');
  const auth = await authHeaders();
  const res = await fetch(`${API_URL}/api/v1/ai/daily-brief/audio`, {
    method: 'GET',
    signal,
    credentials: auth.credentials,
    headers: { ...auth.headers },
  });
  if (!res.ok) {
    if (res.status === 404) throw new ApiError(404, 'Audio is not available for today’s brief.', 'AUDIO_UNAVAILABLE');
    throw new ApiError(res.status, 'Could not download brief audio.');
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
