"use client";

import { useState } from "react";
import {
  has,
  LoadState,
  Mutation,
  Shell,
  useAdmin,
  useData,
  withCursor,
} from "../../admin-ui";

type Tree = {
  format: "octoport_prompt_tree_v1";
  root: string | null;
  nodes: { id: string; text: string; children: string[] }[];
};
type State = {
  target: string;
  draftRevision: number;
  draft: Tree;
  templateRevision: number | null;
  publishedVersion: number;
  history: {
    version: number;
    sha256: string;
    author: string;
    publishedAt: string;
    sourceVersion: number | null;
  }[];
};
type Adapter = { id: string; displayName: string };

function Editor({
  state,
  reload,
}: {
  state: State;
  reload: () => Promise<void>;
}) {
  const { me } = useAdmin();
  const writable = has(me, "ai.registry.manage");
  const [draft, setDraft] = useState<Tree>(() => structuredClone(state.draft));
  const [selected, setSelected] = useState(state.draft.root);
  const [rollback, setRollback] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.draft);
  const selectedNode = draft.nodes.find((n) => n.id === selected);
  const base = `/v1/admin/ai/prompt-trees/${encodeURIComponent(state.target)}`;
  const revisions = {
    expectedDraftRevision: state.draftRevision,
    expectedPublishedVersion: state.publishedVersion,
  };
  const update = (perform: (next: Tree) => void) =>
    setDraft((current) => {
      const next = structuredClone(current);
      perform(next);
      return next;
    });
  const add = () => {
    if (!writable || draft.nodes.length >= 128) return;
    const id = `node-${crypto.randomUUID()}`;
    update((next) => {
      if (next.root === null) next.root = id;
      else next.nodes.find((n) => n.id === selected)!.children.push(id);
      next.nodes.push({ id, text: "", children: [] });
    });
    setSelected(id);
  };
  const remove = () => {
    if (!writable || !selected) return;
    const removed = new Set<string>();
    const visit = (id: string) => {
      removed.add(id);
      draft.nodes.find((n) => n.id === id)?.children.forEach(visit);
    };
    visit(selected);
    update((next) => {
      next.nodes = next.nodes
        .filter((n) => !removed.has(n.id))
        .map((n) => ({
          ...n,
          children: n.children.filter((id) => !removed.has(id)),
        }));
      if (next.root && removed.has(next.root)) next.root = null;
    });
    setSelected(selected === draft.root ? null : draft.root);
  };
  const branch = (id: string) => {
    const node = draft.nodes.find((n) => n.id === id)!;
    return (
      <li key={id}>
        <button
          type="button"
          aria-pressed={id === selected}
          onClick={() => setSelected(id)}
        >
          {node.text.trim().slice(0, 80) || "Empty prompt"}
        </button>
        {node.children.length > 0 && <ul>{node.children.map(branch)}</ul>}
      </li>
    );
  };
  return (
    <section className="card">
      <p>
        Draft {state.draftRevision}. Published version:{" "}
        {state.publishedVersion || "none"}.
      </p>
      {state.target === "template" && (
        <p>
          This template is copied only when a new AI is created. Publishing it
          does not change existing AI trees.
        </p>
      )}
      <div className="panel">
        <ul>{draft.root && branch(draft.root)}</ul>
        {!draft.root && <p>No prompt content has been entered.</p>}
        {writable && (
          <button
            type="button"
            disabled={
              draft.nodes.length >= 128 ||
              (draft.root !== null && !selectedNode)
            }
            onClick={add}
          >
            {draft.root ? "Add child prompt" : "Add first prompt"}
          </button>
        )}
      </div>
      {selectedNode && (
        <label>
          Prompt text
          <textarea
            value={selectedNode.text}
            maxLength={8192}
            disabled={!writable}
            onChange={(e) =>
              update((next) => {
                next.nodes.find((n) => n.id === selected)!.text =
                  e.target.value;
              })
            }
          />
        </label>
      )}
      {selectedNode && writable && (
        <button type="button" onClick={remove}>
          Remove selected branch from draft
        </button>
      )}
      {dirty && <p>Unsaved changes. Save this draft before publishing.</p>}
      <Mutation
        permission="ai.registry.manage"
        action="Save draft"
        path={`${base}/draft`}
        body={{ expectedDraftRevision: state.draftRevision, body: draft }}
        disabled={!dirty}
        confirm="Save this AI's draft without publishing it?"
        onDone={reload}
      />
      <Mutation
        permission="ai.registry.manage"
        action="Publish tree"
        path={`${base}/publish`}
        body={revisions}
        disabled={dirty || !draft.root}
        confirm="Publish the saved draft for this selected AI? Existing exchanges retain their pinned version."
        onDone={reload}
      />
      <h2>Published history</h2>
      <p>
        Published versions are retained. Restoring an earlier version creates a
        new publication.
      </p>
      <label>
        Version to restore
        <select
          value={rollback}
          onChange={(e) => setRollback(Number(e.target.value))}
        >
          <option value={0}>Choose a version</option>
          {state.history.map((item) => (
            <option key={item.version} value={item.version}>
              Version {item.version} — {item.publishedAt}
            </option>
          ))}
        </select>
      </label>
      <Mutation
        permission="ai.registry.manage"
        action="Restore as a new version"
        path={`${base}/rollback`}
        body={{ ...revisions, sourceVersion: rollback }}
        disabled={!rollback || dirty}
        confirm="Publish the selected earlier content as a new version and replace this draft?"
        onDone={reload}
      />
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Published</th>
            <th>Author</th>
            <th>SHA-256</th>
          </tr>
        </thead>
        <tbody>
          {state.history.map((item) => (
            <tr key={item.version}>
              <td>{item.version}</td>
              <td>{item.publishedAt}</td>
              <td>{item.author}</td>
              <td>{item.sha256}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function PromptTreesPage() {
  const { me } = useAdmin();
  const readable = has(me, "ai.registry.read");
  const [target, setTarget] = useState("");
  const [cursor, setCursor] = useState("");
  const adapters = useData<{ items: Adapter[]; nextCursor: string | null }>(
    readable ? withCursor("/v1/admin/ai/registry/adapters", cursor) : null,
  );
  const tree = useData<State>(
    readable && target
      ? `/v1/admin/ai/prompt-trees/${encodeURIComponent(target)}`
      : null,
  );
  return (
    <Shell title="AI prompt trees">
      {!readable ? (
        <p>AI registry read permission is required.</p>
      ) : (
        <>
          <p>
            Each AI has its own prompt tree. Editing prompts does not change
            access permissions or page interaction profiles.
          </p>
          <label>
            AI
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose an AI</option>
              <option value="template">Template for new AIs</option>
              {adapters.data?.items.map((ai) => (
                <option key={ai.id} value={ai.id}>
                  {ai.displayName}
                </option>
              ))}
            </select>
          </label>
          {cursor && (
            <button
              type="button"
              onClick={() => {
                setTarget("");
                setCursor("");
              }}
            >
              First AI page
            </button>
          )}
          {adapters.data?.nextCursor && (
            <button
              type="button"
              onClick={() => {
                setTarget("");
                setCursor(adapters.data!.nextCursor!);
              }}
            >
              More AIs
            </button>
          )}
          <LoadState
            busy={adapters.busy || tree.busy}
            error={adapters.error || tree.error}
          />
          {tree.data && (
            <Editor
              key={`${target}:${tree.data.draftRevision}:${tree.data.publishedVersion}`}
              state={tree.data}
              reload={tree.load}
            />
          )}
        </>
      )}
    </Shell>
  );
}
