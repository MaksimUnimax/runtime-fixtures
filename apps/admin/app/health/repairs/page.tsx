"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  Cursor,
  has,
  LoadState,
  Shell,
  Table,
  useAdmin,
  useData,
  withCursor,
} from "../../admin-ui";
import {
  repairApplyUnavailableReason,
  repairCaseStateLabel,
  repairChangeSummary,
  repairDecisionLabel,
  repairEvidenceGaps,
  repairOperationLabel,
  repairScopeValid,
  repairStaleReasonLabel,
  shortFingerprint,
  type RepairCase,
} from "../../../lib/repair-ui";

type RepairPage = { items: RepairCase[]; nextCursor: string | null };
function requiredPermissions(me: ReturnType<typeof useAdmin>["me"]): boolean {
  return (
    has(me, "health.read") &&
    has(me, "ai.profile.read") &&
    has(me, "ai.assignment.read")
  );
}

function fingerprint(value: string) {
  return <code title={value}>{shortFingerprint(value)}</code>;
}

export default function RepairCasesPage() {
  const { me, loading } = useAdmin();
  const [scopeInput, setScopeInput] = useState("");
  const [scope, setScope] = useState("");
  const [listPath, setListPath] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const allowed = requiredPermissions(me);
  const list = useData<RepairPage>(allowed ? listPath : null);
  const detailPath =
    allowed && scope && selected
      ? "/v1/admin/health/repair-cases/" +
        encodeURIComponent(selected.id) +
        "/" +
        selected.revision +
        "?scopeSha256=" +
        encodeURIComponent(scope)
      : null;
  const detail = useData<RepairCase>(detailPath);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = scopeInput.trim().toLowerCase();
    if (!repairScopeValid(value)) {
      setScopeError(
        "Введите полный SHA-256 scope: 64 шестнадцатеричных символа.",
      );
      return;
    }
    setScopeError(null);
    setScope(value);
    setSelected(null);
    setListPath(
      "/v1/admin/health/repair-cases?scopeSha256=" +
        encodeURIComponent(value) +
        "&limit=25",
    );
  };

  if (loading)
    return (
      <Shell title="Проверка исправлений мониторинга">
        <p role="status">Проверяем права администратора…</p>
      </Shell>
    );
  if (!me || !allowed)
    return (
      <Shell title="Проверка исправлений мониторинга">
        <p role="alert">
          Для просмотра нужны одновременно права Health, профилей ИИ и
          назначений профилей. Никаких прав на применение эта страница не
          выдаёт.
        </p>
      </Shell>
    );

  return (
    <Shell title="Проверка исправлений мониторинга">
      <p>
        <Link href="/health">← Health operations</Link>
      </p>
      <section className="card">
        <p className="eyebrow">Только чтение · проверка случая оператором</p>
        <p className="muted">
          Здесь видны сохранённые доказательства кандидата, текущие изменения и
          состояние решения оператора. Страница не публикует профиль, не
          запускает rollout и не применяет исправление.
        </p>
        <form onSubmit={submit}>
          <label>
            SHA-256 области мониторинга
            <input
              aria-label="SHA-256 scope"
              value={scopeInput}
              onChange={(event) => setScopeInput(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="64 hex symbols"
            />
          </label>
          <button type="submit">Показать случаи</button>
        </form>
        {scopeError && <p role="alert">{scopeError}</p>}
        <LoadState busy={list.busy} error={list.error} />
        {list.data && list.data.items.length === 0 && (
          <p role="status">Для этого scope случаев исправления нет.</p>
        )}
        {list.data && list.data.items.length > 0 && (
          <Table
            headers={[
              "Состояние",
              "Кейс",
              "Создан",
              "Кандидат",
              "H4",
              "Решение",
              "Карточка",
            ]}
            rows={list.data.items.map((item) => [
              repairCaseStateLabel(item.caseState),
              item.repairCaseId,
              item.createdAt,
              <>
                rev {item.candidate.revision} · {item.candidate.state} · профиль{" "}
                {item.candidate.profileId} · ревизия{" "}
                {item.candidate.profileRevisionId} ·{" "}
                {fingerprint(item.candidate.contentSha256)}
              </>,
              (item.testEvidence.h4Status ?? "нет статуса") +
                " / " +
                (item.testEvidence.h4Outcome ?? "нет результата"),
              repairDecisionLabel(item),
              <button
                key={item.repairCaseId}
                type="button"
                className="secondary"
                onClick={() =>
                  setSelected({
                    id: item.repairCaseId,
                    revision: item.caseRevision,
                  })
                }
              >
                Открыть
              </button>,
            ])}
          />
        )}
        {list.data?.nextCursor && listPath && (
          <Cursor
            cursor={list.data.nextCursor}
            onNext={() => {
              setSelected(null);
              setListPath(withCursor(listPath, list.data!.nextCursor!));
            }}
          />
        )}
      </section>

      {selected && (
        <section className="card">
          <h2>Карточка исправления</h2>
          <LoadState busy={detail.busy} error={detail.error} />
          {detail.data && <RepairDetail item={detail.data} />}
        </section>
      )}
    </Shell>
  );
}

function RepairDetail({ item }: { item: RepairCase }) {
  const gaps = repairEvidenceGaps(item);
  return (
    <>
      <p>
        <strong>{repairCaseStateLabel(item.caseState)}</strong>
      </p>
      <p role="status">{repairApplyUnavailableReason(item)}</p>
      <h3>Что изменилось</h3>
      <p>{repairChangeSummary(item)}</p>
      <Table
        headers={["Проверенная связка", "Текущее наблюдение", "Инцидент"]}
        rows={[
          [
            fingerprint(item.bindingSha256),
            item.observation.currentHealthState ?? "нет текущего состояния",
            item.incident.status,
          ],
        ]}
      />

      <h3>Кандидат и тестированная версия</h3>
      <Table
        headers={["Кандидат", "Эталон / откат", "Проверенная версия"]}
        rows={[
          [
            <>
              rev {item.candidate.revision} · {item.candidate.state}
              <br />
              профиль {item.candidate.profileId}
              <br />
              ревизия {item.candidate.profileRevisionId}
              <br />
              {fingerprint(item.candidate.contentSha256)}
            </>,
            <>
              <code>{item.acceptedBaselineProfileRevisionId}</code>
              <br />
              <code>{item.rollbackProfileRevisionId}</code>
            </>,
            <>
              {item.testedExtension.version} ·{" "}
              {item.testedExtension.browserFamily}{" "}
              {item.testedExtension.browserVersion}
              <br />
              package {fingerprint(item.testedExtension.packageSha256)}
            </>,
          ],
        ]}
      />

      <h3>Серия тестов и доказательства</h3>
      <Table
        headers={["Тестовая серия", "Оценка H4", "Свидетельства и результаты"]}
        rows={[
          [
            item.testEvidence.suiteMachineKey +
              " · ревизия " +
              item.testEvidence.suiteRevision,
            (item.testEvidence.h4Status ?? "нет статуса") +
              " / " +
              (item.testEvidence.h4Outcome ?? "нет результата") +
              " · " +
              item.testEvidence.h4EvaluationKey,
            <>
              ID серии {fingerprint(item.testEvidence.suiteRevisionId)}
              <br />
              Определение {fingerprint(item.testEvidence.suiteDefinitionSha256)}
              <br />
              ID оценки {fingerprint(item.testEvidence.h4EvaluationId)}
              <br />
              Установленное поведение{" "}
              {fingerprint(item.testEvidence.installedBehaviorEvidenceSha256)}
              <br />
              Матрица {fingerprint(item.testEvidence.matrixSha256)}
              <br />
              Результаты {fingerprint(item.testEvidence.resultsSha256)}
            </>,
          ],
        ]}
      />

      <h3>Назначение и решение</h3>
      <Table
        headers={["Назначение", "Решение оператора", "Серверная операция"]}
        rows={[
          [
            item.assignment.currentRevision === null
              ? "Текущая ревизия отсутствует"
              : "rev " +
                item.assignment.currentRevision +
                " · " +
                (item.assignment.currentMode ?? "режим отсутствует") +
                " · " +
                (item.assignment.currentPercentageBps ?? 0) / 100 +
                "%",
            item.decision
              ? repairDecisionLabel(item) +
                " · действует до " +
                item.decision.expiresAt
              : repairDecisionLabel(item),
            repairOperationLabel(item),
          ],
        ]}
      />
      <h3>Непроверенные или устаревшие участки</h3>
      {gaps.length === 0 ? (
        <p>
          Обязательные поля текущей read-only проекции присутствуют. Это всё
          равно не является разрешением на применение.
        </p>
      ) : (
        <ul>
          {gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      )}
      {item.staleReasons.length > 0 && (
        <>
          <h3>Причины устаревания</h3>
          <ul>
            {item.staleReasons.map((reason) => (
              <li key={reason}>{repairStaleReasonLabel(reason)}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
