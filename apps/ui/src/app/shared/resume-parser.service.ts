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
      const items = content.items.filter((it: any) => 'str' in it);
      pages.push(extractPageText(items));
    }

    await pdf.destroy();
    return {text: pages.join('\n'), arrayBuffer};
  }
}

// Some PDFs (Word/Pages exports, design-tool exports) emit each glyph as a
// separate text item with no spacing metadata. Joining those with a space
// yields "A n t o n" instead of "Anton" and destroys TF-IDF term matching.
// Detect that case per page and concatenate without spaces; otherwise the
// existing space-join preserves word boundaries that pdfjs already provides.
function extractPageText(items: any[]): string {
  const nonEmpty = items.filter(it => it.str && it.str.trim().length > 0);
  if (nonEmpty.length === 0) return '';
  const singleChar = nonEmpty.filter(it => it.str.trim().length === 1).length;
  const glyphMode = singleChar / nonEmpty.length > 0.7;

  if (!glyphMode) {
    return items.map(it => it.str).join(' ');
  }

  let out = '';
  for (const it of items) {
    out += it.str;
    if (it.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]{2,}/g, ' ');
}
