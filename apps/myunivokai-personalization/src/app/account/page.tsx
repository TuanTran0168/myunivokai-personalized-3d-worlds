import type { Metadata } from "next";
import { AccountProfileForm } from "@/features/identity/AccountProfileForm";

export const metadata: Metadata = {
  title: "Your profile",
  description: "Your name, and the defaults your create-world form is filled from."
};

/**
 * The whole page is the form component, heading and all.
 *
 * It owns the layout because it owns the world behind it: that backdrop is
 * built from the profile the form is holding, and it has to be a SIBLING of
 * the content column rather than a child, or its fixed layer would paint over
 * the heading. The gallery route is arranged the same way for the same reason.
 * This file stays a server component so the route keeps its metadata.
 */
export default function AccountPage() {
  return <AccountProfileForm />;
}
