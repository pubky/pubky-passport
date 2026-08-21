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
        browser["Browser runtime<br/>src/client/logic"]:::browser
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
        pages["src/app<br/>pages"]:::transport --> ui["src/client/ui"]:::ui --> browser["src/client/logic"]:::browser
        pages --> bootstrap["src/server/config<br/>browser bootstrap"]:::server
        ui --> browserLibs["src/libs"]:::libs
        browser --> browserLibs
        browser --> sdk["@synonymdev/pubky<br/>only via logic/pubky/PubkySdkAdapter.ts"]:::external
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
boundaries. These include browser/server isolation, approved environment access,
SDK and persistence confinement, secret-bearing UI
capability confinement, and sensitive parser contract confinement. Feature-internal
folder roles are not enforced.

## Routes

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `src/app/page.tsx::Home` | Development identity panel and manual auth entry. |
| `/authorize` | `src/app/authorize/page.tsx::AuthorizePage` | Review, approve, cancel, callbacks. |
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
    box rgba(0, 158, 115, 0.18) src/client/logic/authorization/{entry,request,flow}
        participant Bootstrap as authorizationEntryBootstrap.ts<br/>pre-hydration entry capture
        participant Controller as PassportAuthorizationController.ts<br/>PassportAuthorizationController
        participant Entry as authorizationEntry.ts<br/>readAndScrubAuthorizationEntry()
        participant Request as IssuedPubkyAuthRequest.ts<br/>IssuedPubkyAuthRequest.issue()
        participant Parser as pubkyAuthRequestParser.ts<br/>parseEncodedPubkyAuthRequest()
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
    Entry->>Request: IssuedPubkyAuthRequest.issue(captured d)
    Request->>Parser: parse and validate request
    Parser-->>Request: normalized request or typed error
    Request-->>Bootstrap: exact issued request with safe review
    Client->>Flow: hydrate
    Flow->>Controller: new PassportAuthorizationController()
    Controller->>Bootstrap: takeInitialAuthorizationEntry()
    Bootstrap-->>Controller: valid entry or invalid
    Note over Controller: Retain review only until the original entry deadline
    Controller-->>Flow: controller with safe view state
```



### Manual Authorization

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Manual authorization call flow
    accDescr: The form validates and clears a pasted request before either showing a safe error or starting a full authorization document navigation.
    actor User
    box rgba(0, 114, 178, 0.18) src/client/ui
        participant Form as manualAuthorization.tsx<br/>ManualAuthorization()<br/>submit()
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/authorization/{entry,request}
        participant ManualInput as manualAuthorizationInput.ts<br/>submitManualAuthorizationInput()
        participant Request as IssuedPubkyAuthRequest.ts<br/>IssuedPubkyAuthRequest.validate()
    end
    box rgba(107, 114, 128, 0.18) Runtime platforms
        participant Window as PLATFORM<br/>Passport tab window
        participant Next as PLATFORM<br/>Next.js request runtime
    end

    User->>Form: Submit pasted pubkyauth URL
    Form->>ManualInput: submitManualAuthorizationInput(input)
    ManualInput->>Request: IssuedPubkyAuthRequest.validate(encoded input)
    Request-->>ManualInput: validation success or typed error
    Note over Form: Clear the uncontrolled input before validation
    alt Invalid
        ManualInput-->>Form: invalid
        Form-->>User: safe local error
    else Valid
        ManualInput->>Window: History.prototype.replaceState(/authorize#d=...) + reload
        Window->>Next: full document request
    end
```

### Approval

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Authorization approval call flow
    accDescr: Passport restores the identity shown during review, asks the Pubky SDK to deliver approval, disposes key resources, and then resolves the validated outcome callback.
    actor User
    box rgba(0, 114, 178, 0.18) src/client/ui
        participant Review as authorizationReview.tsx<br/>AuthorizationReview()
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/authorization/flow
        participant Controller as PassportAuthorizationController.ts<br/>PassportAuthorizationController
        participant UseCase as approveAuthorization.ts<br/>approveAuthorization()
        participant Handoff as authorizationOutcomeHandoff.ts<br/>handoffAuthorizationOutcome()
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/authorization/request
        participant AuthRequest as IssuedPubkyAuthRequest.ts<br/>validatedUrlForApproval()<br/>takeOutcomeCallback()
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/local-identity
        participant Repo as LocalStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/pubky
        participant Pubky as PubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.10.0<br/>Keypair / Signer
        participant Relay as Request-supplied HTTPS Relay<br/>Signer.approveAuthRequest() delivery
    end
    box rgba(107, 114, 128, 0.18) Runtime platform
        participant Window as PLATFORM<br/>Passport tab window
    end

    User->>Review: Approve
    Review->>Controller: approve(displayed publicKeyZ32)
    Controller->>UseCase: approveAuthorization(issued request, publicKeyZ32, expiresAt)
    UseCase->>Pubky: new PubkySdkAdapter()
    UseCase->>Repo: read(publicKeyZ32)
    Repo-->>UseCase: public metadata + 32-byte secret
    UseCase->>Pubky: restoreIdentityKey(secret)
    Pubky->>SDK: Keypair.fromSecret(secret)
    SDK-->>Pubky: concrete Keypair
    Pubky-->>UseCase: opaque handle + public identity
    Note over UseCase: Compare persisted public metadata and clear secret bytes
    Note over UseCase: Recheck the original request deadline before SDK approval
    UseCase->>Pubky: approveAuthRequest(handle, issued request)
    Pubky->>AuthRequest: isLive() + validatedUrlForApproval()
    AuthRequest-->>Pubky: exact-request provenance + sensitive URL
    Pubky->>SDK: signer.approveAuthRequest(sensitive URL)
    Note over SDK,Relay: SDK emits a legacy AuthToken for signin or a PoP-bound signed grant for signin_grant; encryption and Relay delivery remain SDK-owned
    SDK-->>Pubky: completion or failure
    Pubky-->>UseCase: typed result
    UseCase->>Pubky: disposeIdentityKey(handle)
    UseCase->>Pubky: dispose()
    UseCase-->>Controller: safe result
    Controller->>AuthRequest: takeOutcomeCallback(outcome)
    AuthRequest-->>Controller: success or error callback
    Controller->>Handoff: handoffAuthorizationOutcome(callback, outcome)
    alt Callback exists and opener acknowledges
        Handoff->>Window: post finite outcome to callback origin
        Window-->>Handoff: exact-origin acknowledgement
        Handoff->>Window: close popup
    else Popup handoff is unavailable, fails, or times out
        Handoff->>Window: location.replace(callback)
    else No callback or completion fails
        Controller-->>Review: safe local terminal state
    end
```

### Cancellation

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Authorization cancellation call flow
    accDescr: Cancellation takes only the validated cancel callback and closes a popup, redirects, or renders a local cancelled state without restoring a key.
    actor User
    box rgba(0, 114, 178, 0.18) src/client/ui
        participant Review as authorizationReview.tsx<br/>AuthorizationReview()
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/authorization/flow
        participant Controller as PassportAuthorizationController.ts<br/>PassportAuthorizationController
        participant Handoff as authorizationOutcomeHandoff.ts<br/>handoffAuthorizationOutcome()
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/authorization/request
        participant Request as IssuedPubkyAuthRequest.ts<br/>takeOutcomeCallback()
    end
    box rgba(107, 114, 128, 0.18) Runtime platform
        participant Window as PLATFORM<br/>Passport tab window
    end

    User->>Review: Cancel before approval
    Review->>Controller: cancel()
    Controller->>Request: takeOutcomeCallback(cancel)
    Request-->>Controller: cancel callback or none
    Controller->>Handoff: handoffAuthorizationOutcome(callback, cancel)
    alt Callback exists and opener acknowledges
        Handoff->>Window: post cancel outcome to callback origin
        Window-->>Handoff: exact-origin acknowledgement
        Handoff->>Window: close popup
    else Popup handoff is unavailable, fails, or times out
        Handoff->>Window: location.replace(callback)
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
    participant UI as src/client/ui/onboarding/google<br/>useGoogleSignIn
    box rgba(0, 158, 115, 0.18) src/client/logic/google-identity
        participant GoogleController as GoogleIdentityController.ts<br/>GoogleIdentityController
        participant Operations as GoogleIdentityOperations.ts<br/>GoogleIdentityOperations
        participant Authorization as GoogleImplicitAuthorization.ts<br/>GoogleImplicitAuthorization
    end
    box rgba(17, 24, 39, 0.12) External
        participant OAuth as Google OAuth authorize endpoint
    end

    UI->>GoogleController: new GoogleIdentityController(configuration, onState)
    User->>UI: Continue with Google
    UI->>GoogleController: establishIdentity()
    GoogleController->>Authorization: request()
    Authorization->>OAuth: open popup with response_type=id_token token
    OAuth-->>Authorization: redirect to Passport callback with fragment
    Note over Authorization: Parser-time bootstrap scrubs fragment<br/>validate state, nonce, scope, and UserInfo sub
    Authorization-->>GoogleController: GoogleIdentityCredentials
    GoogleController->>Operations: establishIdentity(GoogleIdentityCredentials)
```



### Restore Or Create Google-Backed Identity

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Google-backed custody/recovery establishment call flow
    accDescr: GoogleIdentityOperations reads the Google Drive Passport file first, then requests a wrapping key and either restores the found identity or requests a Homegate invitation before creating a missing identity, without passing the wrapping key to Drive storage.
    box rgba(0, 158, 115, 0.18) src/client/logic/google-identity
        participant GoogleController as GoogleIdentityController.ts<br/>GoogleIdentityController
        participant Operations as GoogleIdentityOperations.ts<br/>GoogleIdentityOperations
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/wrapping-key
        participant Wrapping as WrappingKeyApiClient.ts<br/>WrappingKeyApiClient
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/passport-file
        participant DriveStore as google/PassportFileStore.ts<br/>GoogleDrivePassportFileStore
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/homegate
        participant Invite as HomegateClient.ts<br/>HomegateClient
    end
    box rgba(240, 228, 66, 0.18) src/app/api/wrapping-key/google
        participant API as handler.ts<br/>googleWrappingKeyPost()<br/>exported as route.ts::POST
    end
    box rgba(17, 24, 39, 0.12) External
        participant Drive as Google Drive API v3<br/>appDataFolder + My Drive
    end

    GoogleController->>Operations: establishIdentity(GoogleIdentityCredentials)
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
        Operations->>Wrapping: requestGoogleWrappingKey(ID token)
        Wrapping->>API: POST { googleIdToken }
        API-->>Wrapping: wrapping-key result
        Wrapping-->>Operations: wrapping-key result
        alt Wrapping-key error
            Operations-->>GoogleController: safe failure
        else Wrapping key
            Operations->>Operations: restoreIdentity(envelope, wrapping key)
        end
    else Missing
        Operations->>Wrapping: requestGoogleWrappingKey(ID token)
        Wrapping->>API: POST { googleIdToken }
        API-->>Wrapping: wrapping-key result
        Wrapping-->>Operations: wrapping-key result
        alt Wrapping-key error
            Operations-->>GoogleController: safe failure
        else Wrapping key
            Operations->>Invite: requestGoogleHomeserverSignupInvitation(ID token)
            Invite-->>Operations: validated invitation or safe failure
            opt Invitation returned
                Operations->>Operations: createIdentity(invitation, wrapping key)
            end
        end
    else Storage error
        Operations-->>GoogleController: safe failure
    end
```



### Restore Existing Identity

Identity establishment reports discriminated progress as `{ flow, step }`. The
`lookup`, `create`, `restore`, and `repair` flows each expose only their valid steps,
so the UI cannot receive an invalid cross-flow phase combination.

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Existing identity restore call flow
    accDescr: GoogleIdentityOperations decrypts the Passport file and tries normal blocking sign-in first, then uses Homegate signup to distinguish a missing account from an existing account before publishing PKDNS and verifying sign-in.
    box rgba(0, 158, 115, 0.18) src/client/logic/google-identity
        participant Operations as GoogleIdentityOperations.ts<br/>GoogleIdentityOperations
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/passport-file
        participant Crypto as PassportFileWebCrypto.ts<br/>PassportFileWebCrypto
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/pubky
        participant Pubky as PubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/local-identity
        participant Repo as LocalStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.10.0<br/>Keypair / Signer
    end

    Operations->>Crypto: decryptSecretKeyBytes(envelope, wrapping key, origin)
    Crypto-->>Operations: 32-byte Pubky secret or decrypt error
    alt Decrypt error
        Operations-->>Operations: decrypt_failed
    else Decrypted secret
        Operations->>Pubky: restoreIdentityKey(secret)
        Pubky->>SDK: Keypair.fromSecret(secret)
        SDK-->>Pubky: concrete Keypair or failure
        Pubky-->>Operations: opaque handle + public identity, or restore error
        alt Restore error
            Operations-->>Operations: restore_failed
        else Restored identity
            Operations->>Pubky: signin(handle)
            Pubky->>SDK: signer.signinBlocking("passport.pubky.app")
            SDK-->>Pubky: grant Session or safe failure
            opt Normal sign-in fails
                Operations->>Operations: request Homegate invitation<br/>and run shared signupAndActivate()
                Note over Operations,Pubky: Signup success creates the account;<br/>account_exists confirms it exists;<br/>signup_uncertain is verified by final sign-in
                Note over Operations,Pubky: Reuse the restored key for explicit<br/>publication and final sign-in
            end
            alt Session identity mismatch
                Operations-->>Operations: identity_mismatch
            else Matching verified identity
                Operations->>Pubky: exportSecretKey(handle)
                Pubky-->>Operations: secret bytes
                Operations->>Repo: save metadata + base64url secret
                Repo-->>Operations: saved active identity or error
                alt Local-save error
                    Operations-->>Operations: local_save_failed
                else Saved
                    Operations-->>Operations: restored identity
                end
            end
        end
        Note over Operations,Pubky: finally zero secret bytes and dispose the restored handle if created
    end
    end
```

### Create Missing Identity: Encrypt And Store

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Missing identity encryption and Drive storage call flow
    accDescr: GoogleIdentityOperations encrypts a new Pubky secret, creates the operational app-data file through GoogleDrivePassportFileStore, then best-effort writes a visible recovery copy through GoogleDriveVisibleRecoveryCopies before activation and zeros the exported bytes.
    box rgba(0, 158, 115, 0.18) src/client/logic/google-identity
        participant Operations as GoogleIdentityOperations.ts<br/>GoogleIdentityOperations
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/pubky
        participant Pubky as PubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/passport-file
        participant Crypto as PassportFileWebCrypto.ts<br/>PassportFileWebCrypto
        participant DriveStore as google/PassportFileStore.ts<br/>GoogleDrivePassportFileStore
        participant VisibleCopies as google/VisibleRecoveryCopies.ts<br/>GoogleDriveVisibleRecoveryCopies
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.10.0<br/>Keypair
        participant Drive as Google Drive API v3<br/>appDataFolder/passport.json
    end

    Operations->>Pubky: createIdentityKey()
    Pubky->>SDK: Keypair.random()
    SDK-->>Pubky: concrete Keypair
    Pubky-->>Operations: opaque handle + public identity
    Operations->>Pubky: exportSecretKey(handle)
    Pubky-->>Operations: 32-byte secret
    Operations->>Crypto: encryptSecretKeyBytes(secret, wrapping key, origin)
    Crypto-->>Operations: encrypted envelope
    Operations->>DriveStore: createPassportFile(envelope)
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
    DriveStore-->>Operations: operational write completed or safe error
    Operations->>VisibleCopies: createVisibleRecoveryCopy(envelope, public Pubky)
    VisibleCopies->>Drive: find or create My Drive/Pubky Passport
    Drive-->>VisibleCopies: visible folder response
    VisibleCopies->>Drive: create-only {pubky}.json copy
    Drive-->>VisibleCopies: visible copy response
    VisibleCopies->>Drive: verify exact created file ID and revision
    Drive-->>VisibleCopies: exact metadata, parent, and trashed state
    Note over DriveStore,VisibleCopies: Operational reads and deletion remain appDataFolder-only
    VisibleCopies-->>Operations: confirmed creation or safe unconfirmed outcome
    Note over Operations: Zero exported secret bytes
    alt Operational storage error
        Operations->>Pubky: disposeIdentityKey(handle)
    else Visible copy warning
        Note over Operations: Continue activation; do not strand an unsigned-up appData identity
    else Stored
        Note over Operations: Key handle continues into activation
    end
```

### Create Missing Identity: Activate And Save

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Missing identity activation and local save call flow
    accDescr: GoogleIdentityOperations requests a homeserver signup invitation, then uses its shared signup-and-activation method for both fresh creation and interrupted setup recovery.
    box rgba(0, 158, 115, 0.18) src/client/logic/google-identity
        participant Operations as GoogleIdentityOperations.ts<br/>GoogleIdentityOperations
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/homegate
        participant Invite as HomegateClient.ts<br/>HomegateClient
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/pubky
        participant Pubky as PubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/client/logic/local-identity
        participant Repo as LocalStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
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
        Operations->>Operations: signupAndActivate(validated invitation)
        Operations->>Pubky: signup(handle, homeserver, signup code)
        Pubky->>SDK: signer.signup(...)
        Note over SDK: Homeserver signup transport is SDK-owned
        SDK-->>Pubky: completion or failure
        Pubky-->>Operations: created, account_exists, signup_uncertain, or failure
        alt Definitive signup rejection
            Operations-->>Operations: signup_failed
        else Created, existing, or ambiguous
            Operations->>Pubky: publishHomeserver(...)
            Pubky->>SDK: signer.pkdns.publishHomeserverForce(...)
            Note over SDK: PKDNS / PKARR publication transport is SDK-owned
            SDK-->>Pubky: completion or failure
            Pubky-->>Operations: completion or uncertain publication error
            Operations->>Pubky: signin(handle)
            Pubky->>SDK: signer.signinBlocking("passport.pubky.app")
            SDK-->>Pubky: verified Session or safe failure
            Pubky-->>Operations: matching public identity or safe failure
            alt Sign-in cannot verify signup or publication
                Operations-->>Operations: signup_failed, discovery_failed, or signin_failed
            else Verified identity
                Operations->>Pubky: exportSecretKey(handle)
                Pubky-->>Operations: secret bytes
                Operations->>Repo: save metadata + base64url secret
                Repo-->>Operations: saved active identity or error
                alt Local-save error
                    Operations-->>Operations: local_save_failed
                else Saved
                    Operations-->>Operations: active identity
                end
            end
        end
    end
    Note over Operations,Pubky: finally dispose the generated or restored key handle on every outcome
```

Local ready state is saved last. Setup cannot be atomic across Drive, Homegate,
homeserver signup, and discovery. A definite homeserver signup invitation failure
occurs before Passport file creation. After signup or discovery has been attempted,
Passport preserves the encrypted Passport file so the key is not lost, disposes the
key handle, and saves no ready local Pubky identity; it must not automatically delete
the file. A later normal establishment retry restores that same key. Restore first
attempts normal sign-in. After a failed sign-in, automatic homeserver reconciliation
only starts when PKDNS resolution definitively confirms that no homeserver record exists.
An existing record or uncertain resolution fails without requesting another invitation.
Exact signup `409` confirms the account already exists; successful signup creates a
missing account; an uncertain signup result is verified by final sign-in. The
Homegate homeserver is then force-published and
blocking sign-in must verify the account and identity before local activation. A
publication error is treated as uncertain because a relay may have accepted the
record; successful blocking sign-in confirms it without requiring another user retry.

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
    participant GoogleController as GoogleIdentityController
    participant Operations as GoogleIdentityOperations
    participant DriveStore as GoogleDrivePassportFileStore
    participant VisibleCopies as GoogleDriveVisibleRecoveryCopies
    participant Drive as Google Drive API v3
    participant Local as LocalStorageIdentityRepository

    UI->>GoogleController: detachIdentity(public identity, expected Google account)
    GoogleController->>GoogleController: request Google credentials
    alt Authorized account differs
        GoogleController-->>UI: authorization_failed
    else Account matches
        GoogleController->>Operations: detachIdentity(...)
        Operations->>DriveStore: readPassportFile()
        DriveStore->>Drive: find appDataFolder/passport.json
        alt App-data file found
            Drive-->>Operations: encrypted envelope + exact reference
            Operations->>Operations: wrapping key, decrypt, and verify Pubky
        else App-data file missing
            Drive-->>Operations: missing
            Note over Operations: Account binding still protects visible cleanup
        end
        Operations->>VisibleCopies: deleteVisibleRecoveryCopies(pubky)
        VisibleCopies->>Drive: list every accessible root Pubky Passport folder
        VisibleCopies->>Drive: delete every exact {pubky}.json match
        Operations->>DriveStore: delete exact verified reference when present
        DriveStore->>Drive: validate revision and delete passport.json
        alt Any verification or Drive cleanup fails
            Operations-->>UI: safe retryable failure
            Note over Local: Local identity remains available
        else All Google backups removed
            Operations->>Local: remove identity
            GoogleController-->>UI: detachment complete
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
        participant UseCase as APPLICATION<br/>GoogleIdentityOperations
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
| Authorization request model | `src/client/logic/authorization/request/IssuedPubkyAuthRequest.ts` | Issuance, parser, capability, and URL tests |
| Authorization controller and approval | `src/client/logic/authorization/flow` | Controller, approval, and outcome handoff tests |
| Authorization entry | `src/client/logic/authorization/entry/authorizationEntry.ts` | `authorizationEntry.test.ts` |
| Authorization UI | `src/client/ui/authorization` | Colocated component tests |
| Local identity controller | `src/client/logic/local-identity` | Controller and repository tests |
| Google OAuth and custody/recovery lifecycle | `src/client/logic/google-identity` | Colocated authorization, flow, and operation tests |
| Drive store and WebCrypto | `src/client/logic/passport-file` | Colocated store and crypto tests |
| Pubky SDK adapter | `src/client/logic/pubky/PubkySdkAdapter.ts` | `pubkySdkAdapter.test.ts` |
| Wrapping-key API | `src/app/api/wrapping-key/google`, `src/server/wrapping-key/google` | Route and server tests |
| Browser bootstrap config | `src/server/config/browserBootstrapConfig.ts` | `browserBootstrapConfig.test.ts`, proxy tests |
| Homegate signup invitation | `src/client/logic/homegate/HomegateClient.ts` | `homegateClient.test.ts` |
| CSP and boundaries | `proxy.ts`, `next.config.mjs`, architecture test | Proxy, header, and targeted boundary tests |
