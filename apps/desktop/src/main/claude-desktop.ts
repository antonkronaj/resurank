import {app} from 'electron';
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
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
 * Return true if Claude Desktop appears to be installed on this machine.
 *
 * Checks well-known install locations per platform. Returns true on Linux
 * because Claude Desktop's install path there is not standardised — we
 * can't reliably detect absence, so we default to allowing the connect.
 */
function isClaudeDesktopInstalled(): boolean {
  const h = homedir();
  switch (platform()) {
    case 'darwin':
      return (
        existsSync('/Applications/Claude.app') ||
        existsSync(join(h, 'Applications', 'Claude.app'))
      );
    case 'win32': {
      const localAppData = process.env['LOCALAPPDATA'] ?? join(h, 'AppData', 'Local');
      return existsSync(join(localAppData, 'Programs', 'Claude', 'Claude.exe'));
    }
    default:
      // Linux install path is not standardised; don't block.
      return true;
  }
}

/**
 * Resolve the built mcp-server entry point.
 *
 * In dev / source-checkout mode this is the workspace dist/ directory.
 * In a packaged app we use `npx -y resurank-mcp` instead of a local path,
 * so this function returns null when the app is packaged.
 */
function getMcpServerPath(): string | null {
  if (app.isPackaged) return null;
  const candidate = join(app.getAppPath(), 'packages', 'mcp-server', 'dist', 'index.js');
  return existsSync(candidate) ? resolve(candidate) : null;
}

/**
 * Locate a node executable.
 *
 * Tries PATH first, then falls back to probing well-known install locations.
 * The fallback is important for packaged Electron apps whose process PATH is
 * often stripped to /usr/bin:/bin:/usr/sbin:/sbin on macOS.
 */
function getNodePath(): string | null {
  // 1. Try PATH-based lookup first (works reliably in dev mode).
  const cmd = platform() === 'win32' ? 'where node' : 'command -v node';
  try {
    const out = execSync(cmd, {encoding: 'utf8'}).trim();
    const first = out.split(/\r?\n/)[0].trim();
    if (first) return first;
  } catch { /* fall through to probes */ }

  // 2. Probe well-known install locations (needed when PATH is stripped).
  const h = homedir();
  const plat = platform();

  const fallbacks: string[] =
    plat === 'win32'
      ? [
          join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
          join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
          join(h, '.volta', 'bin', 'node.exe'),
        ]
      : [
          '/usr/local/bin/node',       // npm system installer (Intel Mac / Linux)
          '/opt/homebrew/bin/node',    // Homebrew (Apple Silicon)
          join(h, '.volta', 'bin', 'node'),  // Volta
        ];

  for (const p of fallbacks) {
    if (existsSync(p)) return p;
  }

  // 3. NVM: look for highest version under ~/.nvm/versions/node/
  const nvmDir = process.env['NVM_DIR'] ?? join(h, '.nvm');
  const nvmVersionsDir = join(nvmDir, 'versions', 'node');
  if (existsSync(nvmVersionsDir)) {
    try {
      const versions = readdirSync(nvmVersionsDir).sort().reverse();
      for (const v of versions) {
        const p = plat === 'win32'
          ? join(nvmVersionsDir, v, 'node.exe')
          : join(nvmVersionsDir, v, 'bin', 'node');
        if (existsSync(p)) return p;
      }
    } catch { /* ignore */ }
  }

  return null;
}

interface McpEntry {
  command: string;
  args: string[];
}

/**
 * Return the command + args to use for the MCP server config entry.
 *
 * Dev mode  — runs the locally-built workspace dist directly via node.
 * Packaged  — uses `npx -y resurank-mcp` so the published package is fetched
 *             from npm on first use (then cached). This avoids bundling the
 *             mcp-server and its 250 MB of dependencies inside the app.
 */
function getMcpEntry(nodePath: string, serverPath: string | null): McpEntry {
  if (app.isPackaged) {
    // Derive npx from the node binary's directory; fall back to bare 'npx'
    // (Claude Desktop spawns via shell so bare npx resolves through PATH).
    const nodeDir = dirname(nodePath);
    const npxBin = (plat: string) => plat === 'win32'
      ? join(nodeDir, 'npx.cmd')
      : join(nodeDir, 'npx');
    const npxPath = npxBin(platform());
    const command = existsSync(npxPath) ? npxPath : 'npx';
    return {command, args: ['-y', 'resurank-mcp']};
  }
  if (!serverPath) throw new Error('MCP server dist not found (run npm run build in packages/mcp-server)');
  return {command: nodePath, args: [serverPath]};
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

  if (!isClaudeDesktopInstalled()) {
    warnings.push(
      'Claude Desktop does not appear to be installed. Download it from claude.ai/download, then connect.',
    );
  }
  if (parseError) {
    warnings.push(
      'claude_desktop_config.json exists but is not valid JSON. Connecting will not overwrite it — fix the file manually first.',
    );
  }
  if (!nodePath) {
    warnings.push(
      'Could not find a "node" executable. Install Node.js (v22+) from nodejs.org so Claude Desktop can launch the MCP server.',
    );
  }
  if (!mcpServerPath && !app.isPackaged) {
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
  if (!nodePath || (!app.isPackaged && !mcpServerPath)) {
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

  const {command, args} = getMcpEntry(nodePath, mcpServerPath);
  const desired: McpServerEntry = {
    command,
    args,
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
