#!/usr/bin/env node
import {stat} from 'node:fs/promises';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {EMBEDDING_MODEL, SCORING_VERSION, scoreResumeAgainstJob} from '@resurank/scoring';
import {createTransformersEmbedder} from '@resurank/scoring/node-embedder';
import {loadResumeText} from './resume-loader.js';
import {MCP_VERSION} from './version.js';

const TOOL_NAME = 'resurank_score';
const CRITICAL_GAP_WEIGHT_THRESHOLD = 1.5;
const MIN_RESUME_CHARS = 100;
const PREVIEW_CHARS = 240;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`[resurank-mcp] ${name} env var is required\n`);
    process.exit(1);
  }
  return v;
}

const resumePath = requireEnv('RESUME_PATH');

const embedder = createTransformersEmbedder({
  onProgress: (e) => {
    if (e.status === 'progress' && typeof e.progress === 'number') {
      process.stderr.write(`[resurank-mcp] downloading ${e.file}: ${e.progress.toFixed(1)}%\n`);
    } else if (e.status === 'initiate') {
      process.stderr.write(`[resurank-mcp] download started: ${e.file}\n`);
    } else if (e.status === 'done') {
      process.stderr.write(`[resurank-mcp] download done: ${e.file}\n`);
    }
  },
  onEmbedStart: (count, hits) => {
    process.stderr.write(`[resurank-mcp] embed ${count} text(s) (cache hits: ${hits})\n`);
  },
  onEmbedEnd: (ms) => {
    if (ms > 0) process.stderr.write(`[resurank-mcp] embed done in ${ms}ms\n`);
  },
});

type ResumeSource = 'env' | 'argument_path' | 'inline_text';

interface ResolvedResume {
  source: ResumeSource;
  path?: string;
  mtimeMs?: number;
  modifiedAt?: string;
  text: string;
}

interface FileCacheEntry {
  path: string;
  mtimeMs: number;
  modifiedAt: string;
  text: string;
}

let fileCache: FileCacheEntry | null = null;

async function loadResumeFile(path: string, sourceLabel: ResumeSource): Promise<ResolvedResume> {
  let mtimeMs: number;
  let modifiedAt: string;
  try {
    const s = await stat(path);
    if (!s.isFile()) {
      throw new Error(`${path} is not a regular file`);
    }
    mtimeMs = s.mtimeMs;
    modifiedAt = s.mtime.toISOString();
  } catch (err) {
    throw new Error(
      `Resume file at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}. ` +
      `Check that the file exists and is readable.`,
    );
  }

  if (fileCache && fileCache.path === path && fileCache.mtimeMs === mtimeMs) {
    return {source: sourceLabel, path, mtimeMs, modifiedAt, text: fileCache.text};
  }

  if (fileCache && fileCache.path === path) {
    process.stderr.write(
      `[resurank-mcp] resume file changed (mtime ${new Date(fileCache.mtimeMs).toISOString()} → ${modifiedAt}), reloading\n`,
    );
  } else {
    process.stderr.write(`[resurank-mcp] loading resume from ${path}\n`);
  }

  const text = await loadResumeText(path);
  validateResumeText(text, path);
  fileCache = {path, mtimeMs, modifiedAt, text};
  return {source: sourceLabel, path, mtimeMs, modifiedAt, text};
}

function validateResumeText(text: string, source: string): void {
  const trimmedLen = text.trim().length;
  if (trimmedLen < MIN_RESUME_CHARS) {
    throw new Error(
      `Resume from ${source} parsed to only ${trimmedLen} characters ` +
      `(minimum ${MIN_RESUME_CHARS}). Likely causes: image-only PDF without OCR, ` +
      `wrong path, empty paste, or unsupported format. No scoring was performed.`,
    );
  }
}

async function resolveResume(args: {
  resume_text?: unknown;
  resume_path?: unknown;
}): Promise<ResolvedResume> {
  if (typeof args.resume_text === 'string' && args.resume_text.trim().length > 0) {
    const text = args.resume_text;
    validateResumeText(text, 'inline argument');
    process.stderr.write(`[resurank-mcp] scoring against inline resume_text (${text.length} chars)\n`);
    return {source: 'inline_text', text};
  }
  if (typeof args.resume_path === 'string' && args.resume_path.trim().length > 0) {
    return loadResumeFile(args.resume_path, 'argument_path');
  }
  return loadResumeFile(resumePath, 'env');
}

function buildResumePreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= PREVIEW_CHARS) return collapsed;
  return collapsed.slice(0, PREVIEW_CHARS).trimEnd() + '…';
}

function buildResumeNote(source: ResumeSource): string {
  switch (source) {
    case 'inline_text':
      return (
        'This resume came from the resume_text argument (raw text passed inline). ' +
        'No file was read for this score. The default RESUME_PATH was bypassed.'
      );
    case 'argument_path':
      return (
        'This resume came from the resume_path argument (a path override). The ' +
        'default RESUME_PATH was bypassed. The file is reloaded automatically on ' +
        'subsequent calls if its mtime changes.'
      );
    case 'env':
    default:
      return (
        'This resume was loaded server-side from the RESUME_PATH environment ' +
        'variable (the default). The file is automatically reloaded on every score ' +
        'call if its mtime has changed, so the user can edit and re-score without ' +
        'restarting. To try an alternative resume without editing this file, call ' +
        'the tool again with resume_path or resume_text.'
      );
  }
}

const PROMPT_NAME = 'score-resume';

const server = new Server(
  {name: 'resurank', version: MCP_VERSION},
  {capabilities: {tools: {}, prompts: {}}},
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: TOOL_NAME,
      description:
        'Scores a resume against a job description using a hybrid semantic + keyword ' +
        'model. Use this tool whenever the user wants to compare/score/evaluate/check ' +
        'their resume against a job posting — common phrasings include "score this ' +
        'job", "how good a match am I", "rank this posting", "score my resume".\n\n' +
        'The resume is loaded by the server. By default it comes from the local ' +
        'file path configured via the RESUME_PATH environment variable. The user ' +
        'can also iterate on alternative resumes by either:\n' +
        '  • passing resume_path (a different local file path) — for scoring a ' +
        '    stored variant like resume_v2.pdf, or\n' +
        '  • passing resume_text (raw text pasted in chat) — for scoring an ad-hoc ' +
        '    tweak without saving a file.\n' +
        'Use these overrides whenever the user signals they want to try a different ' +
        'version. Do NOT ask the user to update RESUME_PATH or restart Claude. The ' +
        '"resume" field in the response confirms which source was actually scored.\n\n' +
        'REQUIRED USER INPUTS — ASK FIRST IF MISSING:\n' +
        '  1. job_description: the full body of the posting. If the user has not ' +
        '     pasted a JD, ask them to paste it before calling.\n' +
        '  2. job_title: the role title as the user states it. The title is weighted ' +
        '     2x in keyword scoring, so an inaccurate title meaningfully skews the ' +
        '     result. If the user has not explicitly provided a title, ASK THEM for ' +
        '     it — do NOT infer or extract the title from the job description text.\n\n' +
        'CRITICAL — HOW TO REPORT RESULTS TO THE USER:\n' +
        '  • The response includes a "summary_for_user" string. Paraphrase that ' +
        '    summary when reporting to the user; do not re-derive matched/missing ' +
        '    from the arrays yourself.\n' +
        '  • Trust matched_keywords, missing_keywords, and critical_gaps verbatim. ' +
        '    They reflect the actual contents of the resume file.\n' +
        '  • You MUST NOT claim a keyword is missing if it appears in ' +
        '    matched_keywords. Cross-check the arrays before describing gaps.\n' +
        '  • Do not infer the presence or absence of skills beyond what these ' +
        '    arrays report.',
      inputSchema: {
        type: 'object',
        properties: {
          job_description: {
            type: 'string',
            description:
              'Full text of the job posting (the body, not the title). Must come ' +
              'from the user — if they have not pasted a JD, ask them to paste it ' +
              'before calling this tool.',
          },
          job_title: {
            type: 'string',
            description:
              'The job title as stated by the USER, not as inferred from the job ' +
              'description body. If the user has not explicitly provided a title, ' +
              'do not call this tool — first ask them what the role is called. ' +
              'A wrong or invented title skews the score because the title is ' +
              'weighted 2x in keyword scoring.',
          },
          resume_path: {
            type: 'string',
            description:
              'OPTIONAL. Absolute local file path to a resume variant (.pdf, ' +
              '.docx, .txt, .md) to use INSTEAD OF the RESUME_PATH default. Use ' +
              'this when the user wants to score a stored variant — e.g. "score ' +
              'my resume_v2.pdf against this", or "use the senior-engineer.pdf ' +
              'one". Mutually exclusive with resume_text; if both are passed, ' +
              'resume_text wins. Omit for the default resume.',
          },
          resume_text: {
            type: 'string',
            description:
              'OPTIONAL. Raw resume text to score INSTEAD OF any file. Use this ' +
              'when the user pastes a resume (or an edited version) inline in ' +
              'chat and wants to score that exact text without saving a file. ' +
              'Bypasses the file system entirely. If the user is iterating on ' +
              'wording in the conversation, prefer this over asking them to save ' +
              'a file. Mutually exclusive with resume_path; if both are passed, ' +
              'resume_text wins. Omit for the default resume.',
          },
        },
        required: ['job_description', 'job_title'],
      },
    },
  ],
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: PROMPT_NAME,
      description:
        'Start a resume-scoring session. Prompts Claude to ask you for a job title ' +
        'and job description, then scores your resume against them using the ' +
        'resurank_score tool. Use this to kick off the tool in a fresh conversation.',
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== PROMPT_NAME) {
    throw new Error(`Unknown prompt: ${request.params.name}`);
  }
  return {
    description: 'Score your resume against a job posting',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            "I'd like to score my resume against a job posting. Please use the " +
            'resurank_score tool. Ask me for the job title and the full job ' +
            'description (paste it in) if I haven\'t provided them yet, then ' +
            'run the score and explain the results.',
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL_NAME) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = (request.params.arguments ?? {}) as {
    job_description?: unknown;
    job_title?: unknown;
    resume_path?: unknown;
    resume_text?: unknown;
  };
  const jobDescription = typeof args.job_description === 'string' ? args.job_description : '';
  const jobTitle = typeof args.job_title === 'string' ? args.job_title : '';
  if (!jobDescription || !jobTitle) {
    throw new Error('Both job_description and job_title are required (non-empty strings)');
  }

  const resume = await resolveResume(args);
  const result = await scoreResumeAgainstJob(
    resume.text,
    {title: jobTitle, description: jobDescription},
    embedder,
  );

  const matched = new Set(result.matchedTerms);
  const topJobTerms = result.jobWeighted;
  const missing = topJobTerms.filter(t => !matched.has(t.term));
  const criticalGaps = missing
    .filter(t => t.weight >= CRITICAL_GAP_WEIGHT_THRESHOLD)
    .map(t => t.term);

  const score100 = Math.round(result.score * 100 * 10) / 10;
  const missingTerms = missing.map(t => t.term);
  const summaryForUser = buildSummary(
    score100,
    result.matchedTerms,
    missingTerms,
    criticalGaps,
    result.breakdown.embeddingScore,
    result.breakdown.tfidfScore,
  );

  const output = {
    assistant_instructions:
      'When reporting this result to the user: (1) Paraphrase summary_for_user ' +
      'rather than re-deriving from the arrays. (2) The matched_keywords list ' +
      'is authoritative — do NOT describe any term in it as missing. (3) The ' +
      'resume field confirms what was scored (source = "env" | "argument_path" ' +
      '| "inline_text"); do not claim the resume was empty or not provided. ' +
      '(4) If the user is comparing variants, mention which variant this score ' +
      'corresponds to (the path or "inline pasted version") so they can keep ' +
      'iterations straight. (5) Do not volunteer scored_with; it is provenance ' +
      'for reproducibility. Cite it only if the user asks what model was used, ' +
      'or to explain why a score differs from an earlier one whose scored_with ' +
      'was different.',
    resume: {
      source: resume.source,
      path: resume.path ?? null,
      chars: resume.text.length,
      modified_at: resume.modifiedAt ?? null,
      preview: buildResumePreview(resume.text),
      note: buildResumeNote(resume.source),
    },
    score: score100,
    summary_for_user: summaryForUser,
    matched_keywords: result.matchedTerms,
    missing_keywords: missingTerms,
    critical_gaps: criticalGaps,
    score_breakdown: {
      semantic_score: round(result.breakdown.embeddingScore),
      keyword_score: round(result.breakdown.tfidfScore),
      combined_score: round(result.score),
      overlap_bonus: round(result.breakdown.overlapBonus),
      divergence_penalty: round(result.breakdown.divergencePenalty),
    },
    // How this score was produced. Scores are only comparable across runs when
    // all three match, so they travel with the result rather than being
    // reconstructed from whatever happens to be installed later.
    scored_with: {
      embedding_model: embedder.modelId,
      embedding_dtype: EMBEDDING_MODEL.dtype,
      scoring_version: SCORING_VERSION,
    },
    language_warning: result.languageWarning,
  };

  return {
    content: [{type: 'text', text: JSON.stringify(output, null, 2)}],
  };
});

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function buildSummary(
  score: number,
  matched: string[],
  missing: string[],
  criticalGaps: string[],
  semantic: number,
  keyword: number,
): string {
  const matchedList = matched.length > 0 ? matched.join(', ') : '(none)';
  const gapsList = criticalGaps.length > 0
    ? criticalGaps.slice(0, 10).join(', ')
    : '(none flagged as critical)';

  const semanticVerdict =
    semantic >= 0.8 ? 'very strong'
    : semantic >= 0.65 ? 'strong'
    : semantic >= 0.5 ? 'moderate'
    : 'weak';

  const lines = [
    `Score: ${score} / 100.`,
    `Semantic fit: ${semanticVerdict} (${(semantic * 100).toFixed(0)}%).`,
    `Keyword overlap: ${(keyword * 100).toFixed(0)}%.`,
    `Matched keywords from this JD that appear in the resume: ${matchedList}.`,
    `Highest-weight keywords from the JD that do NOT appear in the resume: ${gapsList}.`,
    `(${missing.length} total missing keywords; only the high-weight ones are listed above.)`,
  ];
  return lines.join(' ');
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[resurank-mcp] stdio server ready\n');
  process.stderr.write(
    `[resurank-mcp] scoring ${SCORING_VERSION}, embedding model ${embedder.modelId} (${EMBEDDING_MODEL.dtype})\n`,
  );
  embedder.warmup().catch(err => {
    process.stderr.write(`[resurank-mcp] warmup failed: ${err}\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`[resurank-mcp] fatal: ${err}\n`);
  process.exit(1);
});
