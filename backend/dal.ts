import { store } from './store.js';

export function getResumeText(): string | undefined {
  return store.getResume()?.text;
}

export function getResumeInfo(): { filename: string; uploadedAt: string; chars: number } | undefined {
  const resume = store.getResume();
  if (!resume) return undefined;
  return {
    filename: resume.filename,
    uploadedAt: resume.uploadedAt,
    chars: resume.text.length,
  };
}

export function upsertResume(filename: string, text: string, terms: string[], uploadedAt: string, buffer: Buffer): void {
  store.saveResume(filename, buffer, text, terms, uploadedAt);
}
