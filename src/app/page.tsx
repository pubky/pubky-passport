import { publicEnv } from "../libs/env/public-env";
import { DevelopmentIdentityPanel } from "../ui/developmentIdentityPanel";
import { ManualAuthorizationForm } from "../ui/manualAuthorizationForm";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Pubky Passport development</h1>
      <DevelopmentIdentityPanel
        googleClientId={publicEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID}
        allowGoogleDriveReset={process.env.NODE_ENV === "development"}
        passportUrl={publicEnv.NEXT_PUBLIC_PASSPORT_PUBLIC_URL}
      />
      <ManualAuthorizationForm />
    </main>
  );
}
