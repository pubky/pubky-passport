import type { Metadata } from "next";

import { LegalPage, LegalSection, SectionIntroduction } from "@/client/ui/shared/legal/legalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | Pubky Passport",
  description: "How Pubky Passport treats personal information.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage eyebrow="Pubky Passport" title="Privacy Policy">
      <p>
        <strong>PUBKY PASSPORT PRIVACY POLICY</strong>
        <br />
        Effective Date: November 6, 2026
      </p>

      <LegalSection title="SCOPE">
        <p>
          This Privacy Policy (“Policy”) describes how Synonym Software Ltd. (“Synonym”, “we”, “us”)
          treats personal information in connection with Pubky Passport, the web application at
          passport.pubky.app, and the services we operate for it (“Passport”).
        </p>
        <p>
          Passport is a separate product from Pubky App, Pubky Ring, and Pubky Shop. This Policy
          does not cover those products, the Homeserver that holds your account, the applications
          you authorize through Passport, your Google Account, or your Apple Account.
        </p>
      </LegalSection>

      <LegalSection title="POLICY SUMMARY">
        <p>
          This summary offers a concise overview. For full details, please read the complete Policy.
        </p>
        <p>
          Passport runs in your browser. You sign in with Google or with Apple. Your identity secret
          key stays on your device and, in encrypted form, in your own Google Drive or iCloud. We do
          not receive it. If you sign in with Google, Passport fetches your Google email address,
          Google Account identifier, display name, and profile-picture link directly from Google in
          your browser and stores that profile information there. If you sign in with Apple,
          Passport asks Apple for your name and email address and stores them, with the identifier
          Apple gives Passport for your Apple Account, in your browser. Apple does not provide a
          profile picture. Passport also sends a signed Google or Apple identity assertion to our
          wrapping-key service and, during account creation, to our verification service. That
          assertion identifies your Google or Apple Account and may contain your email address and
          other profile claims. We do not retain the assertion or create a Passport user profile
          from those claims. Our verification service does retain a stable, pseudonymous hash
          derived from your Google or Apple Account identifier, together with signup and timing
          information, to enforce onboarding limits. Our servers also receive ordinary technical
          information that comes with web requests, such as IP address, browser and device
          information, and logs. We do not sell or share personal information, we do not run
          advertising, and no analytics or error-monitoring vendor is configured in Passport.
        </p>
      </LegalSection>

      <LegalSection title="NOTICE AT COLLECTION">
        <p>
          “Collect” in this notice means information involved when you use Passport. It does not
          mean we keep a copy of everything on our servers. Passport does not maintain a
          conventional user-profile database, but the verification service used during account
          creation keeps the pseudonymous verification records described below.
        </p>
        <p>
          <strong>Stored in your browser only.</strong> Your Pubky public key and identity secret
          key. If you sign in with Google, the Google profile returned directly to Passport’s
          browser code: your Google Account identifier, email address, display name, and a link to
          your profile picture. If you sign in with Apple, your name, email address, and the
          identifier Apple gives Passport for your Apple Account. Clearing Passport’s browser
          storage removes them from that device. As described below, the same Google or Apple
          identifiers and email addresses may also appear as claims in the identity assertion
          processed by our services.
        </p>
        <p>
          <strong>Stored in your Google Drive or iCloud, not on our servers.</strong> The encrypted
          Passport File, and any visible recovery copies Passport writes for you in Google Drive. In
          iCloud, Passport also stores a one-way hash of your Apple Account identifier with the
          file.
        </p>
        <p>
          <strong>Received by our services.</strong> A Google or Apple identity assertion, used to
          derive a wrapping key and, when Passport creates a Homeserver account for you, to verify
          eligibility for a signup invitation. We do not retain the assertion itself. The
          account-creation verification service stores a stable, peppered hash derived from the
          assertion’s issuer and Google or Apple Account identifier, the issued signup code, and the
          time of issuance. Our services also receive ordinary internet activity that comes with web
          requests, including IP address, device and browser information, request metadata, and
          structured logs of operations that succeed or fail.
        </p>
        <p>
          We use these categories in order to provide Passport to you, to secure it against abuse,
          to run our business, and as required by law.
        </p>
        <p>
          We have not “sold” or “shared” personal information in the past 12 months as those terms
          are defined by the California Consumer Privacy Act (“CCPA”). We do not sell personal data
          as that concept is understood under the General Data Protection Regulation (“GDPR”). For a
          description of your rights and how to exercise them, see Your Privacy Rights below.
        </p>
      </LegalSection>

      <LegalSection title="TYPES OF INFORMATION WE COLLECT">
        <p>Here are examples of the information involved when you use Passport:</p>
        <p>
          <strong>Google Account Information (browser only).</strong> When you sign in with Google,
          Passport fetches your Google Account identifier, email address, name, and a link to your
          profile picture directly from Google in your browser. Passport stores that profile in your
          browser to label the identities you hold. We do not create a server-side Passport user
          profile from it. The Google identity assertion processed by our services separately
          contains your Google Account identifier and may contain other Google profile claims.
        </p>
        <p>
          <strong>Apple Account Information (browser only).</strong> When you sign in with Apple,
          Passport asks Apple for your name and email address. Apple gives Passport your name in
          your browser only the first time you sign in to Passport with that Apple Account. Your
          email address, and the identifier Apple gives Passport for your Apple Account, come in
          Apple’s signed identity assertion. If you choose Apple’s Hide My Email, Passport receives
          the relay address Apple creates instead of your email address. Apple does not provide a
          profile picture. Passport stores your name, email address, and that identifier in your
          browser to label the identities you hold, to reuse a name Apple sent earlier, to tell you
          which Apple Account you signed in with when it does not match a Passport File, and, when
          you detach an identity, to check that you signed in with the same Apple Account. Your name
          is never sent to us. We do not create a server-side Passport user profile from this
          information. The Apple identity assertion processed by our services separately contains
          your Apple Account identifier and may contain your email address.
        </p>
        <p>
          <strong>Google or Apple Identity Assertion.</strong> Passport sends the signed assertion
          issued by Google or Apple to our wrapping-key endpoint so that we can verify it and derive
          the key that decrypts your encrypted backup. When Passport creates a Homeserver account
          for you, it also sends the assertion to our verification service. We use it for those
          requests and do not retain the assertion itself. The verification service derives and
          retains the pseudonymous record described below.
        </p>
        <p>
          <strong>Google Authorization Token.</strong> Passport receives a token that lets it read
          and write your Passport File in your Google Drive. It stays in your browser for the
          operation in progress and is not sent to us.
        </p>
        <p>
          <strong>iCloud Session.</strong> When you connect iCloud, Apple gives Passport a session
          that lets it read, write, and delete your Passport File in your iCloud. Passport keeps it
          only in your browser’s memory and sends it only to Apple. It is not sent to us.
        </p>
        <p>
          <strong>Pubky Public Key (browser only).</strong> The public identifier of each identity
          you create or restore is stored in your browser. It is public by design and is provided to
          Homeservers and to applications you authorize as part of Pubky account and authorization
          flows. We do not keep a copy in a Passport user profile.
        </p>
        <p>
          <strong>Device and Log Information.</strong> Like any website, Passport’s servers receive
          your IP address, your browser and device information, and request metadata, and record
          structured log entries about operations that succeed or fail. Together with the
          verification records described below, that is the personal information we retain on our
          side, for a limited operational period.
        </p>
        <p>
          <strong>Information You Submit.</strong> Anything you send us if you contact us, for
          example by email.
        </p>
        <h3>What Passport does not collect</h3>
        <p>
          <strong>Your identity secret key.</strong> It is generated or restored in your browser and
          is not sent to us.
        </p>
        <p>
          <strong>Your encrypted backup.</strong> The Passport File is written from your browser
          directly to your Google Drive or iCloud. We do not receive, hold, or store it, and we
          cannot read it.
        </p>
        <p>
          <strong>Your Google Drive contents.</strong> Passport’s Google permissions are limited to
          its own application data and to files it creates. Passport does not read your other files.
        </p>
        <p>
          <strong>Your iCloud contents.</strong> Passport reads and writes only its own Passport
          File record in its own area of your iCloud. Passport does not read your other iCloud data.
        </p>
        <p>
          <strong>Recovery phrases and payment credentials.</strong> Passport does not ask for them.
          Passport does ask you to create a password when you download an encrypted recovery file.
          That password is processed in your browser to encrypt the file and is not sent to or
          stored by us.
        </p>
      </LegalSection>

      <LegalSection title="HOW YOUR IDENTITY AND BACKUP ARE STORED">
        <SectionIntroduction>
          This section is specific to Passport, because most of your data never reaches us.
        </SectionIntroduction>
        <p>
          <strong>On your device.</strong> Passport stores, in your browser’s local storage, a
          catalogue of the identities you hold: for each one, the Pubky public key, the Google or
          Apple Account information above, and the secret key itself. This stays on the device and
          in the browser profile you used. Clearing that storage removes it.
        </p>
        <p>
          <strong>In your Google Drive.</strong> Passport writes an encrypted copy of your identity
          secret key to a private application-data area of your Google Drive, and may also write
          encrypted copies to a visible folder named “Pubky Passport” so that you can see and keep
          them. These files are yours, in your Google Account. You can delete them at any time.
        </p>
        <p>
          <strong>In your iCloud.</strong> If you sign in with Apple, Passport writes an encrypted
          copy of your identity secret key as a single record in Passport’s area of the iCloud
          private database you connect. The iCloud you connect may belong to a different Apple
          Account than the one you signed in with. Passport stores a one-way hash of your Apple
          Account identifier in the same record, so that it can tell when a file belongs to a
          different Apple Account. Apple holds this record under Apple’s own terms and privacy
          policy. It never passes through our servers. You can delete it with “Detach from Apple” in
          Passport: you sign in with the same Apple Account and connect the iCloud that holds the
          file, and Passport deletes the record from that iCloud and removes the identity from that
          browser. Passport also deletes the record if you choose to replace a damaged file, or one
          it cannot decrypt, with a new identity.
        </p>
        <p>
          <strong>On our server.</strong> We do not store your email address, your name, other
          Google profile fields, or your Apple Account identifier in a Passport user profile. We
          hold one or more secrets used to derive the key that decrypts a Passport File. Deriving it
          requires a Google or Apple identity assertion, signed by Google or Apple, for the same
          account. The file itself never passes through us, so the derived key alone does not give
          us access to your identity. Each Passport File records the public identifier of the secret
          used, never the secret itself. During account creation, our verification service stores a
          stable, peppered hash derived from the assertion’s issuer and Google or Apple Account
          identifier, the issued signup code, and its creation time. We also retain server logs as
          described above.
        </p>
      </LegalSection>

      <LegalSection title="LEGAL BASIS">
        <p>
          We must have a lawful basis for using your personal data. Our legal basis will be one of
          the following:
        </p>
        <ul>
          <li>
            <strong>Keeping to our contracts and agreements with you:</strong> we need certain
            personal data to provide Passport as described in the Terms, including verifying a
            Google or Apple identity assertion so that you can recover your identity.
          </li>
          <li>
            <strong>Consent:</strong> where you have agreed, for example when you grant Passport
            permission to use your Google Account and Google Drive, or sign in with Apple and
            connect iCloud.
          </li>
          <li>
            <strong>Legal obligations:</strong> where we have a legal responsibility to collect,
            retain, or disclose data.
          </li>
          <li>
            <strong>Legitimate interests:</strong> to keep Passport secure, to prevent abuse and
            automated account creation, and to diagnose failures.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="HOW WE COLLECT YOUR INFORMATION">
        <p>
          <strong>Directly from you.</strong> When you use Passport, grant Google permissions, sign
          in with Apple, connect iCloud, or contact us.
        </p>
        <p>
          <strong>Passively.</strong> When your browser connects to Passport, through request
          metadata and server logs.
        </p>
        <p>
          <strong>From Google.</strong> Your Google Account information is received in your browser.
          Our wrapping-key endpoint checks Google’s signed identity assertion against Google’s
          published signing keys for that request.
        </p>
        <p>
          <strong>From Apple.</strong> Your Apple Account information is received in your browser:
          your name directly from Apple, and your email address and the identifier for your Apple
          Account in Apple’s signed identity assertion. Our wrapping-key endpoint checks that
          assertion against Apple’s published signing keys for that request.
        </p>
        <p>
          <strong>From a verification service we operate.</strong> Where Passport helps you create
          an account on a Homeserver, that service confirms a Google or Apple identity assertion and
          issues a signup invitation. To apply weekly and annual rate limits, it records each
          successful issuance using a stable, peppered hash derived from the assertion’s issuer and
          Google or Apple Account identifier, together with the signup code and issuance time.
        </p>
      </LegalSection>

      <LegalSection title="HOW WE USE YOUR INFORMATION">
        <p>Examples of how we may use your information include:</p>
        <ul>
          <li>
            to run Passport, including verifying a Google or Apple identity assertion and deriving
            the key that decrypts your Passport File;
          </li>
          <li>
            in your browser, to show you which Google Account or Apple Account an identity is
            associated with;
          </li>
          <li>to help you create an account on a Homeserver, where you ask for that;</li>
          <li>
            to secure Passport, prevent abuse, enforce rate limits, and investigate incidents;
          </li>
          <li>to respond to your requests or questions; and</li>
          <li>as otherwise permitted by Law or as we may notify you.</li>
        </ul>
        <p>We do not use your information for advertising, and we do not use it to train models.</p>
      </LegalSection>

      <LegalSection title="HOW WE SHARE YOUR INFORMATION">
        <p>We may share your information in the following ways:</p>
        <ul>
          <li>
            <strong>With Google.</strong> Because Passport uses Google sign-in and Google Drive at
            your request. Google processes that information under its own privacy policy.
          </li>
          <li>
            <strong>With Apple.</strong> Because Passport uses Sign in with Apple and iCloud at your
            request. Apple processes that information under its own privacy policy.
          </li>
          <li>
            <strong>With a verification service and Homeserver we operate.</strong> When you ask
            Passport to create an account, the Google or Apple identity assertion is verified and a
            signup invitation is issued for a Homeserver. If you choose a Homeserver operated by a
            third party, that operator’s policy applies to your account there.
          </li>
          <li>
            <strong>With our service providers.</strong> Third parties who perform services on our
            behalf, such as hosting and infrastructure providers for passport.pubky.app.
          </li>
          <li>
            <strong>Internally.</strong> With our parent, subsidiary, and affiliate companies.
          </li>
          <li>
            <strong>To comply with the Law or to protect ourselves.</strong> For example, in
            response to a lawful request, or to investigate a Prohibited Use.
          </li>
          <li>With any successors to all or part of our business.</li>
          <li>As requested or directed by you.</li>
        </ul>
        <p>
          We do not share your Google profile, Apple Account information, Google or Apple identity
          assertion, Google authorization token, iCloud session, or identity secret key with
          applications that ask you for authorization. When you approve a request, the application
          receives a Pubky session containing your public key, the relevant Homeserver, grant
          details, and the capabilities you approved.
        </p>
      </LegalSection>

      <LegalSection title="RETENTION">
        <p>
          We do not retain the Google profile fetched by Passport (email, name, and picture), the
          Apple Account information Passport receives (name, email, and identifier), your Pubky
          public key, or your identity secret key in a Passport user profile on our servers. Those
          live in your browser until you clear it, and the encrypted backup lives in your Google
          Drive or iCloud until you delete it.
        </p>
        <p>
          We do not retain Google or Apple identity assertions after the request that uses them.
          Google authorization tokens and iCloud sessions are never sent to us.
        </p>
        <p>
          The account-creation verification service retains the stable, peppered Google or Apple
          identity hash, signup code, and issuance time described above to enforce weekly and annual
          limits and to operate and secure onboarding. Server logs and verification records are
          retained according to our operational, security, legal, regulatory, and dispute-resolution
          needs.
        </p>
      </LegalSection>

      <LegalSection title="CHILDREN">
        <p>
          Passport is meant for adults. We do not knowingly collect personally identifiable data
          from persons under the age of 18. If you are a parent or legal guardian and think your
          child under 18 has provided us with information, please contact us at{" "}
          <a href="mailto:privacy@synonym.to">privacy@synonym.to</a> and mark your inquiry “COPPA
          Information Request”.
        </p>
      </LegalSection>

      <LegalSection title="CHOICES REGARDING YOUR INFORMATION">
        <p>
          You have choices about how your information is used, and several of them are outside
          Passport:
        </p>
        <ul>
          <li>
            Withdraw Google permissions at any time in your Google Account settings. Passport can
            then no longer read or write your Passport File.
          </li>
          <li>
            Delete your Passport File and any visible copies from your Google Drive. Recovery
            through Google will no longer be possible with those files.
          </li>
          <li>
            Use “Detach from Apple” in Passport to delete your Passport File from your iCloud and
            remove the identity from that browser. Recovery through Apple will no longer be possible
            with that file.
          </li>
          <li>
            Stop using Sign in with Apple with Passport at any time in your Apple Account settings.
          </li>
          <li>
            Clear Passport’s browser storage to remove the identities held on that device. Do this
            only if you have a usable backup.
          </li>
          <li>
            <strong>Cookies and similar technologies.</strong> Passport uses browser storage to
            operate. No advertising or cross-site tracking technology is configured.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="YOUR PRIVACY RIGHTS">
        <p>
          Based on your state or country of residence, you may have the rights listed below with
          respect to the personal information we maintain about you: notice, access, deletion,
          correction, erasure, objection to specific processing, restriction of processing,
          withdrawal of consent, limiting the use or disclosure of sensitive personal information,
          opting out of sale or sharing, and lodging a complaint with a supervisory authority.
        </p>
        <p>
          We may take steps to verify your identity, as permitted or required under applicable law,
          before we process your request. Agents you have authorized may submit requests on your
          behalf with evidence of your written permission.
        </p>
        <p>
          To exercise a right, contact us at{" "}
          <a href="mailto:privacy@synonym.to">privacy@synonym.to</a>. Please include the email
          address Passport shows for your Google Account or Apple Account, or your Pubky public key,
          and indicate that you are making a “Privacy Rights” request. If we deny your request and
          you would like to appeal, you may contact us again at the same address.
        </p>
        <p>
          Because the Google profile fetched by Passport, your Apple Account information, your
          identity secret key, and your Passport File are held on your device, in your Google
          Account, or in your iCloud, a request to us cannot delete those copies. We will tell you
          where the data sits and how to remove it. We can act only on information we hold, which
          may include server logs, account-creation verification records, and messages you send us.
        </p>
      </LegalSection>

      <LegalSection title="THIRD-PARTY SITES AND SERVICES">
        <p>
          Passport connects to services that are not governed by this Policy, including Google,
          Apple, Homeservers and their operators, public key resolution relays, authorization
          relays, and the applications that ask you for authorization. We are not responsible for
          their privacy practices. We suggest that you read their privacy policies carefully.
        </p>
      </LegalSection>

      <LegalSection title="CONTACT">
        <p>
          If you have any questions, comments or concerns with respect to our privacy practices or
          this Policy, or wish to update your information, please contact us at{" "}
          <a href="mailto:privacy@synonym.to">privacy@synonym.to</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
