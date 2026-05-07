export {};

declare global {
  interface Window {
    electronAPI: {
      getAppVersion(): Promise<string>;
      platform: NodeJS.Platform;
      onUpdateReady(cb: () => void): void;
      writeToClipboard(text: string): Promise<void>;
    };
  }
}
