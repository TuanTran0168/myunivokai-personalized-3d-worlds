"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

async function logout(): Promise<void> {
  const response = await fetch("/api/admin/auth/logout", { method: "POST" });
  if (!response.ok && response.status !== 401) {
    throw new Error("Logout failed.");
  }
}

export function useLogout() {
  const router = useRouter();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
    onError: () => {
      toast.error("Could not log out. Please try again.");
    }
  });
}
