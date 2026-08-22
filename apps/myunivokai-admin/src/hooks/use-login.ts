"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fetchWithWakeRetry } from "@/lib/wake-retry";

export interface LoginCredentials {
  email: string;
  password: string;
}

interface LoginErrorPayload {
  error?: { message?: string };
}

async function login(credentials: LoginCredentials, onWaking: () => void): Promise<void> {
  // Login is the worst place in the app to meet a sleeping service: it is the
  // first request of a session, so auth-service has had the longest possible
  // time to be put to sleep, and a failure here shows as "invalid email or
  // password" — an error message that is not only unhelpful but wrong.
  const response = await fetchWithWakeRetry(
    "/api/admin/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials)
    },
    onWaking
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as LoginErrorPayload;
    throw new Error(payload.error?.message || "Invalid email or password.");
  }
}

/**
 * useLogin returns the mutation alongside isWakingService rather than one
 * merged object, so the mutation result stays exactly what TanStack Query
 * handed back. isWakingService is what lets the form say "starting the
 * service" instead of showing a sign-in spinner for a full cold start with no
 * explanation.
 */
export function useLogin() {
  const router = useRouter();
  const [isWakingService, setIsWakingService] = useState(false);
  const mutation = useMutation({
    mutationFn: (credentials: LoginCredentials) => login(credentials, () => setIsWakingService(true)),
    onSettled: () => setIsWakingService(false),
    onSuccess: () => {
      router.push("/");
      router.refresh();
    }
  });
  return { mutation, isWakingService };
}
