import type { Metadata } from "next";
import { AccountProfileForm } from "@/features/identity/AccountProfileForm";

export const metadata: Metadata = {
  title: "Your profile",
  description: "Your name, and the defaults your create-world form is filled from."
};

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-[76px] sm:px-6">
      <div className="mb-8">
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-brass">Account</div>
        <h1 className="font-display text-4xl font-semibold tracking-normal text-paper">Your profile</h1>
      </div>
      <AccountProfileForm />
    </main>
  );
}
