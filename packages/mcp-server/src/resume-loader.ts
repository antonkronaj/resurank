import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {extname} from 'node:path';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);

// Resolve the bundled pdf.js worker once at module load. pdfjs-dist requires
// GlobalWorkerOptions.workerSrc to be set before getDocument() can be called,
// even in Node. The legacy/build/pdf.worker.mjs file ships in the package.
let pdfWorkerSrc: string | null = null;
function resolvePdfWorkerSrc(): string {
  if (pdfWorkerSrc) return pdfWorkerSrc;
  const resolved = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfWorkerSrc = pathToFileURL(resolved).href;
  return pdfWorkerSrc;
}

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

  // pdfjs writes warnings/infos to console.log, which goes to stdout in Node
  // — and stdout is reserved for the MCP JSON-RPC frame. Anything else there
  // corrupts the protocol. We must set verbosity = 0.
  // We use GlobalWorkerOptions.verbosity because the top-level pdfjs object
  // might be frozen in some builds.
  pdfjs.GlobalWorkerOptions.verbosity = 0;

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
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
