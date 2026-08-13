import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PermissionList, PermissionRow } from "../../client/ui/authorization/review/permissionList";
import { Avatar } from "../../client/ui/shared/primitives/avatar";
import { Button } from "../../client/ui/shared/primitives/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../client/ui/shared/primitives/card";
import { ConfirmationDialog } from "../../client/ui/shared/primitives/confirmationDialog";
import { FieldMessage } from "../../client/ui/shared/primitives/fieldMessage";
import { IconButton } from "../../client/ui/shared/primitives/iconButton";
import { Input } from "../../client/ui/shared/primitives/input";
import { Label } from "../../client/ui/shared/primitives/label";
import { ProviderSignInButton } from "../../client/ui/onboarding/providerSignInButton";
import { Spinner } from "../../client/ui/shared/primitives/spinner";
import { DisplayHeading, LeadText } from "../../client/ui/shared/primitives/typography";
import { IdentityRow } from "../../client/ui/identity-catalog/selection/identityRow";
import { GoogleAccountCard } from "../../client/ui/onboarding/google/googleAccountCard";
import { ArrowRightIcon, CheckIcon, ScanIcon, TrashIcon, XIcon } from "../../client/ui/shared/icons/actionIcons";

const VARIANTS = ["default", "secondary", "outline", "destructive"] as const;
const SIZES = ["default", "lg", "icon"] as const;

export default function ComponentGalleryPage() {
    if (process.env.NODE_ENV !== "development") notFound();

    return (
        <main className="mx-auto flex min-h-[calc(100svh-84px)] max-w-4xl flex-col gap-10 px-6 pb-10 pt-3">
            <header className="flex flex-col gap-6">
                <DisplayHeading accent="Gallery.">Component</DisplayHeading>
                <LeadText>Figma variants and reusable components available for building Pubky Passport screens.</LeadText>
            </header>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Figma examples</h2>
                <div className="grid gap-4 rounded-xl border bg-background p-6 sm:grid-cols-2">
                    <Button className="w-full max-w-[327px]" size="lg" variant="secondary">
                        <ScanIcon />
                        Scan QR
                    </Button>
                    <Button className="w-full max-w-[327px]" size="lg">
                        <ArrowRightIcon />
                        Continue
                    </Button>
                    <Button className="w-full max-w-[327px]" size="lg" variant="outline">
                        <XIcon />
                        Cancel
                    </Button>
                    <Button className="w-full max-w-[327px]" size="lg">
                        <CheckIcon />
                        Authorize
                    </Button>
                    <Button className="w-full max-w-[327px]" size="lg" variant="destructive">
                        <TrashIcon />
                        Remove Google Access
                    </Button>
                </div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Form controls</h2>
                <div className="grid gap-6 rounded-xl border bg-card p-6 sm:grid-cols-2">
                    <FormExample label="Authorization link"><Input action={<IconButton aria-label="Paste authorization link" variant="secondary">⌘</IconButton>} defaultValue="pubkyauth://" /></FormExample>
                    <FormExample label="Empty"><Input placeholder="pubkyauth://" /></FormExample>
                    <FormExample label="Invalid" message="Enter a valid Pubky authorization link"><Input aria-invalid="true" defaultValue="https://example.com" /></FormExample>
                    <FormExample label="Disabled"><Input disabled defaultValue="pubkyauth://request" /></FormExample>
                </div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Avatars</h2>
                <div className="flex items-end gap-6 rounded-xl border bg-card p-6"><Avatar fallback="Satoshi Nakamoto" size="sm" /><Avatar fallback="Satoshi Nakamoto" /><Avatar fallback="Satoshi Nakamoto" size="lg" /></div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Identities</h2>
                <div className="grid max-w-[327px] gap-3">
                    <GoogleAccountCard account={{ id: "google-satoshi", email: "satoshi@gmail.com", name: "Satoshi Nakamoto", pictureUrl: null }} />
                    <IdentityRow detail="x8jp...4mra" name="Satoshi Nakamoto" provider="google" selected />
                    <IdentityRow detail="n31k...8pqz" name="Hal Finney" provider="google" />
                    <IdentityRow detail="local only" name="Alice" />
                </div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Permissions</h2>
                <div className="max-w-[327px]"><PermissionList><PermissionRow access="Read, write" path="/pub/pubky.app/" /><PermissionRow access="Read, write" path="/pub/paykit/" /></PermissionList></div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Provider buttons</h2>
                <div className="grid max-w-[327px] gap-3"><ProviderSignInButton provider="google">Continue with Google</ProviderSignInButton><ProviderSignInButton provider="apple">Continue with Apple</ProviderSignInButton><ProviderSignInButton provider="ring">Continue with Pubky Ring</ProviderSignInButton></div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Cards</h2>
                <div className="grid gap-5 sm:grid-cols-2">
                    <ExampleCard content footer />
                    <ExampleCard content />
                    <ExampleCard footer />
                    <ExampleCard />
                </div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Spinner states</h2>
                <div className="flex gap-8 rounded-xl border bg-card p-6">
                    {([1, 2, 3, 4] as const).map((step) => <PreviewCell key={step} label={`step ${step}`}><Spinner step={step} /></PreviewCell>)}
                </div>
            </section>

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Confirmation dialogs</h2>
                <div className="flex flex-wrap gap-4 rounded-xl border bg-card p-6">
                    <ConfirmationDialog actionLabel="Save changes" description="Review the changes before saving them." title="Save changes?" triggerLabel="Open dialog">
                        <p className="rounded-lg border border-dashed p-6 text-center text-sm">Dialog content</p>
                    </ConfirmationDialog>
                    <ConfirmationDialog actionLabel="Delete identity" description="This action cannot be undone." destructive title="Delete identity?" triggerLabel="Open destructive dialog" />
                </div>
            </section>

            {VARIANTS.map((variant) => (
                <section className="flex flex-col gap-5" key={variant}>
                    <h2 className="text-xl font-bold capitalize">{variant}</h2>
                    <div className="grid gap-6 rounded-xl border bg-card p-6 sm:grid-cols-2 lg:grid-cols-3">
                        {SIZES.map((size) => (
                            <PreviewCell key={size} label={size}>
                                <GalleryButton size={size} variant={variant} />
                            </PreviewCell>
                        ))}
                    </div>
                </section>
            ))}

            <section className="flex flex-col gap-5">
                <h2 className="text-xl font-bold">Disabled</h2>
                <div className="grid gap-6 rounded-xl border bg-card p-6 sm:grid-cols-2">
                    {VARIANTS.map((variant) => (
                        <PreviewCell key={variant} label={variant}>
                            <GalleryButton disabled size="lg" variant={variant} />
                        </PreviewCell>
                    ))}
                </div>
            </section>
        </main>
    );
}

function FormExample({ children, label, message }: { children: ReactNode; label: string; message?: string }) {
    return <div className="flex flex-col gap-2"><Label>{label}</Label>{children}{message && <FieldMessage error>{message}</FieldMessage>}</div>;
}

function ExampleCard({ content = false, footer = false }: { content?: boolean; footer?: boolean }) {
    return (
        <Card>
            <CardHeader><CardTitle>Title Text</CardTitle><CardDescription>This is a card description.</CardDescription></CardHeader>
            {content && <CardContent><ExampleSlot>Card content</ExampleSlot></CardContent>}
            {footer && <CardFooter><ExampleSlot>Card footer</ExampleSlot></CardFooter>}
        </Card>
    );
}

function ExampleSlot({ children }: { children: ReactNode }) {
    return <div className="w-full border border-dashed border-purple-500/50 bg-purple-500/10 p-6 text-center text-sm">{children}</div>;
}

function GalleryButton({
    size,
    variant,
    disabled = false,
}: {
    disabled?: boolean;
    size: (typeof SIZES)[number];
    variant: (typeof VARIANTS)[number];
}) {
    const { icon, label } = BUTTON_CONTENT[variant];

    if (size === "icon") {
        return (
            <Button aria-label={`${label} icon button`} disabled={disabled} size="icon" variant={variant}>
                {icon}
            </Button>
        );
    }

    return (
        <Button disabled={disabled} size={size} variant={variant}>
            {icon}
            {label}
        </Button>
    );
}

const BUTTON_CONTENT: Record<(typeof VARIANTS)[number], { icon: ReactNode; label: string }> = {
    default: { icon: <CheckIcon />, label: "Authorize" },
    destructive: { icon: <TrashIcon />, label: "Remove Google Access" },
    outline: { icon: <XIcon />, label: "Cancel" },
    secondary: { icon: <ScanIcon />, label: "Scan QR" },
};

function PreviewCell({ children, label }: { children: ReactNode; label: string }) {
    return (
        <div className="flex min-w-0 flex-col items-start gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            {children}
        </div>
    );
}
