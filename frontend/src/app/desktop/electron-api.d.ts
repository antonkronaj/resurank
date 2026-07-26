import {MissingKeywordSettings, PreferenceMismatchSettings, ResumeData, StoreSnapshot} from '../shared/storage/storage-adapter';

export {};

export interface ClaudeDesktopStatus {
  configPath: string;
  configExists: boolean;
  connected: boolean;
  resumePath: string | null;
  resumeExists: boolean;
  nodePath: string | null;
  mcpServerPath: string | null;
  warnings: string[];
  resumeFilenameForDisplay: string;
}

export interface ClaudeDesktopConnectResult {
  ok: boolean;
  wrote: boolean;
  status: ClaudeDesktopStatus;
}

declare global {
  interface Window {
    electronAPI: {
      getAppVersion(): Promise<string>;
      platform: NodeJS.Platform;
      onUpdateReady(cb: () => void): void;
      writeToClipboard(text: string): Promise<void>;
      getUserDataPath(): Promise<string>;
      storeRead(): Promise<StoreSnapshot>;
      storeWriteResume(data: ResumeData): Promise<void>;
      storeSavePdf(buffer: ArrayBuffer): Promise<void>;
      storeWriteStopwords(words: string[]): Promise<void>;
      storeWriteTermBoosts(boosts: Record<string, number>): Promise<void>;
      storeWriteMissingKeywordSettings(settings: MissingKeywordSettings): Promise<void>;
      storeWritePreferenceMismatchSettings(settings: PreferenceMismatchSettings): Promise<void>;
      claudeDesktopStatus(): Promise<ClaudeDesktopStatus>;
      claudeDesktopConnect(): Promise<ClaudeDesktopConnectResult>;
      claudeDesktopDisconnect(): Promise<ClaudeDesktopConnectResult>;
      claudeDesktopSyncResume(): Promise<string | null>;
    };
  }
}
