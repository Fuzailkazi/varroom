import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export function AccountView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, loading, updateDisplayName, changeEmail } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setEmail(user.email);
    }
  }, [user]);

  if (loading) {
    return <div className="auth-form-card mx-auto my-12">Loading your account…</div>;
  }

  if (!user) {
    return (
      <div className="auth-form-card mx-auto my-12 text-center">
        <h1 className="font-display text-2xl font-extrabold">Sign in to edit your account</h1>
        <Button className="mt-5" onClick={() => onNavigate("/sign-in?returnTo=%2Faccount")}>
          Sign in
        </Button>
      </div>
    );
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setNameError(null);
    setNameMessage(null);
    setSavingName(true);
    const result = await updateDisplayName(displayName);
    setSavingName(false);
    if (result.success) setNameMessage("Display name updated.");
    else setNameError(result.error || "Could not update your display name.");
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault();
    setEmailError(null);
    setEmailMessage(null);
    setSavingEmail(true);
    const result = await changeEmail(email);
    setSavingEmail(false);
    if (result.success) {
      setEmailMessage(
        user?.emailVerified
          ? import.meta.env.DEV
            ? "Open the email change link from the API terminal, then return here."
            : "Check your new inbox to confirm the address change."
          : "Email address updated.",
      );
    } else {
      setEmailError(result.error || "Could not change your email address.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[.18em] text-[var(--ink-3)]">
          Your VAR Room account
        </p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-[-.05em] sm:text-5xl">
          Account settings
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          Edit your profile and keep your email address up to date.
        </p>
      </div>

      <div className="grid gap-5">
        <section className="auth-form-card max-w-none" aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="font-display text-xl font-extrabold">
            Profile
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Your username <strong>@{user.username}</strong> stays the same.
          </p>
          <form onSubmit={saveName} className="mt-5 flex flex-col gap-3">
            <Label htmlFor="account-display-name">Display name</Label>
            <Input
              id="account-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              maxLength={50}
              required
            />
            {nameError && <StatusMessage error>{nameError}</StatusMessage>}
            {nameMessage && <StatusMessage>{nameMessage}</StatusMessage>}
            <Button type="submit" disabled={savingName || displayName.trim() === user.displayName}>
              {savingName ? "Saving…" : "Save display name"}
            </Button>
          </form>
        </section>

        <section className="auth-form-card max-w-none" aria-labelledby="email-heading">
          <h2 id="email-heading" className="font-display text-xl font-extrabold">
            Email address
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Current: <strong>{user.email}</strong>
          </p>
          <form onSubmit={saveEmail} className="mt-5 flex flex-col gap-3">
            <Label htmlFor="account-email">New email address</Label>
            <Input
              id="account-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
            <p className="text-xs text-[var(--ink-3)]">
              {user.emailVerified
                ? "Changing a previously confirmed address requires a link to protect your account."
                : "Your new address will be saved immediately."}
            </p>
            {emailError && <StatusMessage error>{emailError}</StatusMessage>}
            {emailMessage && <StatusMessage>{emailMessage}</StatusMessage>}
            <Button
              type="submit"
              disabled={savingEmail || email.trim().toLowerCase() === user.email.toLowerCase()}
            >
              {savingEmail ? "Saving…" : "Change email"}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}

function StatusMessage({ children, error = false }: { children: string; error?: boolean }) {
  const Icon = error ? WarningCircle : CheckCircle;
  return (
    <p
      role={error ? "alert" : "status"}
      className={`flex items-start gap-2 text-xs font-bold ${error ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" weight="fill" />
      {children}
    </p>
  );
}
