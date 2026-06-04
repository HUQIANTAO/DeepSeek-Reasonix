import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { Item } from "../lib/useController";
import { AssistantMessage, UserMessage } from "./Message";
import { ToolCard } from "./ToolCard";
import { Welcome } from "./Welcome";

type ToolItem = Extract<Item, { kind: "tool" }>;

function scrollVersion(items: Item[]): string {
  return items
    .map((it) => {
      switch (it.kind) {
        case "assistant":
          return `${it.id}:a:${it.text.length}:${it.reasoning.length}:${it.streaming ? 1 : 0}`;
        case "tool":
          return `${it.id}:t:${it.name}:${it.status}:${it.args.length}:${it.output?.length ?? 0}:${it.error?.length ?? 0}:${it.truncated ? 1 : 0}`;
        default:
          return `${it.id}:${it.kind}`;
      }
    })
    .join("|");
}

export function Transcript({
  items,
  onPrompt,
  onRewind,
}: {
  items: Item[];
  onPrompt: (text: string) => void;
  onRewind?: (turn: number, scope: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // stick tracks whether the view is pinned to the bottom; once the user scrolls
  // up to read, we stop yanking them back down.
  const stick = useRef(true);
  // newWhileAway counts the items appended while the user was scrolled up. The
  // jump-to-bottom button shows this as a small badge; clicking the button
  // scrolls to the bottom and resets both the stick flag and the count.
  const newWhileAway = useRef(0);
  // showJump is the React state mirror of `stick`. We use state (not just the
  // ref) because the button is a render output, and React only re-renders on
  // state transitions. The ref drives the behavior; the state drives the view.
  const [showJump, setShowJump] = useState(false);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    if (near) {
      // The user scrolled back to the bottom — clear the badge. The button's
      // visibility follows the same path; we collapse it here so the user
      // doesn't see "0" lingering as they continue reading from the bottom.
      if (newWhileAway.current > 0) newWhileAway.current = 0;
      if (showJump) setShowJump(false);
    } else {
      if (!showJump) setShowJump(true);
    }
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stick.current = true;
    newWhileAway.current = 0;
    setShowJump(false);
  };

  // Follow new content by setting scrollTop directly (no scrollIntoView fighting
  // the browser's scroll anchoring), and inside rAF so layout has settled first —
  // together with plain-text streaming this keeps the view from jittering. The
  // dependency tracks rendered content, not just array identity, so streaming
  // still follows the bottom if a reducer reuses the items array. When the
  // user is scrolled UP, we don't yank them back; instead we tally the new
  // items into `newWhileAway` so the jump-to-bottom button can show a badge.
  const contentVersion = scrollVersion(items);
  useEffect(() => {
    if (!stick.current) {
      // Count the new content while scrolled away. We don't have item id → new
      // without a diff; for the badge a simple "items grew" counter is enough.
      // The exact value isn't load-bearing (it just signals "stuff happened"),
      // so we cap at 99 to avoid a 5-digit badge on a 1k-item import.
      newWhileAway.current = Math.min(99, newWhileAway.current + 1);
      // Force a re-render so the badge updates. setShowJump(true) is a no-op
      // for visibility (already true) but it does flip React's render queue.
      if (!showJump) setShowJump(true);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [contentVersion, showJump]);

  // Sub-agent calls carry a parentId; collect them under their parent `task`
  // call so the parent card can render them nested, and skip them at top level.
  const subcallsByParent = new Map<string, ToolItem[]>();
  for (const it of items) {
    if (it.kind === "tool" && it.parentId) {
      const arr = subcallsByParent.get(it.parentId) ?? [];
      arr.push(it);
      subcallsByParent.set(it.parentId, arr);
    }
  }

  // The rewind menu's open state is lifted here so at most one is open at a time;
  // a mousedown outside any .rewind closes it.
  const [openTurn, setOpenTurn] = useState<number | null>(null);
  useEffect(() => {
    if (openTurn === null) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || !el.closest(".rewind")) setOpenTurn(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openTurn]);

  // Each user message's turn = its ordinal among user messages, so a rewind
  // targets the matching checkpoint.
  const userTurn = new Map<string, number>();
  let nt = 0;
  for (const it of items) {
    if (it.kind === "user") userTurn.set(it.id, nt++);
  }

  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll}>
      {showJump && (
        <button
          type="button"
          className="transcript__jump"
          onClick={jumpToBottom}
          title="Jump to latest"
          aria-label="Jump to latest message"
        >
          <ArrowDown size={13} />
          {newWhileAway.current > 0 && (
            <span className="transcript__jump-count" aria-hidden="true">
              {newWhileAway.current > 99 ? "99+" : newWhileAway.current}
            </span>
          )}
        </button>
      )}
      {items.length === 0 && <Welcome onPrompt={onPrompt} />}

      {items.map((it) => {
        switch (it.kind) {
          case "user": {
            const tn = userTurn.get(it.id);
            return (
              <UserMessage
                key={it.id}
                text={it.text}
                turn={tn}
                open={tn != null && openTurn === tn}
                onToggle={() => setOpenTurn((cur) => (cur === tn ? null : (tn ?? null)))}
                onRewind={(turn, scope) => {
                  onRewind?.(turn, scope);
                  setOpenTurn(null);
                }}
              />
            );
          }
          case "assistant":
            return <AssistantMessage key={it.id} item={it} />;
          case "tool":
            if (it.parentId) return null; // rendered nested under its parent
            if (it.name === "todo_write") return null; // shown live in the pinned TodoPanel
            if (it.name === "exit_plan_mode") return null; // the plan was shown in the approval card
            return <ToolCard key={it.id} item={it} subcalls={subcallsByParent.get(it.id)} />;
          case "phase":
            return (
              <div key={it.id} className="phase">
                {it.text}
              </div>
            );
          case "notice":
            return (
              <div key={it.id} className={`notice notice--${it.level}`}>
                {it.text}
              </div>
            );
          case "compaction":
            return <CompactionCard key={it.id} item={it} />;
        }
      })}
    </div>
  );
}

type CompactionItem = Extract<Item, { kind: "compaction" }>;

// CompactionCard marks a context-compaction boundary in the transcript. While
// the pass runs it shows a "compacting…" placeholder; once done it shows the
// message count and trigger with the summary collapsed behind a toggle (the
// summary is the new context base, so it's available but doesn't flood the view).
function CompactionCard({ item }: { item: CompactionItem }) {
  const [open, setOpen] = useState(false);
  if (item.pending) {
    return (
      <div className="compaction compaction--pending">
        <span className="compaction__spinner">⋯</span> Compacting conversation…
      </div>
    );
  }
  return (
    <div className="compaction">
      <button className="compaction__head" onClick={() => setOpen((v) => !v)}>
        <span className="compaction__icon">◆</span>
        <span className="compaction__title">Context compacted</span>
        <span className="compaction__meta">
          {item.messages} messages · {item.trigger}
        </span>
        <span className="compaction__toggle">{open ? "hide summary" : "show summary"}</span>
      </button>
      {open && <pre className="compaction__summary">{item.summary}</pre>}
    </div>
  );
}
