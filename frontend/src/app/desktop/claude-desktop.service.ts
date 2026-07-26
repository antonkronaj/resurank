import {Injectable, signal} from '@angular/core';
import {ClaudeDesktopConnectResult, ClaudeDesktopStatus} from './electron-api';

@Injectable({providedIn: 'root'})
export class ClaudeDesktopService {
  readonly status = signal<ClaudeDesktopStatus | null>(null);
  readonly busy = signal(false);
  readonly lastError = signal<string | null>(null);

  async refresh(): Promise<ClaudeDesktopStatus> {
    const s = await window.electronAPI.claudeDesktopStatus();
    this.status.set(s);
    return s;
  }

  async connect(): Promise<ClaudeDesktopConnectResult> {
    this.busy.set(true);
    this.lastError.set(null);
    try {
      const result = await window.electronAPI.claudeDesktopConnect();
      this.status.set(result.status);
      if (!result.ok) {
        this.lastError.set(result.status?.warnings?.[0] ?? 'Could not write Claude Desktop config.');
      }
      return result;
    } finally {
      this.busy.set(false);
    }
  }

  async disconnect(): Promise<ClaudeDesktopConnectResult> {
    this.busy.set(true);
    this.lastError.set(null);
    try {
      const result = await window.electronAPI.claudeDesktopDisconnect();
      this.status.set(result.status);
      if (!result.ok) {
        this.lastError.set(result.status?.warnings?.[0] ?? 'Could not write Claude Desktop config.');
      }
      return result;
    } finally {
      this.busy.set(false);
    }
  }

  async syncResume(): Promise<void> {
    await window.electronAPI.claudeDesktopSyncResume();
  }
}
