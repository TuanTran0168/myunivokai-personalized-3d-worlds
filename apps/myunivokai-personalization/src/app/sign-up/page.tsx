import type { Metadata } from "next";
import { AuthCredentialsForm } from "@/features/identity/AuthCredentialsForm";

export const metadata: Metadata = {
  title: "Create an account — Myunivokai",
  description: "Keep the worlds you make instead of leaving them in one browser's storage."
};

export default function SignUpPage() {
  return <AuthCredentialsForm mode="sign-up" />;
}
