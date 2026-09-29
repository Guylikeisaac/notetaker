// Who may use the app. Kept free of imports so auth.ts can use it without a cycle.

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Company domains whose Google accounts may sign in (ALLOWED_EMAIL_DOMAINS), plus individual ALLOWED_EMAILS. */
export function isAllowedEmail(email: string): boolean {
  const e = email.toLowerCase();
  const domains = list("ALLOWED_EMAIL_DOMAINS");
  if (domains.length === 0 && list("ALLOWED_EMAILS").length === 0) return true; // unrestricted
  return domains.includes(e.split("@")[1] ?? "") || list("ALLOWED_EMAILS").includes(e);
}

/** Admins (ADMIN_EMAILS) manage the company bot account. */
export function isAdminEmail(email: string): boolean {
  return list("ADMIN_EMAILS").includes(email.toLowerCase());
}
