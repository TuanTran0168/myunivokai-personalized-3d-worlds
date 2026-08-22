"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark } from "@/components/layout/brand-mark";
import { useLogin } from "@/hooks/use-login";
import { attemptSilentRefresh } from "@/lib/client-session";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const { mutation: login, isWakingService } = useLogin();
  const router = useRouter();

  // Middleware only reaches this page when the access token is missing or
  // expired — the 14-day refresh token may still be good, so try to revive
  // the session silently before asking for credentials again. The refresh
  // cookie is scoped to this exact path (Path=/api/admin/auth), which is
  // exactly why middleware itself can't do this check — see middleware.ts.
  useEffect(() => {
    let cancelled = false;
    attemptSilentRefresh().then((revived) => {
      if (cancelled) return;
      if (revived) {
        router.replace("/");
        router.refresh();
        return;
      }
      setIsCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <div className="login-dots flex min-h-full flex-1 flex-col items-center justify-center p-6">
      {/* Animated brand mark above the card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
        className="mb-6"
      >
        <BrandMark className="mx-auto h-12 w-12" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 0.61, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-xl">Myunivokai Admin</CardTitle>
            <CardDescription>Staff sign-in</CardDescription>
          </CardHeader>
          <CardContent>
            {isCheckingSession ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Checking your session…</p>
              </div>
            ) : (
              <motion.form
                className="flex flex-col gap-4"
                onSubmit={handleSubmit}
                animate={login.isError ? { x: [0, -8, 8, -6, 6, 0] } : undefined}
                transition={{ duration: 0.4 }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
                {login.isError ? <p className="text-sm text-destructive">{login.error.message}</p> : null}
                {/* A cold start takes tens of seconds. Saying so turns an
                    apparently hung button into an explained wait — and this is
                    the one screen with no other content to reassure anybody. */}
                {isWakingService ? (
                  <p className="text-sm text-muted-foreground">
                    Starting the service — this can take up to a minute after a quiet period.
                  </p>
                ) : null}
                <Button type="submit" className="mt-2" disabled={login.isPending}>
                  {login.isPending ? (isWakingService ? "Starting service…" : "Signing in…") : "Sign in"}
                </Button>
              </motion.form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

