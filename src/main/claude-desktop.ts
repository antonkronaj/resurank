import {app} from 'electron';
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {homedir, platform} from 'node:os';
import {dirname, join, resolve} from 'node:path';

/**
 * Manages a single MCP server entry ("resurank") in the user's
 * claude_desktop_config.json. Designed to be safe against:
 *   - missing config file (creates it)
 *   - other servers already registered (preserves them)
 *   - malformed JSON (refuses to overwrite, surfaces error)
 *   - concurrent reads (writes atomically via write-then-rename)
 */

const SERVER_KEY = 'resurank';
const RESUME_EXPORT_FILENAME = 'resume-for-mcp.txt';

export interface ClaudeDesktopStatus {
  configPath: string;
  configExists: boolean;
  connected: boolean;
  resumePath: string | null;
  resumeExists: boolean;
  nodePath: string | null;
  mcpServerPath: string | null;
  /** Non-fatal warnings the UI can show (e.g. "node not found, install node.js"). */
  warnings: string[];
  /** Path-traversal-safe relative path of the resume file inside userData, for display. */
  resumeFilenameForDisplay: string;
}

export interface ConnectResult {
  ok: boolean;
  status: ClaudeDesktopStatus;
  /** True when the config was written; false when it was already up-to-date. */
  wrote: boolean;
}

function getConfigPath(): string {
  switch (platform()) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32': {
      const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
      return join(appData, 'Claude', 'claude_desktop_config.json');
    }
    default:
      // Linux / others
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Claude', 'claude_desktop_config.json');
  }
}

function getResumeExportPath(): string {
  return join(app.getPath('userData'), RESUME_EXPORT_FILENAME);
}

/**
 * Resolve the built mcp-server entry point. In dev/source-checkout this is
 * the workspace dist/. In a packaged app it must be unpacked under
 * resources/app.asar.unpacked or sibling resources/ to be runnable by an
 * external node process. We probe both.
 */
function getMcpServerPath(): string | null {
  const candidates = [
    // Dev / source checkout
    join(app.getAppPath(), 'packages', 'mcp-server', 'dist', 'index.js'),
    // Sibling to the asar (electron-forge's `extraResource` default landing)
    join(process.resourcesPath ?? '', 'resurank-mcp', 'dist', 'index.js'),
    join(process.resourcesPath ?? '', 'packages', 'mcp-server', 'dist', 'index.js'),
    // Unpacked from asar
    join(app.getAppPath() + '.unpacked', 'packages', 'mcp-server', 'dist', 'index.js'),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return resolve(c);
  }
  return null;
}

/** Locate a node executable the user has on PATH. */
function getNodePath(): string | null {
  const cmd = platform() === 'win32' ? 'where node' : 'command -v node';
  try {
    const out = execSync(cmd, {encoding: 'utf8'}).trim();
    if (!out) return null;
    // `where` on Windows can return multiple paths; take the first.
    const first = out.split(/\r?\n/)[0].trim();
    return first.length > 0 ? first : null;
  } catch {
    return null;
  }
}

interface ClaudeConfig {
  mcpServers?: Record<string, McpServerEntry | undefined>;
  [k: string]: unknown;
}

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function readConfig(path: string): {config: ClaudeConfig; parseError: boolean} {
  if (!existsSync(path)) return {config: {}, parseError: false};
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.trim().length === 0) return {config: {}, parseError: false};
    return {config: JSON.parse(raw) as ClaudeConfig, parseError: false};
  } catch {
    return {config: {}, parseError: true};
  }
}

function writeConfigAtomic(path: string, config: ClaudeConfig): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  // Best-effort atomic replace.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    fs.renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }
}

/**
 * Write the current resume text to a managed file so the MCP server can read
 * it via RESUME_PATH. ResuRank stores resume text in resume.json; the MCP
 * server reads plain text by extension. This bridges the two.
 */
export function syncResumeFile(resumeText: string): string {
  const target = getResumeExportPath();
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (existing !== resumeText) {
    const dir = dirname(target);
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    writeFileSync(target, resumeText, 'utf8');
  }
  return target;
}

export function getStatus(): ClaudeDesktopStatus {
  const configPath = getConfigPath();
  const {config, parseError} = readConfig(configPath);
  const entry = config.mcpServers?.[SERVER_KEY];
  const nodePath = getNodePath();
  const mcpServerPath = getMcpServerPath();
  const resumePath = entry?.env?.RESUME_PATH ?? null;
  const warnings: string[] = [];

  if (parseError) {
    warnings.push(
      'claude_desktop_config.json exists but is not valid JSON. Connecting will not overwrite it — fix the file manually first.',
    );
  }
  if (!nodePath) {
    warnings.push(
      'Could not find a "node" executable on PATH. Install Node.js (v22+) so Claude Desktop can launch the MCP server.',
    );
  }
  if (!mcpServerPath) {
    warnings.push(
      'Could not locate the resurank-mcp build. Run `npm run build` inside packages/mcp-server.',
    );
  }

  const exportPath = getResumeExportPath();

  return {
    configPath,
    configExists: existsSync(configPath),
    connected: Boolean(entry),
    resumePath,
    resumeExists: resumePath ? existsSync(resumePath) : false,
    nodePath,
    mcpServerPath,
    warnings,
    resumeFilenameForDisplay: exportPath,
  };
}

export interface ConnectOptions {
  resumeText: string | null;
}

export function connect(options: ConnectOptions): ConnectResult {
  const configPath = getConfigPath();
  const {config, parseError} = readConfig(configPath);
  if (parseError) {
    return {ok: false, wrote: false, status: getStatus()};
  }

  const nodePath = getNodePath();
  const mcpServerPath = getMcpServerPath();
  if (!nodePath || !mcpServerPath) {
    return {ok: false, wrote: false, status: getStatus()};
  }

  // Write the resume text into a known file so RESUME_PATH always points at
  // something current. If there is no resume yet, still create an empty
  // placeholder so the user sees the connection register; the MCP server's
  // min-chars guard will return a clear error when scored against.
  const resumePath = options.resumeText !== null
    ? syncResumeFile(options.resumeText)
    : getResumeExportPath();
  if (options.resumeText === null && !existsSync(resumePath)) {
    writeFileSync(resumePath, '', 'utf8');
  }

  const desired: McpServerEntry = {
    command: nodePath,
    args: [mcpServerPath],
    env: {RESUME_PATH: resumePath},
  };

  const existing = config.mcpServers?.[SERVER_KEY];
  const sameCommand = existing?.command === desired.command;
  const sameArgs = JSON.stringify(existing?.args ?? []) === JSON.stringify(desired.args);
  const sameEnv = JSON.stringify(existing?.env ?? {}) === JSON.stringify(desired.env);
  const upToDate = sameCommand && sameArgs && sameEnv;

  if (upToDate) {
    return {ok: true, wrote: false, status: getStatus()};
  }

  config.mcpServers = {...(config.mcpServers ?? {}), [SERVER_KEY]: desired};
  writeConfigAtomic(configPath, config);

  return {ok: true, wrote: true, status: getStatus()};
}

export function disconnect(): ConnectResult {
  const configPath = getConfigPath();
  const {config, parseError} = readConfig(configPath);
  if (parseError) return {ok: false, wrote: false, status: getStatus()};

  if (!config.mcpServers || !(SERVER_KEY in config.mcpServers)) {
    return {ok: true, wrote: false, status: getStatus()};
  }

  const {[SERVER_KEY]: _removed, ...rest} = config.mcpServers;
  config.mcpServers = rest;
  writeConfigAtomic(configPath, config);

  return {ok: true, wrote: true, status: getStatus()};
}

/** Confirm whether RESUME_PATH on disk still matches the in-app resume. */
export function isResumeStale(currentResumeText: string): boolean {
  const path = getResumeExportPath();
  if (!existsSync(path)) return true;
  try {
    const stat = statSync(path);
    if (stat.size !== Buffer.byteLength(currentResumeText, 'utf8')) return true;
    return readFileSync(path, 'utf8') !== currentResumeText;
  } catch {
    return true;
  }
}
