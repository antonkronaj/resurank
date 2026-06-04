import {Injectable} from '@angular/core';
export {extractTerms} from '@resurank/scoring';

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
