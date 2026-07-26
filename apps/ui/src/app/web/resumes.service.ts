import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {firstValueFrom} from 'rxjs';

/** Mirrors apps/web/src/lib/domain.ts ApiResumeSummary. */
export interface ApiResumeSummary {
  id: string;
  filename: string;
  uploadedAt: string;
  isActive: boolean;
  chars: number;
  termCount: number;
}

/** Mirrors apps/web/src/lib/domain.ts ApiResume. */
export interface ApiResume extends Omit<ApiResumeSummary, 'chars' | 'termCount'> {
  text: string;
  terms: string[];
}

/**
 * Wraps the multi-resume slice of /api/resumes that has no desktop
 * equivalent and therefore lives outside `StorageAdapter` (single-resume by
 * design — see storage/storage-adapter.ts). Uploading a *new* resume still
 * goes through the shared `ApiService.uploadResume()` — parsing stays
 * client-side and POST /api/resumes already auto-activates, matching what
 * "Add resume" needs.
 */
@Injectable({providedIn: 'root'})
export class ResumesService {
  constructor(private http: HttpClient) {}

  async list(): Promise<ApiResumeSummary[]> {
    const res = await firstValueFrom(this.http.get<{resumes: ApiResumeSummary[]}>('/api/resumes'));
    return res.resumes;
  }

  async get(id: string): Promise<ApiResume> {
    const res = await firstValueFrom(this.http.get<{resume: ApiResume}>(`/api/resumes/${id}`));
    return res.resume;
  }

  async setActive(id: string): Promise<void> {
    await firstValueFrom(this.http.put(`/api/resumes/${id}/active`, {}));
  }

  /** Returns the id the server promoted to active, if deleting the active one. */
  async delete(id: string): Promise<{activeResumeId: string | null}> {
    return firstValueFrom(
      this.http.delete<{ok: boolean; activeResumeId: string | null}>(`/api/resumes/${id}`),
    );
  }
}
