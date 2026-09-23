"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  Cursor,
  has,
  LoadState,
  Mutation,
  Shell,
  Table,
  useAdmin,
  useData,
  withCursor,
} from "./admin-ui";

type Page<T> = { items: T[]; nextCursor: string | null };
type Status = "ACTIVE" | "DISABLED" | "ARCHIVED";
type Adapter = {
  id: string;
  machineKey: string;
  displayName: string;
  description: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
};
type Surface = {
  id: string;
  adapterId: string;
  machineKey: string;
  displayName: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
};
type Variant = {
  id: string;
  surfaceId: string;
  machineKey: string;
  displayName: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
};
type Profile = {
  id: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  machineKey: string;
  displayName: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
};
type Primitive =
  | {
      kind: "packaged_selector_reference";
      reference: Reference;
    }
  | {
      kind: "accessibility_role_name";
      role: Role;
      reference: Reference;
    };
type SelectorPlan = {
  strategy: Strategy;
  primary: Primitive;
  fallbacks: Primitive[];
  timeoutMs: number;
  observationMode: ObservationMode;
};
type ProfileContent = {
  schemaVersion: "adapter_profile_v1";
  page: {
    identityStrategy: "page_identity";
    conversationStrategy: "conversation_root";
    composerStrategy: "composer_root";
  };
  selectors: {
    conversation: SelectorPlan;
    composer: SelectorPlan;
    send: SelectorPlan;
    assistantResponse: SelectorPlan;
  };
  observation: { mode: ObservationMode; intervalMs: number };
  contours: {
    key: Contour;
    required: boolean;
    expectedState: ExpectedState;
    strategy: Strategy;
  }[];
};
type Compatibility = {
  schemaVersion: "profile_compatibility_v1";
  contractVersion: "control_plane_v1";
  browserFamilies: BrowserFamily[];
  minimumBrowserVersions: {
    browserFamily: BrowserFamily;
    minimumVersion: string;
  }[];
  minimumExtensionVersion: string | null;
};
type Revision = {
  id: string;
  profileId: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  revision: number;
  schemaVersion: "adapter_profile_v1";
  state: "DRAFT" | "CANDIDATE" | "PUBLISHED" | "RETIRED";
  content: ProfileContent;
  compatibility: Compatibility;
  contentSha256: string;
  createdAt: string;
  publishedAt: string | null;
};
type Assignment = {
  id: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  browserFamily: BrowserFamily;
  subjectKind: "ACCOUNT" | "DEVICE";
  createdAt: string;
  latest: {
    revision: number;
    mode: "DIRECT" | "ROLLOUT" | "PAUSED";
    baselineProfileRevisionId: string;
    candidateProfileRevisionId: string | null;
    percentageBps: number;
    createdAt: string;
  } | null;
};
type AssignmentRevision = {
  id: string;
  assignmentId: string;
  revision: number;
  mode: "DIRECT" | "ROLLOUT" | "PAUSED";
  baselineProfileRevisionId: string;
  candidateProfileRevisionId: string | null;
  percentageBps: number;
  createdAt: string;
};
type BrowserFamily =
  | "chrome"
  | "opera"
  | "yandex_chromium"
  | "firefox"
  | "safari";
type Reference =
  | "page-root"
  | "conversation-root"
  | "composer-root"
  | "send-control"
  | "assistant-response"
  | "busy-control"
  | "copy-control";
type Role = "main" | "article" | "textbox" | "button" | "status";
type Strategy =
  | "page_identity"
  | "conversation_root"
  | "composer_root"
  | "send_control"
  | "assistant_response"
  | "busy_state"
  | "copy_control";
type ObservationMode = "mutation_observer" | "polling";
type Contour =
  | "page_identity"
  | "conversation_root"
  | "composer_root"
  | "send_control"
  | "busy_state"
  | "assistant_response"
  | "copy_control";
type ExpectedState = "PRESENT" | "INTERACTIVE" | "COMPLETES";

const references: Reference[] = [
  "page-root",
  "conversation-root",
  "composer-root",
  "send-control",
  "assistant-response",
  "busy-control",
  "copy-control",
];
const roles: Role[] = ["main", "article", "textbox", "button", "status"];
const strategies: Strategy[] = [
  "page_identity",
  "conversation_root",
  "composer_root",
  "send_control",
  "assistant_response",
  "busy_state",
  "copy_control",
];
const contours: Contour[] = [...strategies];
const expectedStates: ExpectedState[] = ["PRESENT", "INTERACTIVE", "COMPLETES"];

const packaged = (reference: Reference): Primitive => ({
  kind: "packaged_selector_reference",
  reference,
});
const defaultPlan = (
  strategy: Strategy,
  reference: Reference,
): SelectorPlan => ({
  strategy,
  primary: packaged(reference),
  fallbacks: [],
  timeoutMs: 1_000,
  observationMode: "mutation_observer",
});
export const defaultProfileContent = (): ProfileContent => ({
  schemaVersion: "adapter_profile_v1",
  page: {
    identityStrategy: "page_identity",
    conversationStrategy: "conversation_root",
    composerStrategy: "composer_root",
  },
  selectors: {
    conversation: defaultPlan("conversation_root", "conversation-root"),
    composer: defaultPlan("composer_root", "composer-root"),
    send: defaultPlan("send_control", "send-control"),
    assistantResponse: defaultPlan("assistant_response", "assistant-response"),
  },
  observation: { mode: "mutation_observer", intervalMs: 100 },
  contours: [
    {
      key: "page_identity",
      required: true,
      expectedState: "PRESENT",
      strategy: "page_identity",
    },
    {
      key: "conversation_root",
      required: true,
      expectedState: "PRESENT",
      strategy: "conversation_root",
    },
    {
      key: "composer_root",
      required: true,
      expectedState: "INTERACTIVE",
      strategy: "composer_root",
    },
    {
      key: "send_control",
      required: true,
      expectedState: "INTERACTIVE",
      strategy: "send_control",
    },
  ],
});
export const defaultCompatibility = (): Compatibility => ({
  schemaVersion: "profile_compatibility_v1",
  contractVersion: "control_plane_v1",
  browserFamilies: ["chrome"],
  minimumBrowserVersions: [{ browserFamily: "chrome", minimumVersion: "123" }],
  minimumExtensionVersion: "1.0.0",
});

export function percentToBps(input: string): number | null {
  const value = input.trim();
  if (!/^(?:100(?:\.00)?|(?:0|[1-9][0-9]?)(?:\.[0-9]{1,2})?)$/.test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps >= 0 && bps <= 10_000 ? bps : null;
}
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

function AccessGate({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { me } = useAdmin();
  if (!has(me, permission))
    return (
      <Shell title="AI adapters">
        <div className="notice error" role="alert">
          This AI workspace is not available to the current administrator.
        </div>
      </Shell>
    );
  return <>{children}</>;
}

function usePagedData<T>(initialPath: string | null) {
  const [path, setPath] = useState(initialPath);
  const result = useData<Page<T>>(path);
  useEffect(() => setPath(initialPath), [initialPath]);
  const next = () => {
    if (result.data?.nextCursor && path)
      setPath(withCursor(path, result.data.nextCursor));
  };
  return { ...result, next };
}

function IdCell({ value }: { value: string }) {
  return <code title={value}>{value}</code>;
}
function Name({
  machineKey,
  displayName,
}: {
  machineKey: string;
  displayName: string;
}) {
  return (
    <>
      <strong>{displayName}</strong>
      <br />
      <code>{machineKey}</code>
    </>
  );
}
function RegistryEntity({
  entity,
  description,
  kind,
  onDone,
}: {
  entity: Adapter | Surface | Variant;
  description?: string;
  kind: "adapter" | "surface" | "variant";
  onDone: () => Promise<void>;
}) {
  const { me } = useAdmin();
  const [displayName, setDisplayName] = useState(entity.displayName);
  const [entityDescription, setEntityDescription] = useState(description ?? "");
  const permission = "ai.registry.manage";
  const canManage = has(me, permission);
  const endpoint = `/v1/admin/ai/registry/${kind === "adapter" ? "adapters" : kind === "surface" ? "surfaces" : "variants"}/${entity.id}`;
  return (
    <section className="panel">
      <div className="form-grid">
        <label>
          Display name
          <input
            disabled={!canManage}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        {kind === "adapter" && (
          <label>
            Description
            <textarea
              disabled={!canManage}
              value={entityDescription}
              onChange={(event) => setEntityDescription(event.target.value)}
            />
          </label>
        )}
      </div>
      <p className="muted">
        Stable ID: <IdCell value={entity.id} /> · Updated {entity.updatedAt}
      </p>
      <div className="actions">
        <Mutation
          permission={permission}
          action={`Save ${kind} metadata`}
          path={`${endpoint}/metadata`}
          body={{
            expectedUpdatedAt: entity.updatedAt,
            displayName,
            ...(kind === "adapter" ? { description: entityDescription } : {}),
          }}
          onDone={onDone}
        />
        {entity.status !== "ARCHIVED" && (
          <Mutation
            permission={permission}
            action={`${entity.status === "DISABLED" ? "Enable" : "Disable"} ${kind}`}
            path={`${endpoint}/status`}
            body={{
              expectedUpdatedAt: entity.updatedAt,
              targetStatus:
                entity.status === "DISABLED" ? "ACTIVE" : "DISABLED",
            }}
            confirm={
              entity.status === "DISABLED"
                ? `Enable ${kind} ${entity.machineKey}?`
                : `Disable ${kind} ${entity.machineKey}. Existing bootstrap AI resolution may become unavailable.`
            }
            onDone={onDone}
          />
        )}
      </div>
    </section>
  );
}

function CreateField({
  label,
  value,
  onChange,
  required = true,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        disabled={disabled}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function RegistryWorkspace() {
  const { me } = useAdmin();
  const canManage = has(me, "ai.registry.manage");
  const adapters = usePagedData<Adapter>(
    "/v1/admin/ai/registry/adapters?limit=100",
  );
  const [adapterId, setAdapterId] = useState("");
  const selectedAdapter =
    adapters.data?.items.find((item) => item.id === adapterId) ??
    adapters.data?.items[0];
  const surfaces = usePagedData<Surface>(
    selectedAdapter
      ? `/v1/admin/ai/registry/adapters/${selectedAdapter.id}/surfaces?limit=100`
      : null,
  );
  const [surfaceId, setSurfaceId] = useState("");
  const selectedSurface =
    surfaces.data?.items.find((item) => item.id === surfaceId) ??
    surfaces.data?.items[0];
  const variants = usePagedData<Variant>(
    selectedSurface
      ? `/v1/admin/ai/registry/surfaces/${selectedSurface.id}/variants?limit=100`
      : null,
  );
  const [createAdapter, setCreateAdapter] = useState({
    machineKey: "",
    displayName: "",
    description: "",
  });
  const [createSurface, setCreateSurface] = useState({
    machineKey: "",
    displayName: "",
  });
  const [createVariant, setCreateVariant] = useState({
    machineKey: "",
    displayName: "",
  });
  useEffect(() => {
    if (selectedAdapter && !adapterId) setAdapterId(selectedAdapter.id);
  }, [adapterId, selectedAdapter]);
  useEffect(() => {
    if (selectedSurface && !surfaceId) setSurfaceId(selectedSurface.id);
  }, [selectedSurface, surfaceId]);
  const refreshBranch = async () => {
    await Promise.all([adapters.load(), surfaces.load(), variants.load()]);
  };
  return (
    <AccessGate permission="ai.registry.read">
      <Shell title="AI adapter registry">
        <p className="muted">
          Authoritative hierarchy: adapter → surface → variant. Identity keys
          and parent bindings are immutable after creation.
        </p>
        <section className="card">
          <h2>Create adapter</h2>
          <div className="form-grid">
            <CreateField
              label="Machine key"
              value={createAdapter.machineKey}
              disabled={!canManage}
              onChange={(value) =>
                setCreateAdapter({ ...createAdapter, machineKey: value })
              }
            />
            <CreateField
              label="Display name"
              value={createAdapter.displayName}
              disabled={!canManage}
              onChange={(value) =>
                setCreateAdapter({ ...createAdapter, displayName: value })
              }
            />
            <label>
              Description
              <textarea
                disabled={!canManage}
                value={createAdapter.description}
                onChange={(event) =>
                  setCreateAdapter({
                    ...createAdapter,
                    description: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <Mutation
            permission="ai.registry.manage"
            action="Create adapter"
            path="/v1/admin/ai/registry/adapters"
            body={{ ...createAdapter }}
            confirm="Create this immutable adapter identity."
            onDone={adapters.load}
            onSuccess={(value) => {
              const result = value as Partial<Adapter>;
              if (result.id) setAdapterId(result.id);
            }}
          />
        </section>
        <LoadState busy={adapters.busy} error={adapters.error} />
        {adapters.data && (
          <section className="card">
            <h2>Adapters</h2>
            <Table
              headers={["Identity", "Description", "Status", "Updated"]}
              rows={adapters.data.items.map((item) => [
                <Name
                  key="name"
                  machineKey={item.machineKey}
                  displayName={item.displayName}
                />,
                item.description || "—",
                <span className="status" key="status">
                  {item.status}
                </span>,
                item.updatedAt,
              ])}
            />
            <label>
              Selected adapter
              <select
                disabled={!canManage}
                value={selectedAdapter?.id ?? ""}
                onChange={(event) => {
                  setAdapterId(event.target.value);
                  setSurfaceId("");
                }}
              >
                <option value="">Select an adapter</option>
                {adapters.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            {selectedAdapter && (
              <RegistryEntity
                entity={selectedAdapter}
                description={selectedAdapter.description}
                kind="adapter"
                onDone={refreshBranch}
              />
            )}
          </section>
        )}
        {selectedAdapter && (
          <section className="card">
            <h2>
              Surfaces for{" "}
              <Name
                machineKey={selectedAdapter.machineKey}
                displayName={selectedAdapter.displayName}
              />
            </h2>
            <div className="form-grid">
              <CreateField
                label="Surface machine key"
                value={createSurface.machineKey}
                disabled={!canManage}
                onChange={(value) =>
                  setCreateSurface({ ...createSurface, machineKey: value })
                }
              />
              <CreateField
                label="Surface display name"
                value={createSurface.displayName}
                disabled={!canManage}
                onChange={(value) =>
                  setCreateSurface({ ...createSurface, displayName: value })
                }
              />
            </div>
            <Mutation
              permission="ai.registry.manage"
              action="Create surface"
              path="/v1/admin/ai/registry/surfaces"
              body={{ adapterId: selectedAdapter.id, ...createSurface }}
              confirm={`Create an immutable surface under ${selectedAdapter.machineKey}.`}
              onDone={surfaces.load}
              onSuccess={(value) => {
                const result = value as Partial<Surface>;
                if (result.id) setSurfaceId(result.id);
              }}
            />
            <LoadState busy={surfaces.busy} error={surfaces.error} />
            {surfaces.data && (
              <>
                <Table
                  headers={["Identity", "Status", "Updated"]}
                  rows={surfaces.data.items.map((item) => [
                    <Name
                      key="name"
                      machineKey={item.machineKey}
                      displayName={item.displayName}
                    />,
                    <span className="status" key="status">
                      {item.status}
                    </span>,
                    item.updatedAt,
                  ])}
                />
                <label>
                  Selected surface
                  <select
                    disabled={!canManage}
                    value={selectedSurface?.id ?? ""}
                    onChange={(event) => setSurfaceId(event.target.value)}
                  >
                    <option value="">Select a surface</option>
                    {surfaces.data.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.displayName} ({item.machineKey})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedSurface && (
                  <RegistryEntity
                    entity={selectedSurface}
                    kind="surface"
                    onDone={refreshBranch}
                  />
                )}
              </>
            )}
          </section>
        )}
        {selectedSurface && (
          <section className="card">
            <h2>
              Variants for{" "}
              <Name
                machineKey={selectedSurface.machineKey}
                displayName={selectedSurface.displayName}
              />
            </h2>
            <div className="form-grid">
              <CreateField
                label="Variant machine key"
                value={createVariant.machineKey}
                disabled={!canManage}
                onChange={(value) =>
                  setCreateVariant({ ...createVariant, machineKey: value })
                }
              />
              <CreateField
                label="Variant display name"
                value={createVariant.displayName}
                disabled={!canManage}
                onChange={(value) =>
                  setCreateVariant({ ...createVariant, displayName: value })
                }
              />
            </div>
            <Mutation
              permission="ai.registry.manage"
              action="Create variant"
              path="/v1/admin/ai/registry/variants"
              body={{ surfaceId: selectedSurface.id, ...createVariant }}
              confirm={`Create an immutable variant under ${selectedSurface.machineKey}.`}
              onDone={variants.load}
            />
            <LoadState busy={variants.busy} error={variants.error} />
            {variants.data && (
              <Table
                headers={["Identity", "Status", "Updated"]}
                rows={variants.data.items.map((item) => [
                  <Name
                    key="name"
                    machineKey={item.machineKey}
                    displayName={item.displayName}
                  />,
                  <span className="status" key="status">
                    {item.status}
                  </span>,
                  item.updatedAt,
                ])}
              />
            )}
            {variants.data?.items.map((item) => (
              <RegistryEntity
                key={item.id}
                entity={item}
                kind="variant"
                onDone={variants.load}
              />
            ))}
          </section>
        )}
        <Cursor
          cursor={adapters.data?.nextCursor ?? null}
          onNext={adapters.next}
        />
      </Shell>
    </AccessGate>
  );
}

function PrimitiveEditor({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: Primitive;
  onChange: (value: Primitive) => void;
  readOnly: boolean;
}) {
  const set = (patch: Partial<Primitive>) =>
    onChange({ ...value, ...patch } as Primitive);
  return (
    <div className="form-grid">
      <label>
        {label} type
        <select
          disabled={readOnly}
          value={value.kind}
          onChange={(event) => {
            if (event.target.value === "packaged_selector_reference")
              onChange({
                kind: "packaged_selector_reference",
                reference: value.reference,
              });
            else
              onChange({
                kind: "accessibility_role_name",
                role: "main",
                reference: value.reference,
              });
          }}
        >
          <option value="packaged_selector_reference">
            Packaged selector reference
          </option>
          <option value="accessibility_role_name">
            Accessibility role/name
          </option>
        </select>
      </label>
      <label>
        {label} reference
        <select
          disabled={readOnly}
          value={value.reference}
          onChange={(event) =>
            set({ reference: event.target.value as Reference })
          }
        >
          {references.map((reference) => (
            <option key={reference}>{reference}</option>
          ))}
        </select>
      </label>
      {value.kind === "accessibility_role_name" && (
        <label>
          {label} role
          <select
            disabled={readOnly}
            value={value.role}
            onChange={(event) => set({ role: event.target.value as Role })}
          >
            {roles.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function SelectorEditor({
  name,
  value,
  onChange,
  readOnly,
}: {
  name: string;
  value: SelectorPlan;
  onChange: (value: SelectorPlan) => void;
  readOnly: boolean;
}) {
  return (
    <section className="panel">
      <h4>{name}</h4>
      <div className="form-grid">
        <label>
          Strategy
          <select
            disabled={readOnly}
            value={value.strategy}
            onChange={(event) =>
              onChange({ ...value, strategy: event.target.value as Strategy })
            }
          >
            {strategies.map((strategy) => (
              <option key={strategy}>{strategy}</option>
            ))}
          </select>
        </label>
        <label>
          Timeout (ms)
          <input
            disabled={readOnly}
            type="number"
            min={250}
            max={30000}
            value={value.timeoutMs}
            onChange={(event) =>
              onChange({ ...value, timeoutMs: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Observation mode
          <select
            disabled={readOnly}
            value={value.observationMode}
            onChange={(event) =>
              onChange({
                ...value,
                observationMode: event.target.value as ObservationMode,
              })
            }
          >
            <option value="mutation_observer">mutation_observer</option>
            <option value="polling">polling</option>
          </select>
        </label>
      </div>
      <PrimitiveEditor
        label="Primary selector"
        value={value.primary}
        readOnly={readOnly}
        onChange={(primary) => onChange({ ...value, primary })}
      />
      {value.fallbacks.map((fallback, index) => (
        <div key={index}>
          <PrimitiveEditor
            label={`Fallback ${index + 1}`}
            value={fallback}
            readOnly={readOnly}
            onChange={(next) =>
              onChange({
                ...value,
                fallbacks: value.fallbacks.map((item, i) =>
                  i === index ? next : item,
                ),
              })
            }
          />
          {!readOnly && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                onChange({
                  ...value,
                  fallbacks: value.fallbacks.filter((_, i) => i !== index),
                })
              }
            >
              Remove fallback
            </button>
          )}
        </div>
      ))}
      {!readOnly && value.fallbacks.length < 3 && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onChange({
              ...value,
              fallbacks: [...value.fallbacks, packaged("page-root")],
            })
          }
        >
          Add fallback
        </button>
      )}
    </section>
  );
}

function ProfileEditor({
  content,
  compatibility,
  onChange,
  readOnly,
}: {
  content: ProfileContent;
  compatibility: Compatibility;
  onChange: (content: ProfileContent, compatibility: Compatibility) => void;
  readOnly: boolean;
}) {
  const setContent = (next: ProfileContent) => onChange(next, compatibility);
  const setCompatibility = (next: Compatibility) => onChange(content, next);
  const setSelector = (
    key: keyof ProfileContent["selectors"],
    next: SelectorPlan,
  ) =>
    setContent({
      ...content,
      selectors: { ...content.selectors, [key]: next },
    });
  return (
    <section className="card">
      <h3>Bounded adapter_profile_v1 editor</h3>
      <p className="muted">
        Only packaged selector references, accessibility roles, fixed
        strategies, bounded timeouts, observations, contours, browser families,
        and versions are editable. No executable profile fields are accepted
        here.
      </p>
      <div className="form-grid">
        <label>
          Profile schema
          <input readOnly value={content.schemaVersion} />
        </label>
        <label>
          Contract
          <input readOnly value={compatibility.contractVersion} />
        </label>
      </div>
      {(
        Object.entries(content.selectors) as [
          keyof ProfileContent["selectors"],
          SelectorPlan,
        ][]
      ).map(([key, plan]) => (
        <SelectorEditor
          key={key}
          name={key}
          value={plan}
          readOnly={readOnly}
          onChange={(next) => setSelector(key, next)}
        />
      ))}
      <section className="panel">
        <h4>Observation</h4>
        <div className="form-grid">
          <label>
            Mode
            <select
              disabled={readOnly}
              value={content.observation.mode}
              onChange={(event) =>
                setContent({
                  ...content,
                  observation: {
                    ...content.observation,
                    mode: event.target.value as ObservationMode,
                    intervalMs:
                      event.target.value === "mutation_observer"
                        ? 100
                        : content.observation.intervalMs,
                  },
                })
              }
            >
              <option value="mutation_observer">mutation_observer</option>
              <option value="polling">polling</option>
            </select>
          </label>
          <label>
            Interval (ms)
            <input
              disabled={
                readOnly || content.observation.mode === "mutation_observer"
              }
              type="number"
              min={100}
              max={5000}
              value={content.observation.intervalMs}
              onChange={(event) =>
                setContent({
                  ...content,
                  observation: {
                    ...content.observation,
                    intervalMs: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <h4>Critical contours (4–7 unique)</h4>
        {content.contours.map((contour, index) => (
          <div className="form-grid" key={`${contour.key}-${index}`}>
            <label>
              Contour {index + 1}
              <select
                disabled={readOnly}
                value={contour.key}
                onChange={(event) =>
                  setContent({
                    ...content,
                    contours: content.contours.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            key: event.target.value as Contour,
                            strategy: event.target.value as Strategy,
                          }
                        : item,
                    ),
                  })
                }
              >
                {contours.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Expected state
              <select
                disabled={readOnly}
                value={contour.expectedState}
                onChange={(event) =>
                  setContent({
                    ...content,
                    contours: content.contours.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            expectedState: event.target.value as ExpectedState,
                          }
                        : item,
                    ),
                  })
                }
              >
                {expectedStates.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Required
              <select
                disabled={readOnly}
                value={String(contour.required)}
                onChange={(event) =>
                  setContent({
                    ...content,
                    contours: content.contours.map((item, i) =>
                      i === index
                        ? { ...item, required: event.target.value === "true" }
                        : item,
                    ),
                  })
                }
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </label>
            {!readOnly && content.contours.length > 4 && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setContent({
                    ...content,
                    contours: content.contours.filter((_, i) => i !== index),
                  })
                }
              >
                Remove contour
              </button>
            )}
          </div>
        ))}
        {!readOnly && content.contours.length < 7 && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const unused = contours.find(
                (item) =>
                  !content.contours.some((current) => current.key === item),
              );
              if (unused)
                setContent({
                  ...content,
                  contours: [
                    ...content.contours,
                    {
                      key: unused,
                      required: false,
                      expectedState: "PRESENT",
                      strategy: unused,
                    },
                  ],
                });
            }}
          >
            Add contour
          </button>
        )}
      </section>
      <section className="panel">
        <h4>profile_compatibility_v1</h4>
        <label>
          Browser families
          <select
            multiple
            disabled={readOnly}
            value={compatibility.browserFamilies}
            onChange={(event) => {
              const selected = Array.from(event.target.selectedOptions).map(
                (option) => option.value as BrowserFamily,
              );
              setCompatibility({
                ...compatibility,
                browserFamilies: selected.length ? selected : ["chrome"],
                minimumBrowserVersions:
                  compatibility.minimumBrowserVersions.filter((item) =>
                    selected.includes(item.browserFamily),
                  ),
              });
            }}
          >
            <option value="chrome">chrome</option>
            <option value="opera">opera</option>
            <option value="yandex_chromium">yandex_chromium</option>
            <option value="firefox">firefox</option>
            <option value="safari">safari</option>
          </select>
        </label>
        {compatibility.browserFamilies.map((family) => (
          <label key={family}>
            Minimum {family} version
            <input
              disabled={readOnly}
              value={
                compatibility.minimumBrowserVersions.find(
                  (item) => item.browserFamily === family,
                )?.minimumVersion ?? ""
              }
              onChange={(event) =>
                setCompatibility({
                  ...compatibility,
                  minimumBrowserVersions: [
                    ...compatibility.minimumBrowserVersions.filter(
                      (item) => item.browserFamily !== family,
                    ),
                    {
                      browserFamily: family,
                      minimumVersion: event.target.value,
                    },
                  ],
                })
              }
            />
          </label>
        ))}
        <label>
          Minimum extension version
          <input
            disabled={readOnly}
            value={compatibility.minimumExtensionVersion ?? ""}
            onChange={(event) =>
              setCompatibility({
                ...compatibility,
                minimumExtensionVersion: event.target.value || null,
              })
            }
          />
        </label>
      </section>
    </section>
  );
}

function profileFingerprint(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const result = value as { contentSha256?: unknown };
  return typeof result.contentSha256 === "string" ? result.contentSha256 : "";
}

export function ProfilesWorkspace() {
  const profiles = usePagedData<Profile>("/v1/admin/ai/profiles?limit=100");
  const [profileId, setProfileId] = useState("");
  const selectedProfile =
    profiles.data?.items.find((item) => item.id === profileId) ??
    profiles.data?.items[0];
  const profile = useData<Profile>(
    selectedProfile ? `/v1/admin/ai/profiles/${selectedProfile.id}` : null,
  );
  const revisions = usePagedData<Revision>(
    selectedProfile
      ? `/v1/admin/ai/profiles/${selectedProfile.id}/revisions?limit=100`
      : null,
  );
  const [revisionNumber, setRevisionNumber] = useState<number | null>(null);
  const selectedRevision =
    revisions.data?.items.find((item) => item.revision === revisionNumber) ??
    revisions.data?.items[0];
  const revisionDetail = useData<Revision>(
    selectedProfile && selectedRevision
      ? `/v1/admin/ai/profiles/${selectedProfile.id}/revisions/${selectedRevision.revision}`
      : null,
  );
  const [content, setContent] = useState(defaultProfileContent());
  const [compatibility, setCompatibility] = useState(defaultCompatibility());
  const [editorRevisionId, setEditorRevisionId] = useState("");
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const adapters = usePagedData<Adapter>(
    "/v1/admin/ai/registry/adapters?limit=100",
  );
  const [newProfile, setNewProfile] = useState({
    adapterId: "",
    surfaceId: "",
    variantId: "",
    machineKey: "",
    displayName: "",
  });
  const surfaces = useData<Page<Surface>>(
    newProfile.adapterId
      ? `/v1/admin/ai/registry/adapters/${newProfile.adapterId}/surfaces?limit=100`
      : null,
  );
  const variants = useData<Page<Variant>>(
    newProfile.surfaceId
      ? `/v1/admin/ai/registry/surfaces/${newProfile.surfaceId}/variants?limit=100`
      : null,
  );
  useEffect(() => {
    if (selectedProfile && !profileId) setProfileId(selectedProfile.id);
  }, [profileId, selectedProfile]);
  useEffect(() => {
    const value = revisionDetail.data ?? selectedRevision;
    if (value && value.id !== editorRevisionId) {
      setContent(value.content);
      setCompatibility(value.compatibility);
      setEditorRevisionId(value.id);
      setSavedFingerprint(value.contentSha256);
    }
  }, [editorRevisionId, revisionDetail.data, selectedRevision]);
  const refreshProfile = async () => {
    await Promise.all([
      profiles.load(),
      profile.load(),
      revisions.load(),
      revisionDetail.load(),
    ]);
  };
  const profileValue = profile.data ?? selectedProfile;
  return (
    <AccessGate permission="ai.profile.read">
      <Shell title="AI profiles">
        <p className="muted">
          Stable profile identities bind to the registry hierarchy. Revisions
          are immutable after candidate promotion; the server owns fingerprints,
          actors, and timestamps.
        </p>
        <section className="card">
          <h2>Create stable profile identity</h2>
          <div className="form-grid">
            <label>
              Adapter
              <select
                value={newProfile.adapterId}
                onChange={(event) =>
                  setNewProfile({
                    ...newProfile,
                    adapterId: event.target.value,
                    surfaceId: "",
                    variantId: "",
                  })
                }
              >
                <option value="">Select adapter</option>
                {adapters.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Surface
              <select
                value={newProfile.surfaceId}
                onChange={(event) =>
                  setNewProfile({
                    ...newProfile,
                    surfaceId: event.target.value,
                    variantId: "",
                  })
                }
              >
                <option value="">Surface-default profile</option>
                {surfaces.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Optional variant
              <select
                value={newProfile.variantId}
                onChange={(event) =>
                  setNewProfile({
                    ...newProfile,
                    variantId: event.target.value,
                  })
                }
              >
                <option value="">None</option>
                {variants.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <CreateField
              label="Machine key"
              value={newProfile.machineKey}
              onChange={(value) =>
                setNewProfile({ ...newProfile, machineKey: value })
              }
            />
            <CreateField
              label="Display name"
              value={newProfile.displayName}
              onChange={(value) =>
                setNewProfile({ ...newProfile, displayName: value })
              }
            />
          </div>
          <Mutation
            permission="ai.profile.manage"
            action="Create profile"
            path="/v1/admin/ai/profiles"
            body={{ ...newProfile, variantId: newProfile.variantId || null }}
            confirm="Create this immutable stable profile binding."
            onDone={profiles.load}
            onSuccess={(value) => {
              const result = value as Partial<Profile>;
              if (result.id) setProfileId(result.id);
            }}
          />
        </section>
        <LoadState busy={profiles.busy} error={profiles.error} />
        {profiles.data && (
          <section className="card">
            <h2>Profiles</h2>
            <Table
              headers={["Identity", "Binding", "Status", "Updated"]}
              rows={profiles.data.items.map((item) => [
                <button
                  type="button"
                  className="secondary"
                  key={item.id}
                  onClick={() => {
                    setProfileId(item.id);
                    setRevisionNumber(null);
                  }}
                >
                  <Name
                    machineKey={item.machineKey}
                    displayName={item.displayName}
                  />
                </button>,
                `${item.adapterId} / ${item.surfaceId}${item.variantId ? ` / ${item.variantId}` : " / surface default"}`,
                <span className="status" key="status">
                  {item.status}
                </span>,
                item.updatedAt,
              ])}
            />
            <Cursor
              cursor={profiles.data.nextCursor}
              onNext={() => profiles.data?.nextCursor && void profiles.load()}
            />
          </section>
        )}
        {profileValue && (
          <>
            <section className="card">
              <h2>Profile detail</h2>
              <p>
                <Name
                  machineKey={profileValue.machineKey}
                  displayName={profileValue.displayName}
                />
              </p>
              <p>
                Adapter <IdCell value={profileValue.adapterId} /> · Surface{" "}
                <IdCell value={profileValue.surfaceId} /> · Variant{" "}
                {profileValue.variantId ? (
                  <IdCell value={profileValue.variantId} />
                ) : (
                  "surface default"
                )}
              </p>
              <p className="muted">
                Stable ID: <IdCell value={profileValue.id} /> · Updated{" "}
                {profileValue.updatedAt}
              </p>
              <Mutation
                permission="ai.profile.manage"
                action={`${profileValue.status === "DISABLED" ? "Enable" : "Disable"} profile`}
                path={`/v1/admin/ai/profiles/${profileValue.id}/status`}
                body={{
                  expectedUpdatedAt: profileValue.updatedAt,
                  targetStatus:
                    profileValue.status === "DISABLED" ? "ACTIVE" : "DISABLED",
                }}
                confirm={
                  profileValue.status === "DISABLED"
                    ? "Enable this profile?"
                    : "Disable this profile. Existing bootstrap AI resolution may become unavailable."
                }
                onDone={refreshProfile}
              />
            </section>
            <section className="card">
              <h2>Revision history</h2>
              <LoadState busy={revisions.busy} error={revisions.error} />
              {revisions.data && (
                <Table
                  headers={[
                    "Revision",
                    "State",
                    "Content SHA256",
                    "Created",
                    "Published",
                  ]}
                  rows={revisions.data.items.map((item) => [
                    <button
                      type="button"
                      className="secondary"
                      key={item.id}
                      onClick={() => setRevisionNumber(item.revision)}
                    >
                      Revision {item.revision}
                    </button>,
                    <span className="status" key="state">
                      {item.state}
                    </span>,
                    <code key="sha">{item.contentSha256}</code>,
                    item.createdAt,
                    item.publishedAt ?? "—",
                  ])}
                />
              )}
            </section>
            {selectedRevision && (
              <>
                <section className="card">
                  <h2>Revision {selectedRevision.revision} detail</h2>
                  <p>
                    State:{" "}
                    <span className="status">{selectedRevision.state}</span> ·
                    Content SHA256:{" "}
                    <code>{selectedRevision.contentSha256}</code>
                  </p>
                  <p>
                    Compatibility:{" "}
                    {selectedRevision.compatibility.browserFamilies.join(", ")}{" "}
                    · Minimum extension{" "}
                    {selectedRevision.compatibility.minimumExtensionVersion ??
                      "none"}
                  </p>
                  {selectedRevision.state === "DRAFT" && (
                    <p className="notice">
                      DRAFT is editable. Candidate, published, and retired
                      revisions are read-only.
                    </p>
                  )}
                  {selectedRevision.state !== "DRAFT" && (
                    <pre>
                      {JSON.stringify(
                        {
                          content: selectedRevision.content,
                          compatibility: selectedRevision.compatibility,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  )}
                </section>
                <ProfileEditor
                  content={content}
                  compatibility={compatibility}
                  readOnly={selectedRevision.state !== "DRAFT"}
                  onChange={(nextContent, nextCompatibility) => {
                    setContent(nextContent);
                    setCompatibility(nextCompatibility);
                  }}
                />
                {selectedRevision.state === "DRAFT" && (
                  <>
                    <p className="muted">
                      Current fingerprint:{" "}
                      <code>{selectedRevision.contentSha256}</code> · New
                      fingerprint: server response will appear after an
                      authoritative save
                      {savedFingerprint ? ` (${savedFingerprint})` : ""}.
                    </p>
                    <Mutation
                      permission="ai.profile.manage"
                      action="Replace DRAFT"
                      path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${selectedRevision.revision}/replace`}
                      body={{
                        expectedContentSha256: selectedRevision.contentSha256,
                        content,
                        compatibility,
                      }}
                      confirm={`Replace DRAFT revision ${selectedRevision.revision}. The current fingerprint ${selectedRevision.contentSha256} will be checked by the server.`}
                      onDone={refreshProfile}
                      onSuccess={(value) =>
                        setSavedFingerprint(profileFingerprint(value))
                      }
                    />
                    <Mutation
                      permission="ai.profile.manage"
                      action="Mark CANDIDATE"
                      path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${selectedRevision.revision}/candidate`}
                      body={{}}
                      confirm={`Final immutable-content review: mark revision ${selectedRevision.revision} CANDIDATE with server fingerprint ${selectedRevision.contentSha256}?`}
                      onDone={refreshProfile}
                    />
                  </>
                )}
                {selectedRevision.state === "CANDIDATE" && (
                  <Mutation
                    permission="ai.profile.manage"
                    action="Publish revision"
                    path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${selectedRevision.revision}/publish`}
                    body={{}}
                    confirm={`Publish ${profileValue.machineKey} revision ${selectedRevision.revision}. SHA ${selectedRevision.contentSha256}. Compatibility ${selectedRevision.compatibility.browserFamilies.join(", ")}. Target hierarchy: ${profileValue.adapterId} / ${profileValue.surfaceId}${profileValue.variantId ? ` / ${profileValue.variantId}` : " / surface default"}.`}
                    onDone={refreshProfile}
                  />
                )}
                {selectedRevision.state === "PUBLISHED" && (
                  <Mutation
                    permission="ai.profile.manage"
                    action="Retire revision"
                    path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${selectedRevision.revision}/retire`}
                    body={{}}
                    confirm={`Retire revision ${selectedRevision.revision}. Active assignment references may block retirement; the server remains authoritative.`}
                    onDone={refreshProfile}
                  />
                )}
              </>
            )}
          </>
        )}
      </Shell>
    </AccessGate>
  );
}

function AssignmentName({
  assignment,
  adapters,
  surfaces,
  variants,
}: {
  assignment: Assignment;
  adapters: Adapter[];
  surfaces: Surface[];
  variants: Variant[];
}) {
  const adapter = adapters.find((item) => item.id === assignment.adapterId);
  const surface = surfaces.find((item) => item.id === assignment.surfaceId);
  const variant = variants.find((item) => item.id === assignment.variantId);
  return (
    <>
      {adapter?.machineKey ?? assignment.adapterId} /{" "}
      {surface?.machineKey ?? assignment.surfaceId} /{" "}
      {variant?.machineKey ??
        (assignment.variantId ? assignment.variantId : "surface default")}
    </>
  );
}

export function AssignmentsWorkspace() {
  const assignments = usePagedData<Assignment>(
    "/v1/admin/ai/assignments?limit=100",
  );
  const adapters = usePagedData<Adapter>(
    "/v1/admin/ai/registry/adapters?limit=100",
  );
  const [adapterId, setAdapterId] = useState("");
  const surfaces = useData<Page<Surface>>(
    adapterId
      ? `/v1/admin/ai/registry/adapters/${adapterId}/surfaces?limit=100`
      : null,
  );
  const [surfaceId, setSurfaceId] = useState("");
  const variants = useData<Page<Variant>>(
    surfaceId
      ? `/v1/admin/ai/registry/surfaces/${surfaceId}/variants?limit=100`
      : null,
  );
  const [assignmentId, setAssignmentId] = useState("");
  const selectedAssignment =
    assignments.data?.items.find((item) => item.id === assignmentId) ??
    assignments.data?.items[0];
  const assignment = useData<Assignment>(
    selectedAssignment
      ? `/v1/admin/ai/assignments/${selectedAssignment.id}`
      : null,
  );
  const history = usePagedData<AssignmentRevision>(
    selectedAssignment
      ? `/v1/admin/ai/assignments/${selectedAssignment.id}/revisions?limit=100`
      : null,
  );
  const [profilesPath] = useState("/v1/admin/ai/profiles?limit=100");
  const profiles = useData<Page<Profile>>(profilesPath);
  const [profileId, setProfileId] = useState("");
  const profileRevisions = usePagedData<Revision>(
    profileId ? `/v1/admin/ai/profiles/${profileId}/revisions?limit=100` : null,
  );
  const published = useMemo(
    () =>
      profileRevisions.data?.items.filter(
        (item) => item.state === "PUBLISHED",
      ) ?? [],
    [profileRevisions.data],
  );
  const latest = assignment.data?.latest;
  const [browserFamily, setBrowserFamily] = useState<BrowserFamily>("chrome");
  const [subjectKind, setSubjectKind] = useState<"ACCOUNT" | "DEVICE">(
    "ACCOUNT",
  );
  const [percentage, setPercentage] = useState("10.00");
  const percentageBps = percentToBps(percentage);
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState("");
  const [rollbackTarget, setRollbackTarget] = useState("");
  useEffect(() => {
    if (selectedAssignment && !assignmentId)
      setAssignmentId(selectedAssignment.id);
  }, [assignmentId, selectedAssignment]);
  useEffect(() => {
    if (published[0] && !baseline) setBaseline(published[0].id);
  }, [baseline, published]);
  useEffect(() => {
    if (published[1] && !candidate) setCandidate(published[1].id);
  }, [candidate, published]);
  const refreshAssignment = async () => {
    await Promise.all([assignments.load(), assignment.load(), history.load()]);
  };
  const expected = latest?.revision ?? null;
  const requireExisting = latest?.revision ?? 0;
  return (
    <AccessGate permission="ai.assignment.read">
      <Shell title="AI assignment operations">
        <p className="muted">
          Assignment scopes are immutable. Existing-assignment mutations use the
          latest authoritative revision and are reviewed once before submission.
        </p>
        <section className="card">
          <h2>Create assignment scope</h2>
          <div className="form-grid">
            <label>
              Adapter
              <select
                value={adapterId}
                onChange={(event) => {
                  setAdapterId(event.target.value);
                  setSurfaceId("");
                }}
              >
                <option value="">Select adapter</option>
                {adapters.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Surface
              <select
                value={surfaceId}
                onChange={(event) => setSurfaceId(event.target.value)}
              >
                <option value="">Select surface</option>
                {surfaces.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Optional variant
              <select
                value={selectedAssignment?.variantId ?? ""}
                onChange={() => undefined}
              >
                <option value="">Surface default</option>
                {variants.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Browser family
              <select
                value={browserFamily}
                onChange={(event) =>
                  setBrowserFamily(event.target.value as BrowserFamily)
                }
              >
                <option value="chrome">chrome</option>
                <option value="opera">opera</option>
                <option value="yandex_chromium">yandex_chromium</option>
                <option value="firefox">firefox</option>
                <option value="safari">safari</option>
              </select>
            </label>
            <label>
              Subject kind
              <select
                value={subjectKind}
                onChange={(event) =>
                  setSubjectKind(event.target.value as "ACCOUNT" | "DEVICE")
                }
              >
                <option value="ACCOUNT">ACCOUNT</option>
                <option value="DEVICE">DEVICE</option>
              </select>
            </label>
          </div>
          <p className="muted">
            A new scope has no active assignment revision until a direct or
            rollout operation succeeds.
          </p>
          <Mutation
            permission="ai.assignment.manage"
            action="Create assignment scope"
            path="/v1/admin/ai/assignments"
            body={{
              adapterId,
              surfaceId,
              variantId: null,
              browserFamily,
              subjectKind,
            }}
            confirm="Create this immutable assignment scope."
            onDone={assignments.load}
            onSuccess={(value) => {
              const result = value as { id?: string };
              if (result.id) setAssignmentId(result.id);
            }}
          />
        </section>
        <LoadState busy={assignments.busy} error={assignments.error} />
        {assignments.data && (
          <section className="card">
            <h2>Assignment scopes</h2>
            <Table
              headers={[
                "Scope",
                "Browser",
                "Subject",
                "Current mode",
                "Latest revision",
              ]}
              rows={assignments.data.items.map((item) => [
                <button
                  type="button"
                  className="secondary"
                  key={item.id}
                  onClick={() => setAssignmentId(item.id)}
                >
                  <AssignmentName
                    assignment={item}
                    adapters={adapters.data?.items ?? []}
                    surfaces={surfaces.data?.items ?? []}
                    variants={variants.data?.items ?? []}
                  />
                </button>,
                item.browserFamily,
                item.subjectKind,
                item.latest?.mode ?? "No revision",
                item.latest?.revision ?? "—",
              ])}
            />
          </section>
        )}
        {selectedAssignment && (
          <section className="card">
            <h2>Assignment detail</h2>
            <p>
              <AssignmentName
                assignment={assignment.data ?? selectedAssignment}
                adapters={adapters.data?.items ?? []}
                surfaces={surfaces.data?.items ?? []}
                variants={variants.data?.items ?? []}
              />
            </p>
            <p>
              Stable ID: <IdCell value={selectedAssignment.id} /> · Browser{" "}
              {selectedAssignment.browserFamily} · Subject{" "}
              {selectedAssignment.subjectKind}
            </p>
            {latest ? (
              <>
                <Table
                  headers={[
                    "Mode",
                    "Latest",
                    "Baseline",
                    "Candidate",
                    "Percentage",
                  ]}
                  rows={[
                    [
                      latest.mode,
                      latest.revision,
                      <IdCell
                        key="b"
                        value={latest.baselineProfileRevisionId}
                      />,
                      latest.candidateProfileRevisionId ? (
                        <IdCell
                          key="c"
                          value={latest.candidateProfileRevisionId}
                        />
                      ) : (
                        "—"
                      ),
                      bpsToPercent(latest.percentageBps) +
                        ` (${latest.percentageBps} bps)`,
                    ],
                  ]}
                />
                {latest.mode === "PAUSED" && (
                  <p className="notice">
                    PAUSED: the candidate is not being selected while paused.
                  </p>
                )}
              </>
            ) : (
              <p className="notice">
                No assignment revision exists yet. The scope is not active.
              </p>
            )}
            <section className="panel">
              <h3>Published profile revisions</h3>
              <label>
                Profile
                <select
                  value={profileId}
                  onChange={(event) => {
                    setProfileId(event.target.value);
                    setBaseline("");
                    setCandidate("");
                  }}
                >
                  <option value="">Select profile</option>
                  {profiles.data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName} ({item.machineKey})
                    </option>
                  ))}
                </select>
              </label>
              <LoadState
                busy={profileRevisions.busy}
                error={profileRevisions.error}
              />
              <p className="muted">
                Only PUBLISHED revisions are offered as direct, rollout, or
                rollback targets.
              </p>
            </section>
            <div className="form-grid">
              <label>
                Direct published revision
                <select
                  value={baseline}
                  onChange={(event) => setBaseline(event.target.value)}
                >
                  <option value="">Select revision</option>
                  {published.map((item) => (
                    <option key={item.id} value={item.id}>
                      Revision {item.revision} · {item.contentSha256}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rollout baseline revision
                <select
                  value={baseline}
                  onChange={(event) => setBaseline(event.target.value)}
                >
                  <option value="">Select revision</option>
                  {published.map((item) => (
                    <option key={item.id} value={item.id}>
                      Revision {item.revision} · {item.contentSha256}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rollout candidate revision
                <select
                  value={candidate}
                  onChange={(event) => setCandidate(event.target.value)}
                >
                  <option value="">Select revision</option>
                  {published.map((item) => (
                    <option key={item.id} value={item.id}>
                      Revision {item.revision} · {item.contentSha256}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Percentage (0.00–100.00%)
                <input
                  inputMode="decimal"
                  value={percentage}
                  onChange={(event) => setPercentage(event.target.value)}
                />
                <span className="muted">
                  {percentageBps === null
                    ? "Enter an exact percentage with at most two decimals."
                    : `${percentageBps} basis points`}
                </span>
              </label>
              <label>
                Rollback target published revision
                <select
                  value={rollbackTarget}
                  onChange={(event) => setRollbackTarget(event.target.value)}
                >
                  <option value="">Select revision</option>
                  {published.map((item) => (
                    <option key={item.id} value={item.id}>
                      Revision {item.revision} · {item.contentSha256}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {latest && (
              <div className="actions">
                <Mutation
                  permission="ai.assignment.manage"
                  action="Assign direct"
                  path={`/v1/admin/ai/assignments/${selectedAssignment.id}/direct`}
                  body={{
                    baselineProfileRevisionId: baseline,
                    expectedLatestAssignmentRevision: expected,
                  }}
                  confirm={`Assign published revision ${baseline}. Current assignment revision is ${String(expected)}.`}
                  onDone={refreshAssignment}
                  disabled={!baseline}
                />
                <Mutation
                  permission="ai.assignment.manage"
                  action="Start rollout"
                  path={`/v1/admin/ai/assignments/${selectedAssignment.id}/rollout`}
                  body={{
                    baselineProfileRevisionId: baseline,
                    candidateProfileRevisionId: candidate,
                    percentageBps: percentageBps ?? -1,
                    expectedLatestAssignmentRevision: expected,
                  }}
                  confirm={`Start rollout with baseline ${baseline}, candidate ${candidate}, and ${percentageBps === null ? "invalid" : bpsToPercent(percentageBps)}.`}
                  onDone={refreshAssignment}
                  disabled={
                    !baseline ||
                    !candidate ||
                    baseline === candidate ||
                    percentageBps === null
                  }
                />
                {latest.mode !== "DIRECT" && (
                  <>
                    <Mutation
                      permission="ai.assignment.manage"
                      action="Change percentage"
                      path={`/v1/admin/ai/assignments/${selectedAssignment.id}/percentage`}
                      body={{
                        percentageBps: percentageBps ?? -1,
                        expectedLatestAssignmentRevision: requireExisting,
                      }}
                      confirm={`Change rollout percentage to ${percentageBps === null ? "invalid" : bpsToPercent(percentageBps)}.`}
                      onDone={refreshAssignment}
                      disabled={percentageBps === null}
                    />
                    <Mutation
                      permission="ai.assignment.manage"
                      action="Pause rollout"
                      path={`/v1/admin/ai/assignments/${selectedAssignment.id}/pause`}
                      body={{
                        expectedLatestAssignmentRevision: requireExisting,
                      }}
                      confirm="Pause rollout. The candidate will not be selected while paused."
                      onDone={refreshAssignment}
                    />
                    <Mutation
                      permission="ai.assignment.manage"
                      action="Complete rollout"
                      path={`/v1/admin/ai/assignments/${selectedAssignment.id}/complete`}
                      body={{
                        expectedLatestAssignmentRevision: requireExisting,
                      }}
                      confirm="Complete this rollout and make its candidate the direct assignment."
                      onDone={refreshAssignment}
                    />
                  </>
                )}
                {latest.mode === "PAUSED" && (
                  <Mutation
                    permission="ai.assignment.manage"
                    action="Resume rollout"
                    path={`/v1/admin/ai/assignments/${selectedAssignment.id}/resume`}
                    body={{ expectedLatestAssignmentRevision: requireExisting }}
                    confirm="Resume rollout with the current reviewed percentage."
                    onDone={refreshAssignment}
                  />
                )}
              </div>
            )}
            {latest && (
              <Mutation
                permission="ai.assignment.manage"
                action="Rollback assignment"
                path={`/v1/admin/ai/assignments/${selectedAssignment.id}/rollback`}
                body={{
                  profileRevisionId: rollbackTarget,
                  expectedLatestAssignmentRevision: requireExisting,
                }}
                confirm={`Rollback current assignment revision ${requireExisting} to published revision ${rollbackTarget}.`}
                onDone={refreshAssignment}
                disabled={!rollbackTarget}
              />
            )}
          </section>
        )}
        {selectedAssignment && (
          <section className="card">
            <h2>Assignment history</h2>
            <LoadState busy={history.busy} error={history.error} />
            {history.data && (
              <Table
                headers={[
                  "Revision",
                  "Mode",
                  "Baseline",
                  "Candidate",
                  "Percentage",
                  "Created",
                ]}
                rows={history.data.items.map((item) => [
                  item.revision,
                  item.mode,
                  <IdCell key="b" value={item.baselineProfileRevisionId} />,
                  item.candidateProfileRevisionId ? (
                    <IdCell key="c" value={item.candidateProfileRevisionId} />
                  ) : (
                    "—"
                  ),
                  bpsToPercent(item.percentageBps),
                  item.createdAt,
                ])}
              />
            )}
            <Cursor
              cursor={history.data?.nextCursor ?? null}
              onNext={() => history.data?.nextCursor && void history.load()}
            />
          </section>
        )}
      </Shell>
    </AccessGate>
  );
}

export function ProfilesWorkspaceV2() {
  const { me } = useAdmin();
  const canManage = has(me, "ai.profile.manage");
  const profiles = usePagedData<Profile>("/v1/admin/ai/profiles?limit=100");
  const [profileId, setProfileId] = useState("");
  const selectedProfile =
    profiles.data?.items.find((item) => item.id === profileId) ??
    profiles.data?.items[0];
  const profile = useData<Profile>(
    selectedProfile ? `/v1/admin/ai/profiles/${selectedProfile.id}` : null,
  );
  const revisions = usePagedData<Revision>(
    selectedProfile
      ? `/v1/admin/ai/profiles/${selectedProfile.id}/revisions?limit=100`
      : null,
  );
  const draft = revisions.data?.items.find((item) => item.state === "DRAFT");
  const [selectedRevisionNumber, setSelectedRevisionNumber] = useState<
    number | null
  >(null);
  const selectedRevision =
    revisions.data?.items.find(
      (item) => item.revision === selectedRevisionNumber,
    ) ??
    draft ??
    revisions.data?.items.find((item) => item.state === "CANDIDATE") ??
    revisions.data?.items[0];
  const revision = useData<Revision>(
    selectedProfile && selectedRevision
      ? `/v1/admin/ai/profiles/${selectedProfile.id}/revisions/${selectedRevision.revision}`
      : null,
  );
  const [content, setContent] = useState(defaultProfileContent());
  const [compatibility, setCompatibility] = useState(defaultCompatibility());
  const [editorRevisionId, setEditorRevisionId] = useState("");
  const [serverFingerprint, setServerFingerprint] = useState("");
  const [newProfile, setNewProfile] = useState({
    adapterId: "",
    surfaceId: "",
    variantId: "",
    machineKey: "",
    displayName: "",
  });
  const adapters = usePagedData<Adapter>(
    "/v1/admin/ai/registry/adapters?limit=100",
  );
  const surfaces = useData<Page<Surface>>(
    newProfile.adapterId
      ? `/v1/admin/ai/registry/adapters/${newProfile.adapterId}/surfaces?limit=100`
      : null,
  );
  const variants = useData<Page<Variant>>(
    newProfile.surfaceId
      ? `/v1/admin/ai/registry/surfaces/${newProfile.surfaceId}/variants?limit=100`
      : null,
  );
  useEffect(() => {
    const value = revision.data ?? selectedRevision;
    if (value && value.state === "DRAFT" && value.id !== editorRevisionId) {
      setContent(value.content);
      setCompatibility(value.compatibility);
      setServerFingerprint(value.contentSha256);
      setEditorRevisionId(value.id);
    }
  }, [editorRevisionId, revision.data, selectedRevision]);
  const reload = async () => {
    await Promise.all([
      profiles.load(),
      profile.load(),
      revisions.load(),
      revision.load(),
    ]);
  };
  const profileValue = profile.data ?? selectedProfile;
  return (
    <AccessGate permission="ai.profile.read">
      <Shell title="AI profiles">
        <p className="muted">
          Stable profile identities bind to adapter, surface, and optional
          variant. The server owns revision fingerprints, timestamps, and audit
          actors.
        </p>
        <section className="card">
          <h2>Create stable profile identity</h2>
          <div className="form-grid">
            <label>
              Adapter
              <select
                disabled={!canManage}
                value={newProfile.adapterId}
                onChange={(event) =>
                  setNewProfile({
                    ...newProfile,
                    adapterId: event.target.value,
                    surfaceId: "",
                    variantId: "",
                  })
                }
              >
                <option value="">Select adapter</option>
                {adapters.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Surface
              <select
                disabled={!canManage}
                value={newProfile.surfaceId}
                onChange={(event) =>
                  setNewProfile({
                    ...newProfile,
                    surfaceId: event.target.value,
                    variantId: "",
                  })
                }
              >
                <option value="">Select surface</option>
                {surfaces.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Optional variant
              <select
                disabled={!canManage}
                value={newProfile.variantId}
                onChange={(event) =>
                  setNewProfile({
                    ...newProfile,
                    variantId: event.target.value,
                  })
                }
              >
                <option value="">None</option>
                {variants.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <CreateField
              label="Machine key"
              value={newProfile.machineKey}
              disabled={!canManage}
              onChange={(value) =>
                setNewProfile({ ...newProfile, machineKey: value })
              }
            />
            <CreateField
              label="Display name"
              value={newProfile.displayName}
              disabled={!canManage}
              onChange={(value) =>
                setNewProfile({ ...newProfile, displayName: value })
              }
            />
          </div>
          <Mutation
            permission="ai.profile.manage"
            action="Create profile"
            path="/v1/admin/ai/profiles"
            body={{ ...newProfile, variantId: newProfile.variantId || null }}
            confirm="Create this immutable stable profile binding."
            onDone={profiles.load}
            onSuccess={(value) => {
              const result = value as Partial<Profile>;
              if (result.id) setProfileId(result.id);
            }}
          />
        </section>
        <LoadState busy={profiles.busy} error={profiles.error} />
        {profiles.data && (
          <section className="card">
            <h2>Profiles</h2>
            <Table
              headers={["Identity", "Binding", "Status", "Updated"]}
              rows={profiles.data.items.map((item) => [
                <button
                  type="button"
                  className="secondary"
                  key={item.id}
                  onClick={() => {
                    setProfileId(item.id);
                    setSelectedRevisionNumber(null);
                    setEditorRevisionId("");
                  }}
                >
                  <Name
                    machineKey={item.machineKey}
                    displayName={item.displayName}
                  />
                </button>,
                `${item.adapterId} / ${item.surfaceId}${item.variantId ? ` / ${item.variantId}` : " / surface default"}`,
                <span className="status" key="status">
                  {item.status}
                </span>,
                item.updatedAt,
              ])}
            />
            <Cursor cursor={profiles.data.nextCursor} onNext={profiles.next} />
          </section>
        )}
        {profileValue && (
          <>
            <section className="card">
              <h2>Profile detail</h2>
              <p>
                <Name
                  machineKey={profileValue.machineKey}
                  displayName={profileValue.displayName}
                />
              </p>
              <p>
                Adapter <IdCell value={profileValue.adapterId} /> · Surface{" "}
                <IdCell value={profileValue.surfaceId} /> · Variant{" "}
                {profileValue.variantId ? (
                  <IdCell value={profileValue.variantId} />
                ) : (
                  "surface default"
                )}
              </p>
              <p className="muted">
                Stable ID: <IdCell value={profileValue.id} /> · Updated{" "}
                {profileValue.updatedAt}
              </p>
              <Mutation
                permission="ai.profile.manage"
                action={`${profileValue.status === "DISABLED" ? "Enable" : "Disable"} profile`}
                path={`/v1/admin/ai/profiles/${profileValue.id}/status`}
                body={{
                  expectedUpdatedAt: profileValue.updatedAt,
                  targetStatus:
                    profileValue.status === "DISABLED" ? "ACTIVE" : "DISABLED",
                }}
                confirm={
                  profileValue.status === "DISABLED"
                    ? "Enable this profile?"
                    : "Disable this profile. Existing bootstrap AI resolution may become unavailable."
                }
                onDone={reload}
              />
            </section>
            <section className="card">
              <h2>Revision history</h2>
              <LoadState busy={revisions.busy} error={revisions.error} />
              {revisions.data && (
                <Table
                  headers={[
                    "Revision",
                    "State",
                    "Content SHA256",
                    "Created",
                    "Published",
                  ]}
                  rows={revisions.data.items.map((item) => [
                    <button
                      type="button"
                      className="secondary"
                      key={item.id}
                      onClick={() => setSelectedRevisionNumber(item.revision)}
                    >
                      Revision {item.revision}
                    </button>,
                    <span className="status" key="state">
                      {item.state}
                    </span>,
                    <code key="sha">{item.contentSha256}</code>,
                    item.createdAt,
                    item.publishedAt ?? "—",
                  ])}
                />
              )}
              <Cursor
                cursor={revisions.data?.nextCursor ?? null}
                onNext={revisions.next}
              />
            </section>
            <section className="card">
              <h2>Structured profile draft</h2>
              {selectedRevision && selectedRevision.state !== "DRAFT" && (
                <p className="notice">
                  Revision {selectedRevision.revision} is{" "}
                  {selectedRevision.state} and is read-only. Create or select a
                  DRAFT to edit.
                </p>
              )}
              <ProfileEditor
                content={content}
                compatibility={compatibility}
                readOnly={Boolean(
                  !canManage ||
                    (selectedRevision && selectedRevision.state !== "DRAFT"),
                )}
                onChange={(nextContent, nextCompatibility) => {
                  setContent(nextContent);
                  setCompatibility(nextCompatibility);
                }}
              />
              <p className="muted">
                Current fingerprint:{" "}
                <code>{draft?.contentSha256 ?? "none"}</code> · New fingerprint
                is authoritative only after the server response:{" "}
                {serverFingerprint || "not saved"}.
              </p>
              {draft && selectedRevision?.state === "DRAFT" && canManage && (
                <Mutation
                  permission="ai.profile.manage"
                  action="Replace DRAFT"
                  path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${draft.revision}/replace`}
                  body={{
                    expectedContentSha256: draft.contentSha256,
                    content,
                    compatibility,
                  }}
                  confirm={`Replace DRAFT revision ${draft.revision}; the server will verify fingerprint ${draft.contentSha256}.`}
                  onDone={reload}
                  onSuccess={(value) =>
                    setServerFingerprint(profileFingerprint(value))
                  }
                />
              )}
              {!draft && (
                <Mutation
                  permission="ai.profile.manage"
                  action="Create DRAFT"
                  path={`/v1/admin/ai/profiles/${profileValue.id}/revisions`}
                  body={{ content, compatibility }}
                  confirm="Create a DRAFT from this bounded structured profile."
                  onDone={reload}
                  onSuccess={(value) =>
                    setServerFingerprint(profileFingerprint(value))
                  }
                />
              )}
            </section>
            {selectedRevision && (
              <section className="card">
                <h2>Revision review</h2>
                <p>
                  State:{" "}
                  <span className="status">{selectedRevision.state}</span> ·
                  Revision {selectedRevision.revision} · SHA256{" "}
                  <code>{selectedRevision.contentSha256}</code>
                </p>
                <pre>
                  {JSON.stringify(
                    {
                      content: selectedRevision.content,
                      compatibility: selectedRevision.compatibility,
                    },
                    null,
                    2,
                  )}
                </pre>
                {selectedRevision.state === "DRAFT" && (
                  <Mutation
                    permission="ai.profile.manage"
                    action="Mark CANDIDATE"
                    path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${selectedRevision.revision}/candidate`}
                    body={{}}
                    confirm={`Final immutable-content review for ${profileValue.machineKey} revision ${selectedRevision.revision}; server fingerprint ${selectedRevision.contentSha256}.`}
                    onDone={reload}
                  />
                )}
                {selectedRevision.state === "CANDIDATE" && (
                  <Mutation
                    permission="ai.profile.manage"
                    action="Publish revision"
                    path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${selectedRevision.revision}/publish`}
                    body={{}}
                    confirm={`Publish ${profileValue.machineKey} revision ${selectedRevision.revision}; SHA ${selectedRevision.contentSha256}; compatibility ${selectedRevision.compatibility.browserFamilies.join(", ")}; target ${profileValue.adapterId} / ${profileValue.surfaceId}${profileValue.variantId ? ` / ${profileValue.variantId}` : " / surface default"}.`}
                    onDone={reload}
                  />
                )}
                {selectedRevision.state === "PUBLISHED" && (
                  <Mutation
                    permission="ai.profile.manage"
                    action="Retire revision"
                    path={`/v1/admin/ai/profiles/${profileValue.id}/revisions/${selectedRevision.revision}/retire`}
                    body={{}}
                    confirm={`Retire revision ${selectedRevision.revision}. Active assignment references may block retirement; the server remains authoritative.`}
                    onDone={reload}
                  />
                )}
              </section>
            )}
          </>
        )}
      </Shell>
    </AccessGate>
  );
}

export function AssignmentsWorkspaceV2() {
  const { me } = useAdmin();
  const canManage = has(me, "ai.assignment.manage");
  const assignments = usePagedData<Assignment>(
    "/v1/admin/ai/assignments?limit=100",
  );
  const adapters = usePagedData<Adapter>(
    "/v1/admin/ai/registry/adapters?limit=100",
  );
  const [adapterId, setAdapterId] = useState("");
  const surfaces = useData<Page<Surface>>(
    adapterId
      ? `/v1/admin/ai/registry/adapters/${adapterId}/surfaces?limit=100`
      : null,
  );
  const [surfaceId, setSurfaceId] = useState("");
  const variants = useData<Page<Variant>>(
    surfaceId
      ? `/v1/admin/ai/registry/surfaces/${surfaceId}/variants?limit=100`
      : null,
  );
  const [scopeVariantId, setScopeVariantId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const selectedAssignment =
    assignments.data?.items.find((item) => item.id === assignmentId) ??
    assignments.data?.items[0];
  const assignment = useData<Assignment>(
    selectedAssignment
      ? `/v1/admin/ai/assignments/${selectedAssignment.id}`
      : null,
  );
  const history = usePagedData<AssignmentRevision>(
    selectedAssignment
      ? `/v1/admin/ai/assignments/${selectedAssignment.id}/revisions?limit=100`
      : null,
  );
  const profiles = usePagedData<Profile>("/v1/admin/ai/profiles?limit=100");
  const [profileId, setProfileId] = useState("");
  const revisions = usePagedData<Revision>(
    profileId ? `/v1/admin/ai/profiles/${profileId}/revisions?limit=100` : null,
  );
  const published =
    revisions.data?.items.filter((item) => item.state === "PUBLISHED") ?? [];
  const latest = assignment.data?.latest;
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState("");
  const [rollbackTarget, setRollbackTarget] = useState("");
  const [percentage, setPercentage] = useState("10.00");
  const percentageBps = percentToBps(percentage);
  const [browserFamily, setBrowserFamily] = useState<BrowserFamily>("chrome");
  const [subjectKind, setSubjectKind] = useState<"ACCOUNT" | "DEVICE">(
    "ACCOUNT",
  );
  useEffect(() => {
    if (published[0] && !baseline) setBaseline(published[0].id);
  }, [baseline, published]);
  useEffect(() => {
    if (published[1] && !candidate) setCandidate(published[1].id);
  }, [candidate, published]);
  const reload = async () => {
    await Promise.all([assignments.load(), assignment.load(), history.load()]);
  };
  const expected = latest?.revision ?? null;
  const currentRevision = latest?.revision ?? 0;
  const option = (item: Revision) =>
    `Revision ${item.revision} · ${item.contentSha256}`;
  return (
    <AccessGate permission="ai.assignment.read">
      <Shell title="AI assignment operations">
        <p className="muted">
          Scope fields are fixed at creation. Existing-assignment changes use
          the authoritative latest revision and a single review/confirmation.
        </p>
        <section className="card">
          <h2>Create assignment scope</h2>
          <div className="form-grid">
            <label>
              Adapter
              <select
                disabled={!canManage}
                value={adapterId}
                onChange={(event) => {
                  setAdapterId(event.target.value);
                  setSurfaceId("");
                  setScopeVariantId("");
                }}
              >
                <option value="">Select adapter</option>
                {adapters.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Surface
              <select
                disabled={!canManage}
                value={surfaceId}
                onChange={(event) => {
                  setSurfaceId(event.target.value);
                  setScopeVariantId("");
                }}
              >
                <option value="">Select surface</option>
                {surfaces.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Optional variant
              <select
                disabled={!canManage}
                value={scopeVariantId}
                onChange={(event) => setScopeVariantId(event.target.value)}
              >
                <option value="">Surface default</option>
                {variants.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} ({item.machineKey})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Browser family
              <select
                disabled={!canManage}
                value={browserFamily}
                onChange={(event) =>
                  setBrowserFamily(event.target.value as BrowserFamily)
                }
              >
                <option value="chrome">chrome</option>
                <option value="opera">opera</option>
                <option value="yandex_chromium">yandex_chromium</option>
                <option value="firefox">firefox</option>
                <option value="safari">safari</option>
              </select>
            </label>
            <label>
              Subject kind
              <select
                disabled={!canManage}
                value={subjectKind}
                onChange={(event) =>
                  setSubjectKind(event.target.value as "ACCOUNT" | "DEVICE")
                }
              >
                <option value="ACCOUNT">ACCOUNT</option>
                <option value="DEVICE">DEVICE</option>
              </select>
            </label>
          </div>
          <p className="muted">
            A scope is not active until an accepted assignment revision exists.
          </p>
          <Mutation
            permission="ai.assignment.manage"
            action="Create assignment scope"
            path="/v1/admin/ai/assignments"
            body={{
              adapterId,
              surfaceId,
              variantId: scopeVariantId || null,
              browserFamily,
              subjectKind,
            }}
            confirm="Create this immutable assignment scope."
            onDone={assignments.load}
            onSuccess={(value) => {
              const result = value as { id?: string };
              if (result.id) setAssignmentId(result.id);
            }}
          />
        </section>
        <LoadState busy={assignments.busy} error={assignments.error} />
        {assignments.data && (
          <section className="card">
            <h2>Assignment scopes</h2>
            <Table
              headers={["Scope", "Browser", "Subject", "Mode", "Latest"]}
              rows={assignments.data.items.map((item) => [
                <button
                  type="button"
                  className="secondary"
                  key={item.id}
                  onClick={() => setAssignmentId(item.id)}
                >
                  {item.adapterId} / {item.surfaceId} /{" "}
                  {item.variantId ?? "surface default"}
                </button>,
                item.browserFamily,
                item.subjectKind,
                item.latest?.mode ?? "No revision",
                item.latest?.revision ?? "—",
              ])}
            />
            <Cursor
              cursor={assignments.data.nextCursor}
              onNext={assignments.next}
            />
          </section>
        )}
        {selectedAssignment && (
          <>
            <section className="card">
              <h2>Assignment detail</h2>
              <p>
                Adapter <IdCell value={selectedAssignment.adapterId} /> ·
                Surface <IdCell value={selectedAssignment.surfaceId} /> ·
                Variant{" "}
                {selectedAssignment.variantId ? (
                  <IdCell value={selectedAssignment.variantId} />
                ) : (
                  "surface default"
                )}
              </p>
              <p>
                Stable ID: <IdCell value={selectedAssignment.id} /> · Browser{" "}
                {selectedAssignment.browserFamily} · Subject{" "}
                {selectedAssignment.subjectKind}
              </p>
              {latest ? (
                <>
                  <Table
                    headers={[
                      "Mode",
                      "Latest revision",
                      "Baseline",
                      "Candidate",
                      "Percentage",
                    ]}
                    rows={[
                      [
                        latest.mode,
                        latest.revision,
                        <IdCell
                          key="b"
                          value={latest.baselineProfileRevisionId}
                        />,
                        latest.candidateProfileRevisionId ? (
                          <IdCell
                            key="c"
                            value={latest.candidateProfileRevisionId}
                          />
                        ) : (
                          "—"
                        ),
                        `${bpsToPercent(latest.percentageBps)} (${latest.percentageBps} bps)`,
                      ],
                    ]}
                  />
                  {latest.mode === "PAUSED" && (
                    <p className="notice">
                      PAUSED: the candidate is not being selected while paused.
                    </p>
                  )}
                </>
              ) : (
                <p className="notice">
                  No assignment revision exists yet; this scope is not active.
                </p>
              )}
            </section>
            <section className="card">
              <h2>Published revision targets</h2>
              <label>
                Profile
                <select
                  disabled={!canManage}
                  value={profileId}
                  onChange={(event) => {
                    setProfileId(event.target.value);
                    setBaseline("");
                    setCandidate("");
                    setRollbackTarget("");
                  }}
                >
                  <option value="">Select profile</option>
                  {profiles.data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName} ({item.machineKey})
                    </option>
                  ))}
                </select>
              </label>
              <LoadState busy={revisions.busy} error={revisions.error} />
              <p className="muted">
                Only PUBLISHED revisions are offered. Each option includes its
                server fingerprint.
              </p>
              <div className="form-grid">
                <label>
                  Direct profile revision
                  <select
                    disabled={!canManage}
                    value={baseline}
                    onChange={(event) => setBaseline(event.target.value)}
                  >
                    <option value="">Select revision</option>
                    {published.map((item) => (
                      <option key={item.id} value={item.id}>
                        {option(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Rollout baseline profile revision
                  <select
                    disabled={!canManage}
                    value={baseline}
                    onChange={(event) => setBaseline(event.target.value)}
                  >
                    <option value="">Select revision</option>
                    {published.map((item) => (
                      <option key={item.id} value={item.id}>
                        {option(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Rollout candidate profile revision
                  <select
                    disabled={!canManage}
                    value={candidate}
                    onChange={(event) => setCandidate(event.target.value)}
                  >
                    <option value="">Select revision</option>
                    {published.map((item) => (
                      <option key={item.id} value={item.id}>
                        {option(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Percentage (exact 0.00–100.00%)
                  <input
                    disabled={!canManage}
                    inputMode="decimal"
                    value={percentage}
                    onChange={(event) => setPercentage(event.target.value)}
                  />
                  <span className="muted">
                    {percentageBps === null
                      ? "At most two decimal places are accepted."
                      : `${percentageBps} basis points`}
                  </span>
                </label>
                <label>
                  Rollback target profile revision
                  <select
                    disabled={!canManage}
                    value={rollbackTarget}
                    onChange={(event) => setRollbackTarget(event.target.value)}
                  >
                    <option value="">Select revision</option>
                    {published.map((item) => (
                      <option key={item.id} value={item.id}>
                        {option(item)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
            <section className="card">
              <h2>Assignment actions</h2>
              <p className="muted">
                Current expected assignment revision: {String(expected)}. A
                stale response refreshes this workspace and invalidates the old
                review.
              </p>
              <div className="actions">
                <Mutation
                  permission="ai.assignment.manage"
                  action="Assign direct"
                  path={`/v1/admin/ai/assignments/${selectedAssignment.id}/direct`}
                  body={{
                    baselineProfileRevisionId: baseline,
                    expectedLatestAssignmentRevision: expected,
                  }}
                  confirm={`Assign published revision ${baseline} as DIRECT. Expected latest assignment revision: ${String(expected)}.`}
                  onDone={reload}
                  disabled={!baseline}
                />
                <Mutation
                  permission="ai.assignment.manage"
                  action="Start rollout"
                  path={`/v1/admin/ai/assignments/${selectedAssignment.id}/rollout`}
                  body={{
                    baselineProfileRevisionId: baseline,
                    candidateProfileRevisionId: candidate,
                    percentageBps: percentageBps ?? -1,
                    expectedLatestAssignmentRevision: expected,
                  }}
                  confirm={`Start rollout with baseline ${baseline}, candidate ${candidate}, and ${percentageBps === null ? "an invalid percentage" : bpsToPercent(percentageBps)}.`}
                  onDone={reload}
                  disabled={
                    !baseline ||
                    !candidate ||
                    baseline === candidate ||
                    percentageBps === null
                  }
                />
                {latest && latest.mode !== "DIRECT" && (
                  <Mutation
                    permission="ai.assignment.manage"
                    action="Change percentage"
                    path={`/v1/admin/ai/assignments/${selectedAssignment.id}/percentage`}
                    body={{
                      percentageBps: percentageBps ?? -1,
                      expectedLatestAssignmentRevision: currentRevision,
                    }}
                    confirm={`Change percentage to ${percentageBps === null ? "an invalid value" : bpsToPercent(percentageBps)}.`}
                    onDone={reload}
                    disabled={percentageBps === null}
                  />
                )}
                {latest?.mode === "ROLLOUT" && (
                  <>
                    <Mutation
                      permission="ai.assignment.manage"
                      action="Pause rollout"
                      path={`/v1/admin/ai/assignments/${selectedAssignment.id}/pause`}
                      body={{
                        expectedLatestAssignmentRevision: currentRevision,
                      }}
                      confirm="Pause rollout. The candidate will not be selected while paused."
                      onDone={reload}
                    />
                    <Mutation
                      permission="ai.assignment.manage"
                      action="Complete rollout"
                      path={`/v1/admin/ai/assignments/${selectedAssignment.id}/complete`}
                      body={{
                        expectedLatestAssignmentRevision: currentRevision,
                      }}
                      confirm="Complete rollout and make the candidate direct."
                      onDone={reload}
                    />
                  </>
                )}
                {latest?.mode === "PAUSED" && (
                  <>
                    <Mutation
                      permission="ai.assignment.manage"
                      action="Resume rollout"
                      path={`/v1/admin/ai/assignments/${selectedAssignment.id}/resume`}
                      body={{
                        expectedLatestAssignmentRevision: currentRevision,
                      }}
                      confirm="Resume rollout with the reviewed percentage."
                      onDone={reload}
                    />
                    <Mutation
                      permission="ai.assignment.manage"
                      action="Complete rollout"
                      path={`/v1/admin/ai/assignments/${selectedAssignment.id}/complete`}
                      body={{
                        expectedLatestAssignmentRevision: currentRevision,
                      }}
                      confirm="Complete rollout and make the candidate direct."
                      onDone={reload}
                    />
                  </>
                )}
              </div>
              {latest && (
                <Mutation
                  permission="ai.assignment.manage"
                  action="Rollback assignment"
                  path={`/v1/admin/ai/assignments/${selectedAssignment.id}/rollback`}
                  body={{
                    profileRevisionId: rollbackTarget,
                    expectedLatestAssignmentRevision: currentRevision,
                  }}
                  confirm={`Rollback current assignment revision ${currentRevision} to published revision ${rollbackTarget}.`}
                  onDone={reload}
                  disabled={!rollbackTarget}
                />
              )}
            </section>
            <section className="card">
              <h2>Assignment history</h2>
              <LoadState busy={history.busy} error={history.error} />
              {history.data && (
                <Table
                  headers={[
                    "Revision",
                    "Mode",
                    "Baseline",
                    "Candidate",
                    "Percentage",
                    "Created",
                  ]}
                  rows={history.data.items.map((item) => [
                    item.revision,
                    item.mode,
                    <IdCell key="b" value={item.baselineProfileRevisionId} />,
                    item.candidateProfileRevisionId ? (
                      <IdCell key="c" value={item.candidateProfileRevisionId} />
                    ) : (
                      "—"
                    ),
                    bpsToPercent(item.percentageBps),
                    item.createdAt,
                  ])}
                />
              )}
              <Cursor
                cursor={history.data?.nextCursor ?? null}
                onNext={history.next}
              />
            </section>
          </>
        )}
      </Shell>
    </AccessGate>
  );
}
