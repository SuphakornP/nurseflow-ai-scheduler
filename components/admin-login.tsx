"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function errorMessageForStatus(status: number): string {
  if (status === 401) {
    return "The email or password is incorrect.";
  }

  if (status === 429) {
    return "Too many sign-in attempts. Wait 15 minutes, then try again.";
  }

  if (status === 503) {
    return "Admin access is not configured for this deployment.";
  }

  return "Sign-in could not be completed. Try again.";
}

export function AdminLogin() {
  const router = useRouter();
  const passwordInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      if (!response.ok) {
        setPassword("");
        setError(errorMessageForStatus(response.status));
        requestAnimationFrame(() => passwordInput.current?.focus());
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setPassword("");
      setError("NurseFlow AI could not reach the sign-in service. Check your connection and retry.");
      requestAnimationFrame(() => passwordInput.current?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-context" aria-labelledby="login-page-title">
        <div className="brand-lockup login-brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <strong>NurseFlow AI</strong>
            <span>Clinical schedule workspace</span>
          </div>
        </div>

        <div className="login-context-copy">
          <p className="login-kicker">Restricted workspace / Admin only</p>
          <h1 id="login-page-title">
            Clinical schedule
            <span>access checkpoint.</span>
          </h1>
          <p>
            Authenticate before viewing staffing requests, candidate rosters, or schedule decisions.
          </p>
        </div>

        <div className="login-index" aria-hidden="true">
          <span>ACCESS</span>
          <strong>01</strong>
        </div>

        <dl className="login-access-facts">
          <div>
            <dt>Access class</dt>
            <dd>ADMIN</dd>
          </div>
          <div>
            <dt>Session window</dt>
            <dd>8 HOURS</dd>
          </div>
        </dl>
      </section>

      <section className="login-gate" aria-labelledby="login-form-title">
        <div className="login-gate-inner">
          <header className="login-gate-heading">
            <p>Checkpoint 01 / Identity</p>
            <h2 id="login-form-title">Sign in to continue</h2>
            <span>Use the administrator credentials provisioned for this deployment.</span>
          </header>

          <form className="login-form" onSubmit={handleSubmit} aria-busy={submitting}>
            <label className="login-field" htmlFor="admin-email">
              <span>Admin email</span>
              <input
                id="admin-email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
                aria-invalid={Boolean(error)}
                required
                autoFocus
              />
            </label>

            <label className="login-field" htmlFor="admin-password">
              <span>Password</span>
              <input
                ref={passwordInput}
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                aria-describedby={error ? "login-error" : "login-password-hint"}
                aria-invalid={Boolean(error)}
                required
              />
            </label>

            <p id="login-password-hint" className="login-field-hint">
              Account creation and external access are disabled.
            </p>

            <div
              id="login-error"
              className={`login-error${error ? " is-visible" : ""}`}
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
            >
              {error}
            </div>

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <i className="login-spinner" aria-hidden="true" />
                  Verifying access
                </>
              ) : (
                <>
                  Enter workspace <span aria-hidden="true">&rarr;</span>
                </>
              )}
            </button>
          </form>

          <footer className="login-security-note">
            <span className="login-lock" aria-hidden="true" />
            <p>
              <strong>Private session</strong>
              Signed in for up to 8 hours on this browser.
            </p>
          </footer>
        </div>
      </section>
    </main>
  );
}
