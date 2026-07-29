# Runtime Flows

Current implementation. The home route is a development identity surface;
`/authorize` includes capability review, local identity selection, Google-backed
create or restore, approval, cancellation, callbacks, and local terminal states.

```mermaid
flowchart TB
    accTitle: Runtime location color legend
    accDescr: Colorblind-safe legend for Next transport, React UI, browser runtime, server runtime, pure core, shared libraries, runtime platforms, and external systems.
    subgraph runtime[Runtime-facing code]
        direction LR
        transport["Next transport<br/>src/app, proxy.ts"]:::transport
        ui["React UI<br/>src/ui"]:::ui
        browser["Browser runtime<br/>src/browser"]:::browser
        server["Server runtime<br/>src/server"]:::server
    end

    subgraph supporting[Rules, helpers, and dependencies]
        direction LR
        core["Pure rules<br/>src/core"]:::core
        libs["Shared helpers<br/>src/libs"]:::libs
        platform["Runtime platform<br/>browser, Next.js"]:::platform
        external["External package or service"]:::external
    end

    classDef transport fill:#F0E442,stroke:#8A7F00,color:#111827;
    classDef ui fill:#0072B2,stroke:#56B4E9,color:#fff;
    classDef browser fill:#009E73,stroke:#005A45,color:#111827;
    classDef server fill:#D55E00,stroke:#8A3C00,color:#111827;
    classDef core fill:#CC79A7,stroke:#7A3E62,color:#111827;
    classDef libs fill:#475569,stroke:#cbd5e1,color:#fff;
    classDef platform fill:#6B7280,stroke:#374151,color:#fff;
    classDef external fill:#111827,stroke:#9ca3af,color:#fff;
```

## Import Boundaries

Arrows in this diagram only mean direct imports in current production code.

```mermaid
flowchart LR
    accTitle: Current production import boundaries
    accDescr: Direct imports from app pages and route handlers into UI, browser, server, core, libraries, and the Pubky SDK adapter.
    subgraph browserLane[Browser import lane]
        direction TB
        pages["src/app<br/>pages"]:::transport --> ui["src/ui"]:::ui --> browser["src/browser"]:::browser
        pages --> bootstrap["src/server/config<br/>browser bootstrap"]:::server
        ui --> browserCore["src/core"]:::core
        ui --> browserLibs["src/libs"]:::libs
        browser --> browserCore
        browser --> browserLibs
        browser --> sdk["@synonymdev/pubky<br/>only via browser/pubky/adapters"]:::external
    end

    subgraph serverLane[Server import lane]
        direction TB
        routes["src/app/api<br/>route handlers"]:::transport --> server["src/server"]:::server
        proxy["proxy.ts"]:::transport --> server
        proxy --> bootstrap
        server --> bootstrap
        routes --> serverLibs["src/libs"]:::libs
        server --> serverCore["src/core"]:::core
    end

    classDef transport fill:#F0E442,stroke:#8A7F00,color:#111827;
    classDef ui fill:#0072B2,stroke:#56B4E9,color:#fff;
    classDef browser fill:#009E73,stroke:#005A45,color:#111827;
    classDef server fill:#D55E00,stroke:#8A3C00,color:#111827;
    classDef core fill:#CC79A7,stroke:#7A3E62,color:#111827;
    classDef libs fill:#475569,stroke:#cbd5e1,color:#fff;
    classDef external fill:#111827,stroke:#9ca3af,color:#fff;
    linkStyle default stroke:#64748B,stroke-width:2.5px;
```

Enforced by ESLint, `test-utils/architecture/architecture-boundaries.test.ts`, and
the `client-only` / `server-only` markers. Browser application modules do not depend
on controllers or outward layers. Adapters implement application contracts without
depending on controllers. Concrete controllers may use public and application
contracts, while composition modules own adapter and controller wiring.

## Routes

| Route | Entry | Responsibility |
| --- | --- | --- |
| `/` | `src/app/page.tsx::Home` | Development identity panel and manual auth entry. |
| `/authorize` | `src/app/authorize/page.tsx::AuthorizePage` | Review, approve, cancel, callbacks. |
| `GET /api/health` | `src/app/api/health/route.ts::GET` | Health response. |
| `POST /api/wrapping-key/google` | `src/app/api/wrapping-key/google/route.ts::POST` | Verify Google identity and derive wrapping material. |

## Call Flows

In the remaining diagrams:

- Solid arrow: call or network request.
- Dashed arrow: return or result.

### `/authorize` Document Entry

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Authorization document entry call flow
    accDescr: A request passes through Next proxy and CSP parsing before the client scrubs and parses the authorization query for review.
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
    box rgba(204, 121, 167, 0.18) src/core/auth
        participant Parser as parsePubkyAuthRequest.ts<br/>extractRawPubkyAuthRequestQueryValue()<br/>parsePubkyAuthRequest()
    end
    box rgba(0, 114, 178, 0.18) src/ui
        participant Loader as authorizationReviewLoader.tsx<br/>AuthorizationReviewLoader
        participant Review as authorizationReview.tsx<br/>AuthorizationReview()
    end
    box rgba(0, 158, 115, 0.18) src/browser/authorization
        participant Factory as createBrowserAuthorizationController.ts<br/>createBrowserAuthorizationController()
        participant Controller as passportAuthorizationController.ts<br/>PassportAuthorizationController
    end
    box rgba(0, 158, 115, 0.18) src/browser/authorization/adapters
        participant Entry as browserAuthorizationEntry.ts<br/>readAndScrubAuthorizationEntry()<br/>commitAuthorizationEntry()
    end

    App->>Client: Navigate to Passport /authorize?d=...
    Client->>Next: GET /authorize?d=encoded-request
    Next->>Proxy: proxy(request)
    Proxy->>CSP: createContentSecurityPolicy(search, nonce)
    CSP->>Parser: extract d and parse request
    Parser-->>CSP: review + sensitive approval + relayOrigin, or error
    Note over CSP: Policy uses only relayOrigin
    CSP-->>Proxy: document CSP
    Proxy-->>Next: NextResponse.next + CSP headers
    Next->>Page: AuthorizePage()
    Page->>Loader: render client boundary with validated bootstrap values
    Next-->>Client: document + CSP + no-store + no-referrer
    Client->>Loader: hydrate
    Loader->>Review: dynamic import, SSR disabled
    Review->>Factory: createBrowserAuthorizationController()
    Factory->>Entry: readAndScrubAuthorizationEntry(window)
    Entry->>Client: History.prototype.replaceState(current pathname + hash, query removed)
    Entry->>Parser: parse captured d
    Parser-->>Entry: safe review + private approval
    Entry-->>Factory: valid entry or invalid
    Factory->>Controller: new PassportAuthorizationController(...)
    Factory-->>Review: controller with safe view state
    Review->>Controller: mounted()
    Controller->>Entry: commitAuthorizationEntry(window)
```



### Manual Authorization

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Manual authorization call flow
    accDescr: The form validates and clears a pasted request before either showing a safe error or starting a full authorization document navigation.
    actor User
    box rgba(0, 114, 178, 0.18) src/ui
        participant Form as manualAuthorizationForm.tsx<br/>ManualAuthorizationForm()<br/>submit() / replaceDocument()
    end
    box rgba(204, 121, 167, 0.18) src/core/auth
        participant Parser as parsePubkyAuthRequest.ts<br/>parsePubkyAuthRequest()
    end
    box rgba(107, 114, 128, 0.18) Runtime platforms
        participant Window as PLATFORM<br/>Passport tab window
        participant Next as PLATFORM<br/>Next.js request runtime
    end

    User->>Form: Submit pasted pubkyauth URL
    Form->>Parser: parsePubkyAuthRequest(encodeURIComponent(input))
    Parser-->>Form: validated request or typed error
    Note over Form: Clear textarea state
    alt Invalid
        Form-->>User: safe local error
    else Valid
        Form->>Window: location.replace(/authorize?d=...)
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
    box rgba(0, 114, 178, 0.18) src/ui
        participant Review as authorizationReview.tsx<br/>AuthorizationReview()
    end
    box rgba(0, 158, 115, 0.18) src/browser/authorization
        participant Controller as passportAuthorizationController.ts<br/>PassportAuthorizationController
        participant Composition as createBrowserAuthorizationController.ts<br/>approveWithPubkySdk()<br/>createActiveAuthorizationIdentityRestorer()
    end
    box rgba(0, 158, 115, 0.18) src/browser/authorization/application
        participant UseCase as approveActiveAuthorization.ts<br/>approveActiveAuthorization()
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/local-identity/application
        participant Local as restoreActiveLocalIdentityKey.ts<br/>RestoreActiveLocalIdentityKey
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/local-identity/adapters
        participant Repo as localStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(0, 158, 115, 0.18) src/browser/pubky/adapters
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(204, 121, 167, 0.18) src/core/auth
        participant AuthParser as parsePubkyAuthRequest.ts<br/>isParserIssuedPubkyAuthRequest()<br/>getParserIssuedPubkyAuthCallbacks()
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.9.3<br/>Keypair / Signer
        participant Relay as Request-supplied HTTPS Relay<br/>Signer.approveAuthRequest() delivery
    end
    box rgba(107, 114, 128, 0.18) Browser platform
        participant Window as PLATFORM<br/>Passport tab window
    end

    User->>Review: Approve
    Review->>Controller: approve()
    Controller->>Composition: approveAuthorization(approval)
    Composition->>Pubky: new PubkySdkAdapter()
    Composition->>Composition: createActiveAuthorizationIdentityRestorer(pubky)
    Composition->>UseCase: approveActiveAuthorization(...)
    UseCase->>Composition: returned restoreActiveIdentity()
    Composition->>Local: restore()
    Local->>Repo: readActive()
    Repo-->>Local: public metadata + 32-byte secret
    Local->>Pubky: restoreIdentityKey(secret)
    Pubky->>SDK: Keypair.fromSecret(secret)
    SDK-->>Pubky: concrete Keypair
    Pubky-->>Local: opaque handle + public identity
    Note over Local: Compare persisted public metadata
    Local-->>Composition: verified active identity
    Composition-->>UseCase: verified active identity
    UseCase->>Pubky: approveAuthRequest(handle, approval)
    Pubky->>AuthParser: isParserIssuedPubkyAuthRequest(approval)
    AuthParser-->>Pubky: parser provenance
    Pubky->>SDK: signer.approveAuthRequest(sensitive URL)
    Note over SDK,Relay: AuthToken signing, encryption, and Relay delivery are SDK-owned internals
    SDK-->>Pubky: completion or failure
    Pubky-->>UseCase: typed result
    UseCase->>Pubky: disposeIdentityKey(handle)
    UseCase-->>Composition: safe result
    Composition->>Pubky: dispose()
    Composition-->>Controller: safe result
    Controller->>AuthParser: getParserIssuedPubkyAuthCallbacks(approval)
    AuthParser-->>Controller: success or error callback
    alt Callback exists
        Controller->>Window: location.replace(callback)
    else No callback or navigation fails
        Controller-->>Review: safe local terminal state
    end
```

### Cancellation

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Authorization cancellation call flow
    accDescr: Cancellation retrieves only the parser-owned cancel callback and redirects or renders a local cancelled state without restoring a key.
    actor User
    box rgba(0, 114, 178, 0.18) src/ui
        participant Review as authorizationReview.tsx<br/>AuthorizationReview()
    end
    box rgba(0, 158, 115, 0.18) src/browser/authorization
        participant Controller as passportAuthorizationController.ts<br/>PassportAuthorizationController
    end
    box rgba(204, 121, 167, 0.18) src/core/auth
        participant Callbacks as parsePubkyAuthRequest.ts<br/>getParserIssuedPubkyAuthCallbacks()
    end
    box rgba(107, 114, 128, 0.18) Browser platform
        participant Window as PLATFORM<br/>Passport tab window
    end

    User->>Review: Cancel before approval
    Review->>Controller: cancel()
    Controller->>Callbacks: getParserIssuedPubkyAuthCallbacks(approval)
    Callbacks-->>Controller: cancel callback or none
    alt Callback exists
        Controller->>Window: location.replace(callback)
    else No callback or navigation fails
        Controller-->>Review: local cancelled state
    end
```

### Google Sign-In And Drive Consent

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Google sign-in and Drive consent call flow
    accDescr: The UI delegates sign-in and Drive consent to the browser controller and Google adapters while credentials remain outside React state.
    actor User
    box rgba(0, 114, 178, 0.18) src/ui
        participant DevPanel as developmentIdentityPanel.tsx<br/>DevelopmentIdentityPanel()
        participant AuthPanel as authorizationIdentityPanel.tsx<br/>AuthorizationIdentityPanel()
        participant Button as googleSignInButton.tsx<br/>GoogleSignInButton()
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity
        participant Factory as createBrowserIdentityController.ts<br/>createBrowserIdentityController()
        participant Controller as passportIdentityController.ts<br/>PassportIdentityController
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-sign-in/adapters
        participant SignIn as googleIdentityServicesSignInButton.ts<br/>GoogleIdentityServicesSignInButton
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-drive-access/adapters
        participant DriveAccess as googleIdentityServicesDriveAccessRequester.ts<br/>GoogleIdentityServicesDriveAccessRequester
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-identity-services/adapters
        participant GISLoader as googleIdentityServicesLoader.ts<br/>loadGoogleAccounts()
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/application
        participant Establish as establishGoogleBackedIdentity.ts<br/>EstablishGoogleBackedIdentity
    end
    box rgba(17, 24, 39, 0.12) External
        participant GIS as Google Identity Services JS API<br/>google.accounts.id
        participant OAuth as Google GIS OAuth token client<br/>google.accounts.oauth2.initTokenClient
        participant UserInfo as Google OpenID Connect UserInfo<br/>openidconnect.googleapis.com/v1/userinfo
    end

    alt Home identity panel
        DevPanel->>Factory: createBrowserIdentityController(...)
        Factory->>Controller: new PassportIdentityController(...)
        Factory-->>DevPanel: controller
        DevPanel->>Button: render with controller
    else Authorization identity panel
        AuthPanel->>Factory: createBrowserIdentityController(...)
        Factory->>Controller: new PassportIdentityController(...)
        Factory-->>AuthPanel: controller
        AuthPanel->>Button: render with controller
    end
    Button->>Controller: mountGoogleSignIn(target, onState)
    Controller->>SignIn: mount(...)
    SignIn->>GISLoader: loadGoogleAccounts()
    GISLoader-->>SignIn: google.accounts
    SignIn->>GIS: initialize credential callback
    SignIn->>GIS: renderButton(...)
    User->>GIS: Select account
    GIS-->>SignIn: Google credential callback
    SignIn->>SignIn: readUnverifiedGoogleIdTokenSubject(token)
    SignIn-->>Controller: ID token + subject hint
    Controller-->>Button: stage = drive
    User->>Button: Allow Drive access
    Button->>Controller: continueGoogle(establish)
    Controller->>DriveAccess: request(...)
    DriveAccess->>GISLoader: loadGoogleAccounts()
    GISLoader-->>DriveAccess: google.accounts
    DriveAccess->>OAuth: request openid + drive.appdata
    OAuth-->>DriveAccess: Drive access token
    DriveAccess->>UserInfo: GET /userinfo with Drive token
    UserInfo-->>DriveAccess: Drive account subject
    Note over DriveAccess: Require subjects to match
    DriveAccess-->>Controller: verified Drive token
    Controller->>Establish: establish(ID token, Drive token)
```



### Establish Google-Backed Identity

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Google-backed identity establishment call flow
    accDescr: The coordinator requests a wrapping key, reads the encrypted Drive file, and dispatches to restore or create without passing wrapping material to Drive storage.
    box rgba(0, 158, 115, 0.18) src/browser/identity
        participant Controller as passportIdentityController.ts<br/>PassportIdentityController
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/composition
        participant Actions as googleIdentityActions.ts<br/>GoogleIdentityActions
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/application
        participant Establish as establishGoogleBackedIdentity.ts<br/>EstablishGoogleBackedIdentity
        participant Restore as restoreGoogleBackedIdentity.ts<br/>RestoreGoogleBackedIdentity
        participant Creator as createGoogleBackedIdentity.ts<br/>CreateGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/wrapping-key/adapters
        participant Wrapping as googleWrappingKeyRequester.ts<br/>BrowserGoogleWrappingKeyRequester
    end
    box rgba(0, 158, 115, 0.18) src/browser/passport-file/adapters
        participant DriveStore as googleDrivePassportFileStore.ts<br/>GoogleDrivePassportFileStore
    end
    box rgba(240, 228, 66, 0.18) src/app/api/wrapping-key/google
        participant API as handler.ts<br/>googleWrappingKeyPost()<br/>exported as route.ts::POST
    end
    box rgba(17, 24, 39, 0.12) External
        participant Drive as Google Drive API v3<br/>appDataFolder/passport.json
    end

    Controller->>Establish: establish(ID token, Drive token)
    Establish->>Wrapping: requestWrappingKey(ID token)
    Wrapping->>API: POST { googleIdToken }
    API-->>Wrapping: wrapping-key result
    Wrapping-->>Establish: wrapping-key result
    alt Wrapping-key error
        Establish-->>Controller: safe failure
    else Wrapping key
        Establish->>Actions: passportFileStoreForAccessToken(Drive token)
        Actions->>DriveStore: new GoogleDrivePassportFileStore(...)
        Actions-->>Establish: store
        Establish->>DriveStore: readPassportFile()
        DriveStore->>Drive: list passport.json
        Drive-->>DriveStore: list response
        opt One file found
            DriveStore->>Drive: GET media for exact file ID
            Drive-->>DriveStore: media response body
            DriveStore->>DriveStore: bounded read + parsePassportFileContents()
            DriveStore->>Drive: GET metadata for exact file ID
            Drive-->>DriveStore: ID + name + version + trashed state
        end
        DriveStore-->>Establish: found, missing, or safe error
        alt Found
            Establish->>Restore: execute(envelope, wrapping key)
        else Missing
            Establish->>Creator: execute(ID token, Drive store, wrapping key)
        else Storage error
            Establish-->>Controller: safe failure
        end
    end
```



### Restore Existing Identity

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Existing identity restore call flow
    accDescr: Browser crypto decrypts the Drive envelope, PubkySdkAdapter signs in with the restored key, and only a matching activated identity is saved locally; failures stop before later stages and cleanup runs after decryption succeeds.
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/application
        participant Restore as restoreGoogleBackedIdentity.ts<br/>RestoreGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/local-identity/application
        participant Local as saveLocalIdentity.ts<br/>SaveLocalIdentity
    end
    box rgba(0, 158, 115, 0.18) src/browser/passport-file/adapters
        participant Crypto as webCryptoPassportFileCrypto.ts<br/>WebCryptoPassportFileCrypto
    end
    box rgba(0, 158, 115, 0.18) src/browser/pubky/adapters
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/local-identity/adapters
        participant Repo as localStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.9.3<br/>Keypair / Signer
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
            Restore->>Pubky: signin(handle, waitForDiscovery=true)
            Pubky->>SDK: signer.signinBlocking()
            Note over SDK: Homeserver and discovery work inside signinBlocking is SDK-owned
            SDK-->>Pubky: Session or failure
            Pubky-->>Restore: session public identity or signin error
            alt Sign-in error
                Restore-->>Restore: signin_failed
            else Session identity mismatch
                Restore-->>Restore: identity_mismatch
            else Matching session identity
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
```

### Create Missing Identity: Encrypt And Store

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Missing identity encryption and Drive storage call flow
    accDescr: CreateGoogleBackedIdentity asks PubkySdkAdapter and the Pubky SDK for a new key and exported secret, encrypts the secret through PassportFileCrypto, creates the encrypted Drive file through PassportFileStore, and then zeros the exported bytes.
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/application
        participant Creator as createGoogleBackedIdentity.ts<br/>CreateGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/browser/pubky/adapters
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/browser/passport-file/adapters
        participant Crypto as webCryptoPassportFileCrypto.ts<br/>WebCryptoPassportFileCrypto
        participant DriveStore as googleDrivePassportFileStore.ts<br/>GoogleDrivePassportFileStore
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.9.3<br/>Keypair
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
    DriveStore-->>Creator: stored reference or safe error
    Note over Creator: Zero exported secret bytes
    alt Storage error
        Creator->>Pubky: disposeIdentityKey(handle)
    else Stored
        Note over Creator: Key handle continues into activation
    end
```

### Create Missing Identity: Activate And Save

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Missing identity activation and local save call flow
    accDescr: EstablishGoogleBackedIdentity requests a Homegate invitation, then CreateGoogleBackedIdentity signs up, verifies, publishes discovery, and saves in order; each failure stops later stages and the generated key handle is always disposed.
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/application
        participant Establish as establishGoogleBackedIdentity.ts<br/>EstablishGoogleBackedIdentity
        participant Creator as createGoogleBackedIdentity.ts<br/>CreateGoogleBackedIdentity
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/local-identity/application
        participant Local as saveLocalIdentity.ts<br/>SaveLocalIdentity
    end
    box rgba(0, 158, 115, 0.18) src/browser/homegate/adapters
        participant Invite as homegateClient.ts<br/>HomegateClient
    end
    box rgba(0, 158, 115, 0.18) src/browser/pubky/adapters
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/local-identity/adapters
        participant Repo as localStorageIdentityRepository.ts<br/>LocalStorageIdentityRepository
    end
    box rgba(17, 24, 39, 0.12) External
        participant SDK as @synonymdev/pubky@0.9.3<br/>Signer / PKDNS
        participant Homegate as Homegate<br/>/google_verification
    end

    Establish->>Invite: requestGoogleSignupInvitation(ID token)
    Invite->>Homegate: POST { googleIdToken }
    Homegate-->>Invite: invitation or plaintext error
    alt Homegate error
        Invite-->>Establish: safe invitation failure
    else Invitation response
        Note over Invite: Parse exact bounded response
        Invite-->>Establish: validated invitation
        Establish->>Creator: execute(validated invitation)
        Creator->>Pubky: signup(handle, homeserver, signup code)
        Pubky->>SDK: signer.signup(...)
        Note over SDK: Homeserver signup transport is SDK-owned
        SDK-->>Pubky: Session or failure
        Pubky-->>Creator: session public identity or signup error
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

Local ready state is saved last. Failure after Drive creation leaves the encrypted
Drive file but no local ready identity. When a recoverable public identity is
available, the development panel can offer the verified deletion flow below.

### Development-Only Drive Reset

Credential acquisition follows the Google flow above with a delete action. This
diagram starts after the Google ID token and subject-matched Drive access token
return to the controller; the wrapping-key API verifies the ID token below.

This diagram documents the current development-only Drive reset implementation.

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Development Drive reset call flow
    accDescr: After the shared Google flow returns verified tokens, the identity controller invokes DeleteGoogleDriveIdentity, which requests wrapping material, reads and decrypts the exact Drive revision, restores and compares the public identity, disposes the key, and deletes only the verified file reference.
    box rgba(0, 158, 115, 0.18) src/browser/identity
        participant Controller as passportIdentityController.ts<br/>PassportIdentityController
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/composition
        participant Actions as googleIdentityActions.ts<br/>GoogleIdentityActions
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/application
        participant Delete as deleteGoogleDriveIdentity.ts<br/>DeleteGoogleDriveIdentity
    end
    box rgba(0, 158, 115, 0.18) src/browser/identity/google-backed-identity/wrapping-key/adapters
        participant Wrapping as googleWrappingKeyRequester.ts<br/>BrowserGoogleWrappingKeyRequester
    end
    box rgba(0, 158, 115, 0.18) src/browser/passport-file/adapters
        participant DriveStore as googleDrivePassportFileStore.ts<br/>GoogleDrivePassportFileStore
        participant Crypto as webCryptoPassportFileCrypto.ts<br/>WebCryptoPassportFileCrypto
    end
    box rgba(0, 158, 115, 0.18) src/browser/pubky/adapters
        participant Pubky as pubkySdkAdapter.ts<br/>PubkySdkAdapter
    end
    box rgba(240, 228, 66, 0.18) src/app/api/wrapping-key/google
        participant WrappingAPI as handler.ts<br/>googleWrappingKeyPost()<br/>exported as route.ts::POST
    end
    box rgba(17, 24, 39, 0.12) External
        participant Drive as Google Drive API v3<br/>appDataFolder/passport.json
    end

    Controller->>Delete: execute(credentials, expected public key)
    Delete->>Wrapping: requestWrappingKey(ID token)
    Wrapping->>WrappingAPI: POST { googleIdToken }
    WrappingAPI-->>Wrapping: wrapping-key result
    Wrapping-->>Delete: wrapping-key result
    alt Wrapping-key error
        Delete-->>Controller: safe failure
    else Wrapping key
        Delete->>Actions: passportFileStoreForAccessToken(Drive token)
        Actions->>DriveStore: new GoogleDrivePassportFileStore(...)
        Actions-->>Delete: store
        Delete->>DriveStore: readPassportFile()
        DriveStore->>Drive: list passport.json
        Drive-->>DriveStore: list response
        opt One file found
            DriveStore->>Drive: GET media for exact file ID
            Drive-->>DriveStore: media response body
            DriveStore->>DriveStore: bounded read + parsePassportFileContents()
            DriveStore->>Drive: GET metadata for exact file ID
            Drive-->>DriveStore: ID + name + version + trashed state
        end
        DriveStore-->>Delete: found, missing, or safe error
        alt Read error
            Delete-->>Controller: safe failure
        else Missing
            Delete-->>Controller: idempotent success
        else Found
            Delete->>Crypto: decryptSecretKeyBytes(...)
            Crypto-->>Delete: secret or decrypt error
            alt Decrypt error
                Delete-->>Controller: safe failure
            else Decrypted secret
                Delete->>Pubky: restoreIdentityKey(secret)
                Pubky-->>Delete: identity + handle, or restore error
                alt Restore error
            Note over Delete: Zero decrypted bytes
                    Delete-->>Controller: safe failure
                else Restored identity
                    Note over Delete: Compare expected public key
                    alt Identity mismatch
                        Note over Delete: Zero decrypted bytes
                        Delete->>Pubky: disposeIdentityKey(handle)
                        Delete-->>Controller: safe failure
                    else Identity matches
                        Note over Delete: Zero decrypted bytes
                        Delete->>Pubky: disposeIdentityKey(handle)
                        Delete->>DriveStore: deletePassportFile(exact reference)
                        DriveStore->>Drive: GET metadata for exact file ID
                        Drive-->>DriveStore: metadata, missing, or failure
                        alt Metadata error
                            DriveStore-->>Delete: authorization, network, or response error
                        else Exact file missing
                            DriveStore-->>Delete: idempotent success
                        else Name, revision, or trashed state changed
                            DriveStore-->>Delete: stale_file
                        else Exact revision
                            DriveStore->>Drive: DELETE exact file ID
                            Drive-->>DriveStore: deleted, missing, or failure
                            DriveStore-->>Delete: typed result
                        end
                        Delete-->>Controller: safe result
                    end
                end
            end
        end
    end
```

## Server APIs

### Wrapping Key

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Google wrapping-key API call flow
    accDescr: The route validates its request, verifies Google identity claims, applies a keyed identity rate limit, and derives wrapping material with HKDF.
    box rgba(0, 158, 115, 0.18) Browser runtime
        participant Browser as BROWSER<br/>WrappingKeyRequester
    end
    box rgba(240, 228, 66, 0.18) Next transport
        participant Handler as APP<br/>wrapping-key handler
        participant Policy as APP<br/>googleCredentialRoutePolicy
    end
    box rgba(213, 94, 0, 0.18) Server
        participant Request as SERVER<br/>GoogleWrappingKeyRequest
        participant Verifier as SERVER<br/>GoogleIdTokenVerifier
        participant Limiter as SERVER<br/>rate limiter
        participant Deriver as SERVER<br/>HKDF key deriver
    end
    box rgba(17, 24, 39, 0.12) External
        participant Google as google-auth-library / Google
        participant Ticket as google-auth-library<br/>LoginTicket
    end

    Browser->>Handler: POST { googleIdToken }
    Handler->>Policy: parseGoogleIdTokenRequest(request)
    Policy-->>Handler: Google ID token or invalid_request
    alt Invalid request
        Handler-->>Browser: fixed 400 invalid_request
    else Valid Google ID token
        Handler->>Request: requestWrappingKey(token)
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
            Request->>Limiter: checkRequest(identity)
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

### Homegate Invitation

```mermaid
%%{init: {"themeVariables": {"signalColor": "#64748B", "signalTextColor": "#64748B"}}}%%
sequenceDiagram
    accTitle: Direct browser Homegate invitation call flow
    accDescr: The browser adapter sends only the Google ID token directly to configured Homegate, then bounds and maps the invitation or plaintext error to a safe application result.
    box rgba(0, 158, 115, 0.18) Browser runtime
        participant UseCase as APPLICATION<br/>EstablishGoogleBackedIdentity
        participant Adapter as BROWSER<br/>HomegateClient
    end
    box rgba(17, 24, 39, 0.12) External
        participant Homegate as Homegate
    end

    UseCase->>Adapter: requestGoogleSignupInvitation(ID token)
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
| Authorization parser | `src/core/auth` | `src/core/auth/*.test.ts` |
| Authorization controller | `src/browser/authorization` | Root controller/factory tests and colocated application tests |
| Authorization browser entry | `src/browser/authorization/adapters/browserAuthorizationEntry.ts` | `adapters/browserAuthorizationEntry.test.ts` |
| Authorization UI | `src/ui/authorizationReview.tsx` | `src/ui/authorizationReview.test.tsx` |
| Google controller and adapters | `src/browser/identity` | `passportIdentityController.test.ts`, capability adapter tests |
| Google-backed identity lifecycle | `src/browser/identity/google-backed-identity` | Colocated application, adapter, and composition tests |
| Drive store and WebCrypto | `src/browser/passport-file/application`, `src/browser/passport-file/adapters` | Colocated adapter tests |
| Pubky SDK adapter | `src/browser/pubky/adapters/pubkySdkAdapter.ts` | `adapters/pubkySdkAdapter.test.ts` |
| Wrapping-key API | `src/app/api/wrapping-key/google`, `src/server/wrapping-key/google` | Route and server tests |
| Browser bootstrap config | `src/server/config/browserBootstrapConfig.ts` | `browserBootstrapConfig.test.ts`, proxy tests |
| Homegate invitation | `src/browser/homegate` | Colocated browser application and adapter tests |
| CSP and boundaries | `proxy.ts`, `next.config.mjs`, architecture test | Proxy, header, policy, architecture tests |
