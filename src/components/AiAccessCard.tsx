import { useState } from 'react';
import { Plug, Copy, Check, Info, FileText } from 'lucide-react';
import { useFinanceSettings } from '../context/FinanceContext';
import { Card } from './ui/Card';
import { SectionLabel } from './ui/SectionLabel';

type Provider = 'claudeDesktop' | 'claudeCode' | 'cursor' | 'codex' | 'geminiCli';

const PROVIDERS: Provider[] = ['claudeDesktop', 'claudeCode', 'cursor', 'codex', 'geminiCli'];

// Config snippets are literal, language-neutral code, so they live here as constants
// rather than in the i18n table. Claude Desktop needs an absolute path; the other
// stdio clients read the repo-relative path. Values follow each client's own format
// (JSON with an "mcpServers" object; Codex uses TOML in ~/.codex/config.toml).
const CLAUDE_DESKTOP_CONFIG = `{
  "mcpServers": {
    "headroom": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/headroom/mcp/server.ts"],
      "env": { "HEADROOM_URL": "http://localhost:8080" }
    }
  }
}`;

const REPO_RELATIVE_CONFIG = `{
  "mcpServers": {
    "headroom": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "env": { "HEADROOM_URL": "http://localhost:8080" }
    }
  }
}`;

const CODEX_CONFIG = `[mcp_servers.headroom]
command = "npx"
args = ["tsx", "mcp/server.ts"]

[mcp_servers.headroom.env]
HEADROOM_URL = "http://localhost:8080"`;

const CONFIG_FOR: Record<Provider, string> = {
  claudeDesktop: CLAUDE_DESKTOP_CONFIG,
  claudeCode: REPO_RELATIVE_CONFIG,
  cursor: REPO_RELATIVE_CONFIG,
  codex: CODEX_CONFIG,
  geminiCli: REPO_RELATIVE_CONFIG,
};

export function AiAccessCard() {
  const { t } = useFinanceSettings();
  const s = t.settings.aiAccessSection;
  const [active, setActive] = useState<Provider>('claudeDesktop');

  return (
    <Card padding="lg" className="md:col-span-12" data-tour="settings-ai-access">
      <SectionLabel icon={<Plug />}>{s.title}</SectionLabel>
      <p className="mt-1 mb-4 text-[13px] max-w-3xl" style={{ color: 'var(--text-3)' }}>
        {s.desc}
      </p>

      {/* Prerequisites */}
      <div
        className="flex items-start gap-2 text-[12px] rounded-[8px] p-3 mb-4"
        style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
      >
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>{s.prereq}</span>
      </div>

      {/* Provider tabs */}
      <div
        className="inline-flex p-1 rounded-[8px] border flex-wrap gap-1"
        role="tablist"
        aria-label={s.title}
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border)' }}
      >
        {PROVIDERS.map((p) => {
          const isActive = p === active;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(p)}
              className="flex items-center gap-2 px-4 h-8 rounded-[6px] text-[12px] transition-colors"
              style={
                isActive
                  ? { background: 'var(--text-1)', color: 'var(--bg-page)', fontWeight: 600 }
                  : { background: 'transparent', color: 'var(--text-2)', fontWeight: 500 }
              }
            >
              {s.tabs[p]}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="mt-4">
        <p className="text-[13px]" style={{ color: 'var(--text-2)' }}>
          {s.configLocation[active]}
        </p>
        <ConfigBlock code={CONFIG_FOR[active]} copyLabel={s.copy} copiedLabel={s.copied} />
        {active === 'claudeCode' && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--text-3)' }}>
            {s.claudeCodeShortcut}
          </p>
        )}
      </div>

      {/* Docs pointer — plain text (kept generic; no hardcoded repo URL). */}
      <p className="mt-4 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-3)' }}>
        <FileText size={13} className="shrink-0" />
        {s.docsLink}
      </p>
    </Card>
  );
}

function ConfigBlock({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — leave the block selectable.
    }
  };

  return (
    <div className="relative mt-2">
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 flex items-center gap-1 px-2 h-7 rounded-[6px] text-[11px] border transition-colors"
        style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: copied ? 'var(--positive)' : 'var(--text-2)' }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? copiedLabel : copyLabel}
      </button>
      <pre
        className="rounded-[8px] p-3 pr-20 text-[12px] leading-[1.5] overflow-x-auto border"
        style={{ background: 'var(--surface-3)', borderColor: 'var(--border)', color: 'var(--text-1)' }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
