import {MissingKeywordSettings, ResumeData, StoreSnapshot} from './app/storage.service';

export {};

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
    };
  }
}
