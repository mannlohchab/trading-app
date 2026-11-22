/** @deprecated Use `@/lib/morningDecodeApi` — Home now serves Morning Decode (audio only). */
export {
  fetchMorningDecode as fetchDailyBrief,
  fetchMorningDecodeAudioDataUri as fetchDailyBriefAudioDataUri,
  type MorningDecode as DailyBrief,
} from './morningDecodeApi';
