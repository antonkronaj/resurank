import {Injectable} from '@angular/core';
import {EXTRA_STOPWORDS} from '@shared/stopwords';

export function extractTerms(text: string, userStopwords: Set<string> = new Set()): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-\s]/g, ' ')
    .replace(/\s+/g, ' ');

  const tokens = normalized.split(' ').filter(Boolean);
  return tokens.filter((t) => {
    if (t.length < 2) return false;
    if (EXTRA_STOPWORDS.has(t) || userStopwords.has(t)) return false;
    if (/^\d+$/.test(t)) return false;
    return true;
  });
}

@Injectable({providedIn: 'root'})
export class ResumeParserService {
  async parsePdf(file: File): Promise<{ text: string; arrayBuffer: ArrayBuffer }> {
    const arrayBuffer = await file.arrayBuffer();

    // Dynamically import pdfjs-dist to avoid bundling the worker in the main chunk
    const pdfjsLib = await import('pdfjs-dist');

    // Point the worker to the asset we copy into the build output
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.mjs';

    const loadingTask = pdfjsLib.getDocument({data: arrayBuffer.slice(0)});
    const pdf = await loadingTask.promise;

    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }

    await pdf.destroy();
    return {text: pages.join('\n'), arrayBuffer};
  }
}
