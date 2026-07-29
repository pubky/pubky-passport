import { getBrowserBootstrapConfig } from "../server/config/browserBootstrapConfig";
import { DevelopmentIdentityPanel } from "../ui/developmentIdentityPanel";
import { ManualAuthorizationForm } from "../ui/manualAuthorizationForm";

export default function Home() {
  const config = getBrowserBootstrapConfig();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Pubky Passport development</h1>
      <DevelopmentIdentityPanel
        allowGoogleDrivePassportFileDeletion={process.env.NODE_ENV === "development"}
        googleClientId={config.googleClientId}
        homegateBaseUrl={config.homegateBaseUrl}
      />
      <ManualAuthorizationForm />
    </main>
  );
}
