export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">Pubky Passport</p>
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
        Login with Google for Pubky authorization.
      </h1>
      <p className="max-w-xl text-neutral-600">
        Bootstrap scaffold only. Implementation starts with the Pubky auth request parser.
      </p>
    </main>
  );
}
