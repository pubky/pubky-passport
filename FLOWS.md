# Runtime Flows

Current implementation. The home route is a development identity surface;
`/authorize` includes capability review, local Pubky identity selection, the
Google-backed custody/recovery strategy, approval, cancellation, callbacks, and
local terminal states.

```mermaid
flowchart TB
    accTitle: Runtime location color legend
    accDescr: Colorblind-safe legend for Next transport, React UI, browser runtime, server runtime, shared libraries, runtime platforms, and external systems.
    subgraph runtime[Runtime-facing code]
        direction LR
        transport["Next transport<br/>src/app, proxy.ts"]:::transport
        ui["React UI<br/>src/client/ui"]:::ui
        browser["Browser runtime<br/>src/client/browser"]:::browser
        server["Server runtime<br/>src/server"]:::server
    end

    subgraph supporting[Rules, helpers, and dependencies]
        direction LR
        libs["Shared helpers<br/>src/libs"]:::libs
        platform["Runtime platform<br/>browser, Next.js"]:::platform
        external["External package or service"]:::external
    end

    classDef transport fill:#F0E442,stroke:#8A7F00,color:#111827;
    classDef ui fill:#0072B2,stroke:#56B4E9,color:#fff;
    classDef browser fill:#009E73,stroke:#005A45,color:#111827;
    classDef server fill:#D55E00,stroke:#8A3C00,color:#111827;
    classDef libs fill:#475569,stroke:#cbd5e1,color:#fff;
    classDef platform fill:#6B7280,stroke:#374151,color:#fff;
    classDef external fill:#111827,stroke:#9ca3af,color:#fff;
```

## Import Boundaries

Arrows in this diagram only mean direct imports in current production code.

```mermaid
flowchart LR
    accTitle: Current production import boundaries
    accDescr: Direct imports from app pages and route handlers into UI, browser, server, libraries, and the Pubky SDK adapter.
    subgraph browserLane[Browser import lane]
        direction TB
        pages["src/app<br/>pages"]:::transport --> ui["src/client/ui"]:::ui --> browser["src/client/browser"]:::browser
        pages --> bootstrap["src/server/config<br/>browser bootstrap"]:::server
        ui --> browserLibs["src/libs"]:::libs
        browser --> browserLibs
        browser --> sdk["@synonymdev/pubky<br/>only via browser/pubky/pubkySdkAdapter.ts"]:::external
    end

    subgraph serverLane[Server import lane]
        direction TB
        routes["src/app/api<br/>route handlers"]:::transport --> server["src/server"]:::server
        proxy["proxy.ts"]:::transport --> server
        proxy --> bootstrap
        server --> bootstrap
        routes --> serverLibs["src/libs"]:::libs
    end

    classDef transport fill:#F0E442,stroke:#8A7F00,color:#111827;
    classDef ui fill:#0072B2,stroke:#56B4E9,color:#fff;
    classDef browser fill:#009E73,stroke:#005A45,color:#111827;
    classDef server fill:#D55E00,stroke:#8A3C00,color:#111827;
    classDef libs fill:#475569,stroke:#cbd5e1,color:#fff;
    classDef external fill:#111827,stroke:#9ca3af,color:#fff;
    linkStyle default stroke:#64748B,stroke-width:2.5px;
```

ESLint, `test-utils/architecture/architecture-boundaries.test.ts`, and the
`client-only` / `server-only` markers enforce targeted runtime and security
boundaries. These include browser/server isolation, stable UI browser entries,
approved environment access, SDK and persistence confinement, and sensitive parser
contract confinement. Feature-internal folder roles are not enforced.

## Routes

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `src/app/page.tsx::Home` | Development identity panel and manual auth entry. |
| `/authorize` | `src/app/authorize/page.tsx::AuthorizePage` | Review, approve, cancel, callbacks. |
| `GET /api/health` | `src/app/api/health/route.ts::GET` | Health response. |
| `POST /api/wrapping-key/google` | `src/app/api/wrapping-key/google/route.ts::POST` | Verify provider-account claims and derive a wrapping key. |

## Call Flows

In the remaining diagrams:

- Solid arrow: call or network request.
- Dashed arrow: return or result.

### `/authorize` Document Entry

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Authorization document entry call flow
    accDescr: Next emits authorization CSP without receiving the fragment, then the client scrubs and parses the SDK request for review.
    box rgba(17, 24, 39, 0.12) External
        participant App as Third-party requesting app
    end
    box rgba(107, 114, 128, 0.18) Runtime platforms
        participant Client as PLATFORM<br/>Passport tab<br/>(window, history, location)
        participant Next as PLATFORM<br/>Next.js request runtime
    end
    box rgba(240, 228, 66, 0.18) repository root
        participant Proxy as proxy.ts<br/>proxy()
    end
    box rgba(240, 228, 66, 0.18) src/app/authorize
        participant Page as page.tsx<br/>AuthorizePage()
    end
    box rgba(213, 94, 0, 0.18) src/server/content-security-policy
        participant CSP as policy.ts<br/>createContentSecurityPolicy()
    end
    box rgba(0, 114, 178, 0.18) src/client/ui
        participant Flow as authorizationFlow.tsx<br/>AuthorizationFlow()
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/authorization
        participant Bootstrap as browserAuthorizationBootstrap.ts<br/>pre-hydration entry capture
        participant Factory as passportAuthorization.ts<br/>createPassportAuthorizationController()
        participant Controller as passportAuthorizationController.ts<br/>PassportAuthorizationController
        participant Entry as browserAuthorizationEntry.ts<br/>readAndScrubAuthorizationEntry()<br/>clearPendingAuthorizationEntry()
        participant Request as browserAuthorizationRequest.ts<br/>parseBrowserAuthorizationRequest()
        participant Parser as parsePubkyAuthRequest.ts<br/>parsePubkyAuthRequest()
    end

    App->>Client: Open Passport /authorize#d=...
    Client->>Next: GET /authorize
    Next->>Proxy: proxy(request)
    Proxy->>CSP: createContentSecurityPolicy(allow HTTPS relays, nonce)
    CSP-->>Proxy: document CSP
    Proxy-->>Next: NextResponse.next + CSP headers
    Next->>Page: AuthorizePage()
    Page->>Flow: render client boundary with validated bootstrap values
    Next-->>Client: document + CSP + no-store + no-referrer
    Client->>Bootstrap: instrumentation-client module evaluation
    Bootstrap->>Entry: readAndScrubAuthorizationEntry(window)
    Entry->>Client: History.prototype.replaceState(current pathname, fragment removed)
    Entry->>Request: parse captured d
    Request->>Parser: parse and validate request
    Parser-->>Request: normalized request or typed error
    Request-->>Bootstrap: immutable safe review + private approval
    Client->>Flow: hydrate
    Flow->>Factory: createPassportAuthorizationController()
    Factory->>Bootstrap: takeBootstrappedAuthorizationEntry()
    Bootstrap-->>Factory: valid entry or invalid
    Factory->>Controller: new PassportAuthorizationController(...)
    Factory-->>Flow: controller with safe view state
    Flow->>Controller: commitInitialEntry()
    Controller->>Entry: clearPendingAuthorizationEntry(window)
```



### Manual Authorization

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Manual authorization call flow
    accDescr: The form validates and clears a pasted request before either showing a safe error or starting a full authorization document navigation.
    actor User
    box rgba(0, 114, 178, 0.18) src/client/ui
        participant Form as manualAuthorizationForm.tsx<br/>ManualAuthorizationForm()<br/>submit()
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/authorization
        participant Browser as browserManualAuthorization.ts<br/>enterAuthorization()
        participant Parser as parsePubkyAuthRequest.ts<br/>validatePubkyAuthRequest()
    end
    box rgba(107, 114, 128, 0.18) Runtime platforms
        participant Window as PLATFORM<br/>Passport tab window
        participant Next as PLATFORM<br/>Next.js request runtime
    end

    User->>Form: Submit pasted pubkyauth URL
    Form->>Browser: enterAuthorization(input)
    Browser->>Parser: validatePubkyAuthRequest(encodeURIComponent(input))
    Parser-->>Browser: validated request or typed error
    Note over Form: Clear textarea state
    alt Invalid
        Browser-->>Form: invalid
        Form-->>User: safe local error
    else Valid
        Browser->>Window: History.prototype.replaceState(/authorize#d=...) + reload
        Window->>Next: full document request
    end
```

### Approval

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Authorization approval call flow
    accDescr: Passport restores the active local key, asks the Pubky SDK to deliver approval, disposes key resources, and then resolves the validated outcome callback.
    actor User
    box rgba(0, 114, 178, 0.18) src/client/ui
        participant Review as authorizationReview.tsx<br/>AuthorizationReview()
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/authorization
        participant Controller as passportAuthorizationController.ts<br/>PassportAuthorizationController
        participant Composition as passportAuthorization.ts<br/>approveUsingActiveLocalIdentity()
        participant UseCase as approveAuthorizationWithActiveIdentity.ts<br/>approveAuthorizationWithActiveIdentity()
        participant AuthRequest as browserAuthorizationRequest.ts<br/>isPubkyAuthApprovalCapability()<br/>getValidatedAuthorizationCallbacks()
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/local
        participant Local as restoreActiveLocalIdentityKey.ts<br/>RestoreActiveLocalIdentityKey
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/local
        participant Repo as localStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/pubky
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.10.0<br/>Keypair / Signer
        participant Relay as Request-supplied HTTPS Relay<br/>Signer.approveAuthRequest() delivery
    end
    box rgba(107, 114, 128, 0.18) Browser platform
        participant Window as PLATFORM<br/>Passport tab window
    end

    User->>Review: Approve
    Review->>Controller: approve()
    Controller->>Composition: approveAuthorization(approval)
    Composition->>Pubky: new PubkySdkAdapter()
    Composition->>Local: new RestoreActiveLocalIdentityKey(repository.readActive, pubky)
    Composition->>UseCase: approveAuthorizationWithActiveIdentity(...)
    UseCase->>Local: restore()
    Local->>Repo: readActive()
    Repo-->>Local: public metadata + 32-byte secret
    Local->>Pubky: restoreIdentityKey(secret)
    Pubky->>SDK: Keypair.fromSecret(secret)
    SDK-->>Pubky: concrete Keypair
    Pubky-->>Local: opaque handle + public identity
    Note over Local: Compare persisted public metadata
    Local-->>UseCase: verified active identity
    UseCase->>Pubky: approveAuthRequest(handle, approval)
    Pubky->>AuthRequest: isPubkyAuthApprovalCapability(approval)
    AuthRequest-->>Pubky: browser approval provenance
    Pubky->>SDK: signer.approveAuthRequest(sensitive URL)
    Note over SDK,Relay: SDK emits a legacy AuthToken for signin or a PoP-bound signed grant for signin_grant; encryption and Relay delivery remain SDK-owned
    SDK-->>Pubky: completion or failure
    Pubky-->>UseCase: typed result
    UseCase->>Pubky: disposeIdentityKey(handle)
    UseCase-->>Composition: safe result
    Composition->>Pubky: dispose()
    Composition-->>Controller: safe result
    Controller->>AuthRequest: getValidatedAuthorizationCallbacks(approval)
    AuthRequest-->>Controller: success or error callback
    alt Callback exists and opener acknowledges
        Controller->>Window: post finite outcome to callback origin
        Window-->>Controller: exact-origin acknowledgement
        Controller->>Window: close popup
    else Callback exists without popup completion
        Controller->>Window: location.replace(callback) after timeout
    else No callback or completion fails
        Controller-->>Review: safe local terminal state
    end
```

### Cancellation

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Authorization cancellation call flow
    accDescr: Cancellation retrieves only the browser-owned validated cancel callback and closes a popup, redirects, or renders a local cancelled state without restoring a key.
    actor User
    box rgba(0, 114, 178, 0.18) src/client/ui
        participant Review as authorizationReview.tsx<br/>AuthorizationReview()
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/authorization
        participant Controller as passportAuthorizationController.ts<br/>PassportAuthorizationController
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/authorization
        participant Callbacks as browserAuthorizationRequest.ts<br/>getValidatedAuthorizationCallbacks()
    end
    box rgba(107, 114, 128, 0.18) Browser platform
        participant Window as PLATFORM<br/>Passport tab window
    end

    User->>Review: Cancel before approval
    Review->>Controller: cancel()
    Controller->>Callbacks: getValidatedAuthorizationCallbacks(approval)
    Callbacks-->>Controller: cancel callback or none
    alt Callback exists and opener acknowledges
        Controller->>Window: post cancel outcome to callback origin
        Window-->>Controller: exact-origin acknowledgement
        Controller->>Window: close popup
    else Callback exists without popup completion
        Controller->>Window: location.replace(callback) after timeout
    else No callback or completion fails
        Controller-->>Review: local cancelled state
    end
```

### Single Google Implicit Popup Flow

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Single Google implicit popup call flow
    accDescr: One user click requests identity and Drive scopes; the callback fragment is scrubbed during HTML parsing and credentials remain browser-only.
    actor User
    participant UI as src/client/ui/root<br/>GoogleIdentitySetupFlow
    box rgba(0, 158, 115, 0.18) src/client/browser/identity
        participant Controller as passportIdentityController.ts<br/>PassportIdentityController
        participant GoogleFlow as googleBackedIdentityFlow.ts<br/>GoogleBackedIdentityFlow
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/google-authorization
        participant Authorization as googleImplicitAuthorization.ts<br/>GoogleImplicitAuthorization
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/google-backed
        participant Operations as googleBackedIdentityOperations.ts<br/>GoogleBackedIdentityOperations
    end
    box rgba(17, 24, 39, 0.12) External
        participant OAuth as Google OAuth authorize endpoint
    end

    UI->>Controller: new PassportIdentityController(...)
    UI->>Controller: startGoogleIdentityFlow(onState)
    Controller->>GoogleFlow: new GoogleBackedIdentityFlow(...) + start()
    GoogleFlow->>Authorization: prepare()
    User->>UI: Continue with Google
    UI->>GoogleFlow: establishIdentity()
    GoogleFlow->>Authorization: request()
    Authorization->>OAuth: open popup with response_type=id_token token
    OAuth-->>Authorization: redirect to Passport callback with fragment
    Note over Authorization: Parser-time bootstrap scrubs fragment<br/>validate state, nonce, scope, and UserInfo sub
    Authorization-->>GoogleFlow: GoogleBackedIdentityCredentials
    GoogleFlow->>Operations: restoreOrCreateGoogleBackedIdentity<br/>(GoogleBackedIdentityCredentials)
```



### Restore Or Create Google-Backed Identity

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Google-backed custody/recovery establishment call flow
    accDescr: GoogleBackedIdentityOperations requests a wrapping key, reads the Google Drive Passport file, and dispatches a found file to restore or requests a Homegate invitation before creating a missing identity, without passing the wrapping key to Drive storage.
    box rgba(0, 158, 115, 0.18) src/client/browser/identity
        participant GoogleFlow as googleBackedIdentityFlow.ts<br/>GoogleBackedIdentityFlow
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/google-backed
        participant Operations as googleBackedIdentityOperations.ts<br/>GoogleBackedIdentityOperations
        participant Restore as restoreGoogleBackedIdentity.ts<br/>RestoreGoogleBackedIdentity
        participant Creator as createGoogleBackedIdentity.ts<br/>CreateGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/wrapping-key
        participant Wrapping as wrappingKeyApiClient.ts<br/>WrappingKeyApiClient
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/passport-file
        participant DriveStore as googleDrivePassportFileStore.ts<br/>GoogleDrivePassportFileStore
        participant VisibleWriter as googleDriveVisibleRecoveryCopyWriter.ts<br/>GoogleDriveVisibleRecoveryCopyWriter
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/homegate
        participant Invite as homegateClient.ts<br/>HomegateClient
    end
    box rgba(240, 228, 66, 0.18) src/app/api/wrapping-key/google
        participant API as handler.ts<br/>googleWrappingKeyPost()<br/>exported as route.ts::POST
    end
    box rgba(17, 24, 39, 0.12) External
        participant Drive as Google Drive API v3<br/>appDataFolder + My Drive
    end

    GoogleFlow->>Operations: restoreOrCreateGoogleBackedIdentity<br/>(GoogleBackedIdentityCredentials)
    Operations->>Wrapping: requestGoogleWrappingKey(ID token)
    Wrapping->>API: POST { googleIdToken }
    API-->>Wrapping: wrapping-key result
    Wrapping-->>Operations: wrapping-key result
    alt Wrapping-key error
        Operations-->>GoogleFlow: safe failure
    else Wrapping key
        Operations->>DriveStore: new GoogleDrivePassportFileStore(...)
        Operations->>DriveStore: readPassportFile()
        DriveStore->>Drive: list passport.json
        Drive-->>DriveStore: list response
        opt One file found
            DriveStore->>Drive: GET media for exact file ID
            Drive-->>DriveStore: media response body
            DriveStore->>DriveStore: bounded read + parsePassportFileContents()
            DriveStore->>Drive: GET metadata for exact file ID
            Drive-->>DriveStore: ID + name + version + trashed state
        end
        DriveStore-->>Operations: found, missing, or safe error
        alt Found
            Operations->>Restore: execute(envelope, wrapping key)
        else Missing
            Operations->>Invite: requestGoogleHomeserverSignupInvitation(ID token)
            Invite-->>Operations: validated invitation or safe failure
            opt Invitation returned
                Operations->>Creator: execute(invitation, focused app-data create, focused visible-copy write, wrapping key)
            end
        else Storage error
            Operations-->>GoogleFlow: safe failure
        end
    end
```



### Restore Existing Identity

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Existing identity restore call flow
    accDescr: Browser crypto decrypts the Passport file envelope, PubkySdkAdapter signs in with the restored key, and only a matching activated Pubky identity is saved locally; failures stop before later stages and cleanup runs after decryption succeeds.
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/google-backed
        participant Restore as restoreGoogleBackedIdentity.ts<br/>RestoreGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/local
        participant Local as saveLocalIdentity.ts<br/>SaveLocalIdentity
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/passport-file
        participant Crypto as passportFileWebCrypto.ts<br/>PassportFileWebCrypto
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/pubky
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/local
        participant Repo as localStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.10.0<br/>Keypair / Signer
    end

    Restore->>Crypto: decryptSecretKeyBytes(envelope, wrapping key, origin)
    Crypto-->>Restore: 32-byte Pubky secret or decrypt error
    alt Decrypt error
        Restore-->>Restore: decrypt_failed
    else Decrypted secret
        Restore->>Pubky: restoreIdentityKey(secret)
        Pubky->>SDK: Keypair.fromSecret(secret)
        SDK-->>Pubky: concrete Keypair or failure
        Pubky-->>Restore: opaque handle + public identity, or restore error
        alt Restore error
            Restore-->>Restore: restore_failed
        else Restored identity
            Restore->>Pubky: signin(handle)
            Pubky->>SDK: signer.signin("passport.pubky.app")
            SDK-->>Pubky: grant Session or failure
            Pubky-->>Restore: session public identity or signin error
            alt Sign-in error
                Restore-->>Restore: signin_failed
            else Session identity mismatch
                Restore-->>Restore: identity_mismatch
            else Matching session identity
                Pubky->>SDK: session.signout() to revoke the verification grant
                Restore->>Pubky: publishHomeserverIfStale(), retry once after failure
                Note over Pubky: Fresh resolution contains the SDK stale-CAS race without another session
                alt Publication still fails
                    Restore-->>Restore: discovery_failed
                else Discovery confirmed
                    Restore->>Local: saveIdentity(handle)
                Local->>Pubky: getPublicIdentity + exportSecretKey
                Pubky-->>Local: public metadata + secret
                Local->>Repo: save metadata + base64url secret
                Repo-->>Local: saved active identity or error
                Local-->>Restore: saved or local-save error
                alt Local-save error
                    Restore-->>Restore: local_save_failed
                else Saved
                    Restore-->>Restore: restored identity
                end
            end
        end
        Note over Restore,Pubky: finally zero secret bytes and dispose the restored handle if created
    end
    end
```

### Create Missing Identity: Encrypt And Store

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Missing identity encryption and Drive storage call flow
    accDescr: CreateGoogleBackedIdentity encrypts a new Pubky secret, creates the operational app-data file through GoogleDrivePassportFileStore, then best-effort writes a visible recovery copy through GoogleDriveVisibleRecoveryCopyWriter before activation and zeros the exported bytes.
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/google-backed
        participant Creator as createGoogleBackedIdentity.ts<br/>CreateGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/pubky
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/passport-file
        participant Crypto as passportFileWebCrypto.ts<br/>PassportFileWebCrypto
        participant DriveStore as googleDrivePassportFileStore.ts<br/>GoogleDrivePassportFileStore
        participant VisibleWriter as googleDriveVisibleRecoveryCopyWriter.ts<br/>GoogleDriveVisibleRecoveryCopyWriter
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.10.0<br/>Keypair
        participant Drive as Google Drive API v3<br/>appDataFolder/passport.json
    end

    Creator->>Pubky: createIdentityKey()
    Pubky->>SDK: Keypair.random()
    SDK-->>Pubky: concrete Keypair
    Pubky-->>Creator: opaque handle + public identity
    Creator->>Pubky: exportSecretKey(handle)
    Pubky-->>Creator: 32-byte secret
    Creator->>Crypto: encryptSecretKeyBytes(secret, wrapping key, origin)
    Crypto-->>Creator: encrypted envelope
    Creator->>DriveStore: createPassportFile(envelope)
    DriveStore->>Drive: pre-list passport.json
    Drive-->>DriveStore: pre-list response
    break Pre-list error
        Note over DriveStore: Preserve authorization, network, or response error
    end
    break Existing or duplicate
        Note over DriveStore: Result is create_conflict
    end
    DriveStore->>Drive: create-only multipart POST
    Drive-->>DriveStore: create response
    break Create failed or response malformed
        Note over DriveStore: Return write or invalid-response error
    end
    DriveStore->>Drive: post-list passport.json
    Drive-->>DriveStore: post-list response
    DriveStore-->>Creator: operational write completed or safe error
    Creator->>VisibleWriter: createVisibleRecoveryCopy(envelope, public Pubky)
    VisibleWriter->>Drive: find or create My Drive/Pubky Passport
    Drive-->>VisibleWriter: visible folder response
    VisibleWriter->>Drive: create-only {pubky}.json copy
    Drive-->>VisibleWriter: visible copy response
    VisibleWriter->>Drive: verify exact created file ID and revision
    Drive-->>VisibleWriter: exact metadata, parent, and trashed state
    Note over DriveStore,VisibleWriter: Operational reads and deletion remain appDataFolder-only
    VisibleWriter-->>Creator: confirmed creation or safe unconfirmed outcome
    Note over Creator: Zero exported secret bytes
    alt Operational storage error
        Creator->>Pubky: disposeIdentityKey(handle)
    else Visible copy warning
        Note over Creator: Continue activation; do not strand an unsigned-up appData identity
    else Stored
        Note over Creator: Key handle continues into activation
    end
```

### Create Missing Identity: Activate And Save

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Missing identity activation and local save call flow
    accDescr: GoogleBackedIdentityOperations requests a homeserver signup invitation, then CreateGoogleBackedIdentity signs up, verifies, publishes discovery, and saves in order; each failure stops later stages and the generated key handle is always disposed.
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/google-backed
        participant Operations as googleBackedIdentityOperations.ts<br/>GoogleBackedIdentityOperations
        participant Creator as createGoogleBackedIdentity.ts<br/>CreateGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/local
        participant Local as saveLocalIdentity.ts<br/>SaveLocalIdentity
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/homegate
        participant Invite as homegateClient.ts<br/>HomegateClient
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/pubky
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/client/browser/identity/local
        participant Repo as localStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.10.0<br/>Signer / PKDNS
        participant Homegate as Homegate<br/>/google_verification
    end

    Operations->>Invite: requestGoogleHomeserverSignupInvitation(ID token)
    Invite->>Homegate: POST { googleIdToken }
    Homegate-->>Invite: invitation or plaintext error
    alt Homegate error
        Invite-->>Operations: safe invitation failure
    else Invitation response
        Note over Invite: Parse exact bounded response
        Invite-->>Operations: validated invitation
        Operations->>Creator: execute(validated invitation)
        Creator->>Pubky: signup(handle, homeserver, signup code)
        Pubky->>SDK: signer.signup(...)
        Note over SDK: Homeserver signup transport is SDK-owned
        SDK-->>Pubky: completion or failure
        Pubky-->>Creator: key-derived public identity or signup error
        alt Signup error
            Creator-->>Creator: signup_failed
        else Session identity mismatch
            Creator-->>Creator: identity_mismatch
        else Matching session identity
            Creator->>Pubky: publishHomeserverIfStale(...)
            Pubky->>SDK: signer.pkdns.publishHomeserverIfStale(...)
            Note over SDK: PKDNS / PKARR publication transport is SDK-owned
            SDK-->>Pubky: completion or failure
            Pubky-->>Creator: completion or discovery error
            alt Discovery error
                Creator-->>Creator: discovery_failed
            else Discovery complete
                Creator->>Local: saveIdentity(handle)
                Local->>Pubky: getPublicIdentity + exportSecretKey
                Pubky-->>Local: public metadata + secret
                Local->>Repo: save metadata + base64url secret
                Repo-->>Local: saved active identity or error
                Local-->>Creator: saved active identity or local-save error
                alt Local-save error
                    Creator-->>Creator: local_save_failed
                else Saved
                    Creator-->>Creator: created identity
                end
            end
        end
    end
    Note over Creator,Pubky: finally dispose the generated key handle on every outcome
```

Local ready state is saved last. Setup cannot be atomic across Drive, Homegate,
homeserver signup, and discovery. A definite homeserver signup invitation failure
occurs before Passport file creation. After signup or discovery has been attempted,
Passport preserves the encrypted Passport file so the key is not lost, disposes the
key handle, and saves no ready local Pubky identity; it must not automatically delete the
file. `preservedPassportFileIdentity` may carry only public identity metadata after
creation stores the encrypted file or restore successfully decrypts it. This does not
prove setup was partial. The explicit resume path obtains fresh Google credentials,
restores and verifies that same encrypted key, requests a new Homegate invitation, and
reuses normal signup, discovery, and local activation without deleting the backup or
creating a replacement key.

### Detach from Google

Detachment uses the same single Google implicit popup flow as setup. The selected
Google account must match the account stored on the local identity before any Drive
request is made.

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Detach a Pubky identity from Google
    accDescr: Passport verifies the account and identity, deletes every Google backup, and clears the local identity last.
    participant UI as detach-from-google
    participant GoogleFlow as GoogleBackedIdentityFlow
    participant Delete as DeleteGoogleIdentityBackups
    participant AppData as GoogleDrivePassportFileStore
    participant Visible as GoogleDriveVisibleRecoveryCopyDeleter
    participant Drive as Google Drive API v3
    participant Local as LocalStorageIdentityRepository

    UI->>GoogleFlow: detachIdentity(public identity, expected Google account)
    GoogleFlow->>GoogleFlow: request Google credentials
    alt Authorized account differs
        GoogleFlow-->>UI: authorization_failed
    else Account matches
        GoogleFlow->>Delete: deleteGoogleIdentityBackups(...)
        Delete->>AppData: readPassportFile()
        AppData->>Drive: find appDataFolder/passport.json
        alt App-data file found
            Drive-->>Delete: encrypted envelope + exact reference
            Delete->>Delete: wrapping key, decrypt, and verify Pubky
        else App-data file missing
            Drive-->>Delete: missing
            Note over Delete: Account binding still protects visible cleanup
        end
        Delete->>Visible: deleteVisibleRecoveryCopies(pubky)
        Visible->>Drive: list every accessible root Pubky Passport folder
        Visible->>Drive: delete every exact {pubky}.json match
        Delete->>AppData: delete exact verified reference when present
        AppData->>Drive: validate revision and delete passport.json
        alt Any verification or Drive cleanup fails
            Delete-->>UI: safe retryable failure
            Note over Local: Local identity remains available
        else All Google backups removed
            GoogleFlow->>Local: remove identity
            GoogleFlow-->>UI: detachment complete
        end
    end
```

## Server APIs

### Wrapping Key

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Google wrapping-key API call flow
    accDescr: The route validates its request, verifies provider-account claims, applies a keyed identity rate limit, and derives a wrapping key with HKDF.
    box rgba(0, 158, 115, 0.18) Browser runtime
        participant Browser as BROWSER<br/>WrappingKeyApiClient
    end
    box rgba(240, 228, 66, 0.18) Next transport
        participant Handler as APP<br/>wrapping-key handler
        participant Policy as APP<br/>routePolicy
    end
    box rgba(213, 94, 0, 0.18) Server
        participant Request as SERVER<br/>GoogleWrappingKeyRequest
        participant Verifier as SERVER<br/>GoogleIdTokenVerifier
        participant Limiter as SERVER<br/>InMemoryGoogleWrappingKeyRateLimiter
        participant Deriver as SERVER<br/>GoogleWrappingKeyDeriver
    end
    box rgba(17, 24, 39, 0.12) External
        participant Google as google-auth-library / Google
        participant Ticket as google-auth-library<br/>LoginTicket
    end

    Browser->>Handler: POST { googleIdToken }
    Handler->>Policy: parseGoogleWrappingKeyRequest(request)
    Policy-->>Handler: Google ID token or invalid_request
    alt Invalid request
        Handler-->>Browser: fixed 400 invalid_request
    else Valid Google ID token
        Handler->>Request: requestGoogleWrappingKey(token)
        Request->>Verifier: verifyGoogleIdToken(token)
        Verifier->>Google: verifyIdToken(token, audience)
        Google-->>Verifier: LoginTicket
        Verifier->>Ticket: getPayload()
        Ticket-->>Verifier: token payload
        Note over Verifier: Validate issuer + audience/azp + expiry + sub
        Verifier-->>Request: verified identity or safe error
        alt Verification error
            Request-->>Handler: safe authentication error
        else Verified identity
            Request->>Limiter: tryConsumeRequest(identity)
            Limiter-->>Request: allowed or rate-limited
            alt Rate-limited
                Request-->>Handler: rate_limited
            else Allowed
                Request->>Deriver: deriveWrappingKey(identity)
                Deriver-->>Request: 32-byte base64url key
                Request-->>Handler: wrapping key
            end
        end
        Handler-->>Browser: fixed JSON response
    end
    Note over Handler,Browser: Every response includes no-store and no-referrer
```

### Homegate Signup Invitation

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Direct browser Homegate signup invitation call flow
    accDescr: The browser adapter sends only the Google ID token directly to configured Homegate, then bounds and maps the invitation or plaintext error to a safe application result.
    box rgba(0, 158, 115, 0.18) Browser runtime
        participant UseCase as APPLICATION<br/>GoogleBackedIdentityOperations
        participant Adapter as BROWSER<br/>HomegateClient
    end
    box rgba(17, 24, 39, 0.12) External
        participant Homegate as Homegate
    end

    UseCase->>Adapter: requestGoogleHomeserverSignupInvitation(ID token)
    alt Empty or oversized token
        Adapter-->>UseCase: homegate_invalid_request
    else Valid bounded token
        Adapter->>Homegate: POST /google_verification<br/>{ googleIdToken }
        Note over Adapter,Homegate: credentials omitted, no-referrer, no-store
        Homegate-->>Adapter: invitation JSON or plaintext error
        Note over Adapter: Bound body and parse exact response shape
        Adapter-->>UseCase: neutral invitation or safe typed error
    end
```

## Reviewer Index

| Flow | Code | Main tests |
| --- | --- | --- |
| Authorization parser | `src/client/browser/authorization` | Colocated parser and URL validation tests |
| Authorization controller and approval | `src/client/browser/authorization` | Colocated request, controller, composition, and approval tests |
| Authorization browser entry | `src/client/browser/authorization/browserAuthorizationEntry.ts` | `browserAuthorizationEntry.test.ts` |
| Authorization UI | `src/client/ui/authorization` | Colocated component tests |
| Identity controller | `src/client/browser/identity` | Controller and factory tests |
| Google credential capabilities | `src/client/browser/google-authorization` | Colocated implicit OAuth and callback-scrubbing tests |
| Google-backed custody/recovery lifecycle | `src/client/browser/identity/google-backed` | Colocated operation tests |
| Drive store and WebCrypto | `src/client/browser/passport-file` | Colocated store and crypto tests |
| Pubky SDK adapter | `src/client/browser/pubky/pubkySdkAdapter.ts` | `pubkySdkAdapter.test.ts` |
| Wrapping-key API | `src/app/api/wrapping-key/google`, `src/server/wrapping-key/google` | Route and server tests |
| Browser bootstrap config | `src/server/config/browserBootstrapConfig.ts` | `browserBootstrapConfig.test.ts`, proxy tests |
| Homegate signup invitation | `src/client/browser/homegate/homegateClient.ts` | `homegateClient.test.ts` |
| CSP and boundaries | `proxy.ts`, `next.config.mjs`, architecture test | Proxy, header, and targeted boundary tests |
