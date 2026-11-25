import { api } from './api';
import type { ResearchDataset, ResearchExperiment, ResearchInput } from './backtestResearch';

const base = '/api/v1/backtests';
export const listResearchDatasets = (signal?: AbortSignal) => api<{ datasets: ResearchDataset[] }>(`${base}/datasets`, { signal });
export const importResearchDataset = (document: unknown) => api<ResearchDataset>(`${base}/datasets`, { method: 'POST', body: document });
export const createResearchExperiment = (input: ResearchInput | { kind: 'options'; datasetId: string; execution: unknown }) => api<ResearchExperiment>(`${base}/experiments`, { method: 'POST', body: input });
export const listResearchExperiments = (signal?: AbortSignal) => api<{ experiments: ResearchExperiment[] }>(`${base}/experiments`, { signal });
export const getResearchExperiment = (id: string, signal?: AbortSignal) => api<ResearchExperiment>(`${base}/experiments/${encodeURIComponent(id)}`, { signal });
export const cancelResearchExperiment = (id: string) => api<ResearchExperiment>(`${base}/experiments/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
