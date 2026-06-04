import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';

export async function loadResumeText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return readFile(path, 'utf8');
  }

  if (ext === '.pdf') {
    return loadPdf(path);
  }

  if (ext === '.docx') {
    return loadDocx(path);
  }

  throw new Error(`Unsupported resume file extension: ${ext}. Supported: .pdf, .docx, .txt, .md`);
}

async function loadPdf(path: string): Promise<string> {
  const data = await readFile(path);
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(text);
  }
  await pdf.destroy();
  return pages.join('\n');
}

async function loadDocx(path: string): Promise<string> {
  const mammoth: any = await import('mammoth');
  const result = await mammoth.extractRawText({path});
  return result.value;
}
