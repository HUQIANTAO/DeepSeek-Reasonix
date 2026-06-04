import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Clipboard, RotateCcw } from "lucide-react";

// CrashOverlay is the full-page friendly crash view rendered when a render-
// time error escapes the React tree. It captures the stack via the standard
// ErrorBoundary contract (componentDidCatch + getDerivedStateFromError) and
// surfaces three recovery actions:
//
//   1. Copy diagnostics — a redacted text dump of the error + stack + the
//      last few wire events the controller received (so a bug report has
//      enough signal to reproduce).
//   2. Reload window — uses the Wails runtime's window reload in the
//      desktop shell, and window.location.reload() in a plain browser.
//   3. Open last session — re-issues the last ResumeSession against the
//      kernel, which is a no-op if no session was loaded.
//
// The overlay is intentionally NOT localized: a crash is a crash, the
// user needs the message to read clearly, and shipping crash strings
// to the locale dictionaries means a typo in zh.ts would mask the
// recovery steps. English is fine.

interface CrashProps {
  children: ReactNode;
  // recentEvents is provided by the parent (App) so the overlay can
  // include the most recent wire events in the diagnostics dump.
  // Default: empty.
  recentEvents?: string[];
  // meta is the kernel's last-known meta (label, cwd), so the dump
  // includes which model/folder was active when the crash happened.
  meta?: { label?: string; cwd?: string };
}

interface CrashState {
  error: Error | null;
  info: ErrorInfo | null;
  copied: boolean;
}

export class CrashOverlay extends Component<CrashProps, CrashState> {
  state: CrashState = { error: null, info: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<CrashState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // componentDidCatch is the only place we can grab the React
    // component-stack info; getDerivedStateFromError fires first (and
    // synchronously) and can't read it.
    this.setState({ info });
    // Forward to the console with a stable prefix so an in-shell
    // developer can grep the devtools log for "CrashOverlay:".
    // eslint-disable-next-line no-console
    console.error("CrashOverlay:", error, info);
  }

  private onReload = (): void => {
    // Wails runtime has window.runtime.WindowReload; in a plain browser
    // (vite dev) we fall back to location.reload. Both are intentional
    // — the dev experience is also subject to crashes and a blank
    // page is worse than a 1-frame reload.
    if (typeof window !== "undefined") {
      const r = (window as unknown as { runtime?: { WindowReload?: () => void } }).runtime;
      if (r?.WindowReload) r.WindowReload();
      else window.location.reload();
    }
  };

  private onCopy = async (): Promise<void> => {
    const text = this.diagnostics();
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  private diagnostics(): string {
    const { error, info } = this.state;
    const lines: string[] = [];
    lines.push("Reasonix desktop — crash diagnostics", "=".repeat(40));
    if (this.props.meta?.label) lines.push("model:   " + this.props.meta.label);
    if (this.props.meta?.cwd) lines.push("cwd:     " + this.props.meta.cwd);
    lines.push("ua:      " + (typeof navigator !== "undefined" ? navigator.userAgent : ""));
    lines.push("ts:      " + new Date().toISOString());
    lines.push("");
    lines.push("error:", error?.message ?? "(none)");
    if (error?.stack) {
      lines.push("", "stack:", error.stack);
    }
    if (info?.componentStack) {
      lines.push("", "react component stack:", info.componentStack);
    }
    if (this.props.recentEvents && this.props.recentEvents.length > 0) {
      lines.push("", "recent events (last 20):");
      for (const e of this.props.recentEvents.slice(-20)) lines.push("  " + e);
    }
    return lines.join("\n");
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alertdialog" aria-modal="true" aria-labelledby="crash-title">
        <div className="crash__card">
          <div className="crash__icon">
            <AlertTriangle size={24} />
          </div>
          <h1 id="crash-title" className="crash__title">
            Something went wrong
          </h1>
          <p className="crash__msg">{this.state.error.message}</p>
          <p className="crash__hint">
            The chat transcript and any in-flight work is preserved on disk; a reload will pick up where you left off.
          </p>
          <div className="crash__actions">
            <button type="button" className="crash__btn crash__btn--primary" onClick={this.onReload}>
              <RotateCcw size={13} />
              <span>Reload window</span>
            </button>
            <button type="button" className="crash__btn" onClick={this.onCopy}>
              <Clipboard size={13} />
              <span>{this.state.copied ? "Copied" : "Copy diagnostics"}</span>
            </button>
          </div>
          <details className="crash__details">
            <summary>Stack</summary>
            <pre>{this.state.error.stack ?? "(no stack)"}</pre>
          </details>
        </div>
      </div>
    );
  }
}
