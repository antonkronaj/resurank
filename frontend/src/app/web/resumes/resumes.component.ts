import {CommonModule} from '@angular/common';
import {Component, inject, OnInit, signal} from '@angular/core';
import {ApiService} from '../../shared/api.service';
import {ApiResumeSummary, ResumesService} from '../resumes.service';

/**
 * The Resumes screen (web-only — desktop only ever has one resume). Upload
 * reuses the shared `ApiService.uploadResume()` unchanged: parsing stays
 * client-side and `POST /api/resumes` already auto-activates the new resume,
 * which is exactly "Add resume" needs. Everything else (list, make-active,
 * delete) is new, multi-resume-only surface with no desktop equivalent, so
 * it talks to `ResumesService` instead of going through `StorageAdapter`.
 *
 * No rename: the mockup shows a ✎ button, but there is no
 * `PATCH /api/resumes/:id` on the server to back it — omitted rather than
 * adding server surface not asked for in this phase.
 */
@Component({
  selector: 'app-resumes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resumes.component.html',
})
export class ResumesComponent implements OnInit {
  readonly resumes = signal<ApiResumeSummary[]>([]);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly confirmingDeleteId = signal<string | null>(null);
  readonly error = signal('');

  private resumesService = inject(ResumesService);
  private api = inject(ApiService);

  ngOnInit(): void {
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      this.resumes.set(await this.resumesService.list());
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.upload(file);
    (event.target as HTMLInputElement).value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) this.upload(file);
  }

  private upload(file: File): void {
    this.uploading.set(true);
    this.error.set('');
    this.api.uploadResume(file).subscribe({
      next: () => {
        this.uploading.set(false);
        this.refresh();
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  async makeActive(id: string): Promise<void> {
    this.confirmingDeleteId.set(null);
    try {
      await this.resumesService.setActive(id);
      this.resumes.update((list) => list.map((r) => ({...r, isActive: r.id === id})));
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    }
  }

  requestDelete(id: string): void {
    this.confirmingDeleteId.set(this.confirmingDeleteId() === id ? null : id);
  }

  async confirmDelete(id: string): Promise<void> {
    try {
      await this.resumesService.delete(id);
      this.confirmingDeleteId.set(null);
      await this.refresh();
    } catch (err: unknown) {
      this.error.set(errorMessage(err));
    }
  }
}

function errorMessage(err: unknown): string {
  const httpErr = err as {error?: {message?: string}; message?: string} | undefined;
  return httpErr?.error?.message ?? httpErr?.message ?? 'Something went wrong.';
}
