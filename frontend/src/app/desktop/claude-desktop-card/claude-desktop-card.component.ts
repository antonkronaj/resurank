import {Component, computed, effect, inject, input, OnInit} from '@angular/core';
import {CommonModule} from '@angular/common';
import {ClaudeDesktopService} from '../claude-desktop.service';

@Component({
  selector: 'app-claude-desktop-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './claude-desktop-card.component.html',
  styleUrl: './claude-desktop-card.component.css',
})
export class ClaudeDesktopCardComponent implements OnInit {
  /**
   * A signal-bearing input the parent can wire to its resume reference. When
   * it changes (e.g. user uploads a new resume), the card re-syncs the
   * exported file so RESUME_PATH stays current. The actual text is read on
   * the main side from resume.json — the input just signals "something
   * changed, re-sync."
   */
  resumeRev = input<unknown>(null);

  private readonly service = inject(ClaudeDesktopService);

  readonly status = this.service.status;
  readonly busy = this.service.busy;
  readonly lastError = this.service.lastError;

  readonly connected = computed(() => this.status()?.connected ?? false);
  readonly warnings = computed(() => this.status()?.warnings ?? []);

  constructor() {
    effect(() => {
      // Touch the signal so the effect tracks changes
      this.resumeRev();
      if (this.status()?.connected) {
        this.service.syncResume().catch(() => { /* non-fatal */ });
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.service.refresh();
  }

  async onConnect(): Promise<void> {
    await this.service.connect();
  }

  async onDisconnect(): Promise<void> {
    await this.service.disconnect();
  }
}
