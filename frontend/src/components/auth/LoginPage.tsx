import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { FileText, Mail, Lock } from "lucide-react";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<unknown>;
  isLoading: boolean;
  error?: string;
}

export function LoginPage({ onLogin, isLoading, error }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError("");

    if (!email || !email.includes("@")) {
      setLocalError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setLocalError("Password is required.");
      return;
    }

    try {
      await onLogin(email, password);
    } catch (err) {
      setLocalError((err as Error).message);
    }
  };

  const displayError = localError || error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-brand-950 to-slate-900 p-4">
      <div
        className="w-full max-w-md animate-[fadeInUp_400ms_ease-out]"
      >
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8 flex flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/30">
              <FileText className="h-7 w-7 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-bold text-white">RedArm PDF Editor</h1>
              <p className="mt-1 text-sm text-slate-400">Sign in to your account</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={<Mail className="h-4 w-4" />}
              className="!bg-white/10 !border-white/20 !text-white !placeholder:text-slate-500"
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<Lock className="h-4 w-4" />}
              className="!bg-white/10 !border-white/20 !text-white !placeholder:text-slate-500"
              autoComplete="current-password"
            />

            {displayError && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
                {displayError}
              </div>
            )}

            <Button type="submit" size="lg" isLoading={isLoading} className="mt-2 w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-500">
            Use admin credentials configured in environment variables
          </p>
        </div>
      </div>
    </div>
  );
}
