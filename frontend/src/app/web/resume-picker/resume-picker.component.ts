import {CommonModule} from '@angular/common';
import {Component, inject, Input, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {HttpStorageAdapter} from '../http-storage.adapter';
import {ApiResumeSummary, ResumesService} from '../resumes.service';

/**
 * The "Scoring against" picker injected into the shared Score screen via
 * `RESUME_PICKER_PANEL` (see shared/resume-picker-panel.token.ts and
 * shared/app.component.html) — desktop only ever has one resume, so this
 * never exists there. Hidden entirely when there is nothing to pick between.
 */
@Component({
  selector: 'app-resume-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resume-picker.component.html',
})
export class ResumePickerComponent implements OnInit {
  /** Set by AppComponent via ngComponentOutletInputs; called after a switch completes. */
  @Input() onSwitched?: () => void;

  readonly resumes = signal<ApiResumeSummary[]>([]);
  readonly activeId = signal<string | null>(null);
  readonly switching = signal(false);

  private resumesService = inject(ResumesService);
  private storage = inject(HttpStorageAdapter);

  ngOnInit(): void {
    this.refresh();
  }

  async refresh(): Promise<void> {
    const list = await this.resumesService.list();
    this.resumes.set(list);
    this.activeId.set(list.find((r) => r.isActive)?.id ?? null);
  }

  async onSelect(id: string): Promise<void> {
    if (!id || id === this.activeId() || this.switching()) return;
    this.switching.set(true);
    try {
      await this.resumesService.setActive(id);
      const full = await this.resumesService.get(id);
      this.storage.setActiveResume(full);
      this.resumes.update((list) => list.map((r) => ({...r, isActive: r.id === id})));
      this.activeId.set(id);
      this.onSwitched?.();
    } finally {
      this.switching.set(false);
    }
  }
}
