"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { controlPlane } from "../../lib/control-plane";
import {
  requestOtpChallenge,
  selectOtpVerifyAttempt,
  verifyOtpChallenge,
  type OtpVerifyAttempt,
} from "../../lib/otp-outcome";
import { safeReturnTo } from "../../lib/return-to";
function LoginContent() {
  const router = useRouter(),
    query = useSearchParams(),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState<string>(),
    verifyAttempt = useRef<OtpVerifyAttempt | undefined>(undefined),
    [error, setError] = useState(""),
    inFlight = useRef(false),
    [pending, setPending] = useState(false),
    activeScope = useRef<object | undefined>(undefined);
  useEffect(() => {
    const scope = {};
    activeScope.current = scope;
    return () => {
      activeScope.current = undefined;
      inFlight.current = false;
      verifyAttempt.current = undefined;
    };
  }, []);
  const runOnce = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    // A ref also blocks two submissions before React paints disabled controls.
    const scope = activeScope.current;
    if (!scope || inFlight.current) return;
    const isCurrent = () => activeScope.current === scope;
    inFlight.current = true;
    setPending(true);
    try {
      await action(isCurrent);
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setPending(false);
      }
    }
  };
  const request = () =>
    runOnce(async (isCurrent) => {
      setError("");
      const result = await requestOtpChallenge(() =>
        controlPlane("/v1/auth/otp/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        }),
      );
      if (!isCurrent()) return;
      if (result.kind !== "READY") {
        const messages = {
          UNAVAILABLE: "Нет связи с сервером входа. Повторите попытку позже.",
          RATE_LIMITED: "Слишком много запросов кода. Повторите позже.",
          BETA_CLOSED:
            "Регистрация в бете пока закрыта. Если у вас уже есть аккаунт, войдите.",
          SERVER_ERROR: "Сервис входа временно недоступен. Повторите позже.",
          REJECTED: "Не удалось запросить код входа. Попробуйте позже.",
          INVALID_RESPONSE:
            "Сервер вернул неполный ответ. Попробуйте запросить код ещё раз.",
        };
        setError(messages[result.kind]);
        return;
      }
      verifyAttempt.current = undefined;
      setChallenge(result.challengeId);
    });
  const verify = () =>
    runOnce(async (isCurrent) => {
      if (!challenge) return;
      setError("");
      const attempt = selectOtpVerifyAttempt(
        verifyAttempt.current,
        challenge,
        code,
        () => crypto.randomUUID(),
      );
      verifyAttempt.current = attempt;
      const result = await verifyOtpChallenge(() =>
        controlPlane("/v1/auth/otp/verify", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": attempt.key,
          },
          body: JSON.stringify({ challengeId: challenge, code }),
        }),
      );
      if (!isCurrent()) return;
      if (result.kind !== "VERIFIED") {
        const messages = {
          UNAVAILABLE:
            "Нет связи с сервером проверки. Код можно отправить повторно.",
          RATE_LIMITED: "Слишком много попыток проверки. Повторите позже.",
          BETA_CLOSED:
            "Регистрация в бете пока закрыта. Если у вас уже есть аккаунт, войдите.",
          SERVER_ERROR: "Сервис проверки временно недоступен. Повторите позже.",
          CODE_REJECTED: "Неверный или просроченный код.",
          INVALID_RESPONSE:
            "Сервер не подтвердил вход. Повторите проверку либо запросите новый код.",
        };
        setError(messages[result.kind]);
        return;
      }
      verifyAttempt.current = undefined;
      router.replace(safeReturnTo(query.get("returnTo")));
    });
  const restart = () => {
    if (inFlight.current) return;
    // Return locally; only a separate Send code submission requests another OTP.
    verifyAttempt.current = undefined;
    setChallenge(undefined);
    setCode("");
    setError("");
  };
  return (
    <main>
      <h1>Sign in</h1>
      {!challenge ? (
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            void request();
          }}
        >
          <label>
            Email{" "}
            <input
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </label>
          <button type="submit" disabled={pending}>
            Send code
          </button>
        </form>
      ) : (
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <label>
            Code{" "}
            <input
              disabled={pending}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <button type="submit" disabled={pending}>
            Verify
          </button>
          <button type="button" disabled={pending} onClick={restart}>
            Запросить новый код
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

export default function Login() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
