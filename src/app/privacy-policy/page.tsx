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
        Effective Date: September 21, 2026
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
          you authorize through Passport, or your Google Account.
        </p>
      </LegalSection>

      <LegalSection title="POLICY SUMMARY">
        <p>
          This summary offers a concise overview. For full details, please read the complete Policy.
        </p>
        <p>
          Passport runs in your browser. Your identity secret key stays on your device and, in
          encrypted form, in your own Google Drive. We do not receive it. Passport fetches your
          Google email address, Google Account identifier, display name, and profile-picture link
          directly from Google in your browser and stores that profile information there. Passport
          also sends a signed Google identity assertion to our wrapping-key service and, during
          account creation, to our verification service. That assertion identifies your Google
          Account and may contain Google profile claims. We do not retain the assertion or create a
          Passport user profile from those claims. Our verification service does retain a stable,
          pseudonymous hash derived from your Google Account identifier, together with signup and
          timing information, to enforce onboarding limits. Our servers also receive ordinary
          technical information that comes with web requests, such as IP address, browser and device
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
          <strong>Stored in your browser.</strong> The Google profile returned directly to
          Passport’s browser code—including your Google Account identifier, email address, display
          name, and a link to your profile picture—together with your Pubky public key and identity
          secret key. Clearing Passport’s browser storage removes them from that device. As
          described below, some of the same Google identifiers may also appear as claims in the
          identity assertion processed by our services.
        </p>
        <p>
          <strong>Stored in your Google Drive, not on our servers.</strong> The encrypted Passport
          File, and any visible recovery copies Passport writes for you.
        </p>
        <p>
          <strong>Received by our services.</strong> A Google identity assertion, used to derive a
          wrapping key and, when you request account creation, to verify eligibility for a signup
          invitation. We do not retain the assertion itself. The account-creation verification
          service stores a stable, peppered hash derived from the assertion’s issuer and Google
          Account identifier, the issued signup code, and the time of issuance. Our services also
          receive ordinary internet activity that comes with web requests, including IP address,
          device and browser information, request metadata, and structured logs of operations that
          succeed or fail.
        </p>
        <p>
          We use these categories in order to provide Passport to you, to secure it against abuse,
          to run our business, and as required by law.
        </p>
        <p>
          We may have disclosed each of these categories for a business purpose as described below.
          We have not “sold” or “shared” personal information in the past 12 months as those terms
          are defined by the California Consumer Privacy Act (“CCPA”). We do not sell personal data
          as that concept is understood under the General Data Protection Regulation (“GDPR”). For a
          description of your rights and how to exercise them, see Your Privacy Rights below.
        </p>
      </LegalSection>

      <LegalSection title="TYPES OF INFORMATION WE COLLECT">
        <p>Here are examples of the information involved when you use Passport:</p>
        <p>
          <strong>Google Account Information.</strong> When you sign in with Google, Passport
          fetches your Google Account identifier, email address, name, and a link to your profile
          picture directly from Google in your browser. Passport stores that profile in your browser
          to label the identities you hold. We do not create a server-side Passport user profile
          from it. The Google identity assertion processed by our services separately contains your
          Google Account identifier and may contain other Google profile claims.
        </p>
        <p>
          <strong>Google Identity Assertion.</strong> Passport sends the signed assertion issued by
          Google to our wrapping-key endpoint so that we can verify it and derive the key that
          decrypts your encrypted backup. If you request account creation, Passport also sends the
          assertion to our verification service. We use it for those requests and do not retain the
          assertion itself. The verification service derives and retains the pseudonymous record
          described below.
        </p>
        <p>
          <strong>Google Authorization Token.</strong> Passport receives a token that lets it read
          and write your Passport File in your Google Drive. It stays in your browser for the
          operation in progress and is not sent to us.
        </p>
        <p>
          <strong>Pubky Public Key.</strong> The public identifier of each identity you create or
          restore is stored in your browser. It is public by design and is provided to Homeservers
          and to applications you authorize as part of Pubky account and authorization flows. We do
          not keep a copy in a Passport user profile.
        </p>
        <p>
          <strong>Device and Log Information.</strong> Like any website, Passport’s servers receive
          your IP address, your browser and device information, and request metadata, and record
          structured log entries about operations that succeed or fail. That is the personal
          information we retain on our side, for a limited operational period.
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
          directly to your Google Drive. We do not receive, hold, or store it, and we cannot read
          it.
        </p>
        <p>
          <strong>Your Google Drive contents.</strong> Passport’s Google permissions are limited to
          its own application data and to files it creates. Passport does not read your other files.
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
          catalogue of the identities you hold: for each one, the Pubky public key, the Google
          Account information above, and the secret key itself. This stays on the device and in the
          browser profile you used. Clearing that storage removes it.
        </p>
        <p>
          <strong>In your Google Drive.</strong> Passport writes an encrypted copy of your identity
          secret key to a private application-data area of your Google Drive, and may also write
          encrypted copies to a visible folder named “Pubky Passport” so that you can see and keep
          them. These files are yours, in your Google account. You can delete them at any time.
        </p>
        <p>
          <strong>On our server.</strong> We do not store your email address or other Google profile
          fields in a Passport user profile. We hold one or more secrets used to derive the key that
          decrypts a Passport File. Deriving it requires a Google identity assertion that Google
          confirms as belonging to the same Google Account. The file itself never passes through us,
          so the derived key alone does not give us access to your identity. Each Passport File
          records the public identifier of the secret used, never the secret itself. During account
          creation, our verification service stores a stable, peppered hash derived from the
          assertion’s issuer and Google Account identifier, the issued signup code, and its creation
          time. We also retain server logs as described above.
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
            Google identity assertion so that you can recover your identity.
          </li>
          <li>
            <strong>Consent:</strong> where you have agreed, for example when you grant Passport
            permission to use your Google Account and Google Drive.
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
          <strong>Directly from you.</strong> When you use Passport, grant Google permissions, or
          contact us.
        </p>
        <p>
          <strong>Passively.</strong> When your browser connects to Passport, through request
          metadata and server logs.
        </p>
        <p>
          <strong>From Google.</strong> Your Google Account information is received in your browser.
          Google’s confirmation that an identity assertion is valid is received by our wrapping-key
          endpoint for that request.
        </p>
        <p>
          <strong>From a verification service we operate.</strong> Where Passport helps you create
          an account on a Homeserver, that service confirms a Google identity assertion and issues a
          signup invitation. To apply weekly and annual rate limits, it records each successful
          issuance using a stable, peppered hash derived from the assertion’s issuer and Google
          Account identifier, together with the signup code and issuance time.
        </p>
      </LegalSection>

      <LegalSection title="HOW WE USE YOUR INFORMATION">
        <p>Examples of how we may use your information include:</p>
        <ul>
          <li>
            to run Passport, including verifying a Google identity assertion and deriving the key
            that decrypts your Passport File;
          </li>
          <li>in your browser, to show you which Google Account an identity is associated with;</li>
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
            <strong>With a verification service and Homeserver we operate.</strong> When you ask
            Passport to create an account, the Google identity assertion is verified and a signup
            invitation is issued for a Homeserver. If you choose a Homeserver operated by a third
            party, that operator’s policy applies to your account there.
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
          We do not share your Google profile, Google identity assertion, Google authorization
          token, or identity secret key with applications that ask you for authorization. When you
          approve a request, the application receives a Pubky session containing your public key,
          the relevant Homeserver, grant details, and the capabilities you approved.
        </p>
      </LegalSection>

      <LegalSection title="RETENTION">
        <p>
          We do not retain the Google profile fetched by Passport (email, name, and picture), your
          Pubky public key, or your identity secret key in a Passport user profile on our servers.
          Those live in your browser until you clear it, and the encrypted backup lives in your
          Google Drive until you delete it.
        </p>
        <p>
          We do not retain Google identity assertions or Google authorization tokens after the
          request that uses them.
        </p>
        <p>
          The account-creation verification service retains the stable, peppered Google identity
          hash, signup code, and issuance time described above to enforce weekly and annual limits
          and to operate and secure onboarding. Server logs and verification records are retained
          according to our operational, security, legal, regulatory, and dispute-resolution needs.
        </p>
      </LegalSection>

      <LegalSection title="CHILDREN">
        <p>
          If you are under 18, you may use Passport only with the permission of a parent or legal
          guardian who accepts the Terms with you and is responsible for your activity. Passport
          processes the same categories of information described in this Policy when an eligible
          minor uses the service. If you are a parent or legal guardian and have questions about a
          child’s information, please contact us at{" "}
          <a href="mailto:privacy@synonym.to">privacy@synonym.to</a> and mark your inquiry “Child
          Privacy Request”.
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
          <a href="mailto:privacy@synonym.to">privacy@synonym.to</a>. Please include your Google
          email address or Pubky public key, and indicate that you are making a “Privacy Rights”
          request. If we deny your request and you would like to appeal, you may contact us again at
          the same address.
        </p>
        <p>
          Because the Google profile fetched by Passport, your identity secret key, and your
          Passport File are held on your device or in your Google Account, a request to us cannot
          delete those copies. We will tell you where the data sits and how to remove it. We can act
          only on information we hold, which may include server logs, account-creation verification
          records, and messages you send us.
        </p>
      </LegalSection>

      <LegalSection title="THIRD-PARTY SITES AND SERVICES">
        <p>
          Passport connects to services that are not governed by this Policy, including Google,
          Homeservers and their operators, public key resolution relays, authorization relays, and
          the applications that ask you for authorization. We are not responsible for their privacy
          practices. We suggest that you read their privacy policies carefully.
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
