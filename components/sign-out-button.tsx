"use client";

import { useState } from "react";

const SIGN_OUT_ERROR = "Sign out could not be completed. Check your connection and try again.";

export function SignOutButton({ onError }: { onError: (message: string) => void }) {
  const [submitting, setSubmitting] = useState(false);

  const handleSignOut = async () => {
    if (submitting) return;

    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      if (!response.ok) {
        throw new Error(SIGN_OUT_ERROR);
      }

      // A full navigation clears any authenticated data retained in the client router cache.
      window.location.replace("/login");
    } catch {
      onError(SIGN_OUT_ERROR);
      setSubmitting(false);
    }
  };

  return (
    <button
      className="button button--ghost button--sign-out"
      type="button"
      disabled={submitting}
      onClick={() => void handleSignOut()}
    >
      {submitting ? "Signing out..." : "Sign out"}
    </button>
  );
}
