import { useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import {
  FileText,
  Moon,
  Sun,
  LogOut,
  ChevronDown,
  User,
} from "lucide-react";
import type { Theme } from "../../types";

interface HeaderProps {
  fileName?: string;
  email: string;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
}

export function Header({ fileName, email, theme, onToggleTheme, onLogout }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/80">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
          <FileText className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          RedArm
        </span>
        {fileName && (
          <>
            <span className="text-slate-300 dark:text-slate-600">/</span>
            <span className="truncate text-sm text-slate-500 dark:text-slate-400 max-w-[200px]">
              {fileName}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onToggleTheme} aria-label="Toggle theme">
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900">
              <User className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
            </div>
            <span className="hidden sm:inline max-w-[150px] truncate">{email}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 truncate">
                  {email}
                </div>
                <hr className="border-slate-100 dark:border-slate-700" />
                <button
                  onClick={() => { setMenuOpen(false); onLogout(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
