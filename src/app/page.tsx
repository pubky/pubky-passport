export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Pubky Passport</h1>
      <p>The new Passport interface is under construction.</p>
      {process.env.NODE_ENV === "development" ? (
        <a className="w-fit text-brand underline" href="/dev">Open component gallery</a>
      ) : null}
    </main>
  );
}
