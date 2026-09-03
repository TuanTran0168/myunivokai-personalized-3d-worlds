import type { Metadata } from "next";
import { AuthCredentialsForm } from "@/features/identity/AuthCredentialsForm";

export const metadata: Metadata = {
  title: "Sign in — Myunivokai",
  description: "Sign in to see the worlds saved to your account."
};

export default function SignInPage() {
  return <AuthCredentialsForm mode="sign-in" />;
}
