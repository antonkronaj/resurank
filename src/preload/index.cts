import {contextBridge, ipcRenderer} from 'electron';

interface ResumeData {
  filename: string;
  text: string;
  terms: string[];
  uploadedAt: string;
}

interface PinnedTerm {
  term: string;
  importance: 'low' | 'medium' | 'high';
}

interface MissingKeywordSettings {
  enabled: boolean;
  maxPenalty: number;
  pinnedTerms: PinnedTerm[];
}

interface PreferenceMismatchSettings {
  enabled: boolean;
  maxPenalty: number;
  text: string;
}

interface StoreSnapshot {
  resume: ResumeData | null;
  stopwords: string[];
  termBoosts: Record<string, number>;
  missingKeywordSettings: MissingKeywordSettings;
  preferenceMismatchSettings: PreferenceMismatchSettings;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
  onUpdateReady: (cb: () => void): void => {
    ipcRenderer.on('update-ready', cb);
  },
  writeToClipboard: (text: string): Promise<void> => ipcRenderer.invoke('write-clipboard', text),
  getUserDataPath: (): Promise<string> => ipcRenderer.invoke('get-user-data-path'),
  storeRead: (): Promise<StoreSnapshot> => ipcRenderer.invoke('store-read'),
  storeWriteResume: (data: ResumeData): Promise<void> => ipcRenderer.invoke('store-write-resume', data),
  storeSavePdf: (buffer: ArrayBuffer): Promise<void> => ipcRenderer.invoke('store-save-pdf', buffer),
  storeWriteStopwords: (words: string[]): Promise<void> => ipcRenderer.invoke('store-write-stopwords', words),
  storeWriteTermBoosts: (boosts: Record<string, number>): Promise<void> => ipcRenderer.invoke('store-write-term-boosts', boosts),
  storeWriteMissingKeywordSettings: (settings: MissingKeywordSettings): Promise<void> => ipcRenderer.invoke('store-write-missing-keyword-settings', settings),
  storeWritePreferenceMismatchSettings: (settings: PreferenceMismatchSettings): Promise<void> => ipcRenderer.invoke('store-write-preference-mismatch-settings', settings),
});
