/**
 * Reads the Supabase connection settings from environment variables.
 *
 * The values live in `.env.local` (create it by copying `.env.example`).
 *
 * Each variable is written out by its full name (process.env.NEXT_PUBLIC_...)
 * on purpose: Next.js only copies NEXT_PUBLIC_ values into browser code when
 * they are referenced exactly like this.
 */
export function getSupabaseEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url) {
    throw missingEnvError("NEXT_PUBLIC_SUPABASE_URL")
  }
  if (!publishableKey) {
    throw missingEnvError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
  }

  return { url, publishableKey }
}

function missingEnvError(name: string): Error {
  return new Error(
    `Missing environment variable ${name}. ` +
      "Copy .env.example to .env.local, fill in the value from the Supabase dashboard, " +
      "then restart the dev server (npm run dev)."
  )
}
