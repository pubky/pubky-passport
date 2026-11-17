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
        Effective Date: November 17, 2026
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
          you authorize through Passport, or your Google or Apple account.
        </p>
      </LegalSection>
      <LegalSection title="POLICY SUMMARY">
        <p>
          This summary offers a concise overview. For full details, please read the complete Policy.
        </p>
        <p>
          Passport runs in your browser. Your identity secret key stays on your device and, in
          encrypted form, in your own Google Drive or iCloud. We do not receive it. The account
          information you receive from Google or Apple when you sign in (such as your email address,
          account identifier, display name, and, for Google, profile picture) stays in your browser
          only. We do not keep a user account or a copy of those identifiers on our servers. What
          our servers do receive is a Google or Apple identity assertion that we verify in order to
          derive a key that unlocks your encrypted backup, and ordinary technical information that
          comes with any web request (such as IP address and logs). We do not sell or share personal
          information, we do not run advertising, and no analytics or error-monitoring vendor is
          configured in Passport.
        </p>
      </LegalSection>
      <LegalSection title="NOTICE AT COLLECTION">
        <p>
          “Collect” in this notice means information involved when you use Passport. It does not
          mean we keep a copy of everything on our servers. There is no Passport user database.
        </p>
        <p>
          <strong>Stored in your browser only.</strong> Your Google or Apple account identifier,
          email address, display name, a link to your Google profile picture (Google only), your
          Pubky public key, and your identity secret key. Clearing Passport’s browser storage
          removes them from that device.
        </p>
        <p>
          <strong>Stored in your Google Drive or iCloud, not on our servers.</strong> The encrypted
          Passport File, and any visible recovery copies Passport writes for you.
        </p>
        <p>
          <strong>Received by our servers, not stored as a user profile.</strong> A Google or Apple
          identity assertion, used for the request that derives a wrapping key and then discarded.
          Ordinary internet activity that comes with any web request: IP address, device and browser
          information, and structured server logs of operations that succeed or fail.
        </p>
        <p>
          We use these categories in order to provide Passport to you, to secure it against abuse,
          to run our business, and as required by law.
        </p>
        <p>
          We may have disclosed each of these categories for a business purpose as described below.
          We have not “sold” or “shared” personal information in the past 12 months, as those terms
          are defined by the California Consumer Privacy Act (“CCPA”) or the General Data Protection
          Regulation (“GDPR”). For a description of your rights and how to exercise them, see Your
          Privacy Rights below.
        </p>
      </LegalSection>
      <LegalSection title="TYPES OF INFORMATION WE COLLECT">
        <p>Here are examples of the information involved when you use Passport:</p>
        <ul>
          <li>
            <strong>Google Account Information (browser only).</strong> When you sign in with
            Google, Passport receives your Google Account identifier, your email address, your name,
            and a link to your profile picture. Passport stores this in your browser to label the
            identities you hold. We do not store these identifiers on our servers.
          </li>
          <li>
            <strong>Apple Account Information (browser only).</strong> When you sign in with Apple,
            Passport receives your Apple account identifier, your email address (which may be a
            private relay address if you choose to hide your email from us), and your name if you
            choose to share it. Passport stores this in your browser to label the identities you
            hold. We do not store these identifiers on our servers.
          </li>
          <li>
            <strong>Google or Apple Identity Assertion.</strong> Passport sends the signed assertion
            issued by Google or Apple to our wrapping-key endpoint so that we can verify it with its
            issuer and derive the key that decrypts your encrypted backup. We use it for that
            request and we do not store it.
          </li>
          <li>
            <strong>Storage Authorization Token.</strong> Passport receives a token that lets it
            read and write your Passport File in your Google Drive or iCloud. It stays in your
            browser for the operation in progress and is not sent to us.
          </li>
          <li>
            <strong>Pubky Public Key (browser only).</strong> The public identifier of each identity
            you create or restore. It is stored in your browser. It is public by design. We do not
            keep a copy in a Passport user profile.
          </li>
          <li>
            <strong>Device and Log Information.</strong> Like any website, Passport’s servers
            receive your IP address, your browser and device information, and request metadata, and
            record structured log entries about operations that succeed or fail. That is the
            personal information we retain on our side, for a limited operational period.
          </li>
          <li>
            <strong>Information You Submit.</strong> Anything you send us if you contact us, for
            example by email.
          </li>
        </ul>
        <h3>What Passport does not collect</h3>
        <ul>
          <li>
            <strong>Your identity secret key.</strong> It is generated or restored in your browser
            and is not sent to us.
          </li>
          <li>
            <strong>Your encrypted backup.</strong> The Passport File is written from your browser
            directly to your Google Drive or iCloud. We do not receive, hold, or store it, and we
            cannot read it.
          </li>
          <li>
            <strong>Your Google Drive or iCloud contents.</strong> Passport’s permissions are
            limited to its own application data and to files it creates. Passport does not read your
            other files.
          </li>
          <li>
            <strong>Passwords, recovery phrases, or payment credentials.</strong> Passport does not
            ask for them.
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="HOW YOUR IDENTITY AND BACKUP ARE STORED">
        <SectionIntroduction>
          This section is specific to Passport, because most of your data never reaches us.
        </SectionIntroduction>
        <p>
          <strong>On your device.</strong> Passport stores, in your browser’s local storage, a
          catalogue of the identities you hold: for each one, the Pubky public key, the Google or
          Apple account information above, and the secret key itself. This stays on the device and
          in the browser profile you used. Clearing that storage removes it.
        </p>
        <p>
          <strong>In your Google Drive or iCloud.</strong> Passport writes an encrypted copy of your
          identity secret key to a private application-data area of your Google Drive or iCloud,
          depending on how you sign in, and may also write encrypted copies to a visible folder
          named “Pubky Passport” so that you can see and keep them. These files are yours, in your
          Google or Apple account. You can delete them at any time.
        </p>
        <p>
          <strong>On our server.</strong> We do not store your email address or other Google or
          Apple profile fields. We hold one or more secrets used to derive the key that decrypts a
          Passport File. Deriving it requires a Google or Apple identity assertion that Google or
          Apple confirms as belonging to the same account. The file itself never passes through us,
          so the derived key alone does not give us access to your identity. Each Passport File
          records the public identifier of the secret used, never the secret itself. We retain
          server logs as described above.
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
            permission to use your Google Account and Google Drive, or your Apple Account and
            iCloud.
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
        <ul>
          <li>
            <strong>Directly from you.</strong> When you use Passport, grant Google or Apple
            permissions, or contact us.
          </li>
          <li>
            <strong>Passively.</strong> When your browser connects to Passport, through request
            metadata and server logs.
          </li>
          <li>
            <strong>From Google or Apple.</strong> Your Google or Apple account information is
            received in your browser. Google’s or Apple’s confirmation that an identity assertion is
            valid is received by our wrapping-key endpoint for that request.
          </li>
          <li>
            <strong>From a verification service we operate.</strong> Where Passport helps you create
            an account on a Homeserver, that service confirms a Google or Apple identity assertion
            and issues a signup invitation. It applies rate limits, which means it keeps counters
            associated with that verification.
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="HOW WE USE YOUR INFORMATION">
        <p>Examples of how we may use your information include:</p>
        <ul>
          <li>
            to run Passport, including verifying a Google or Apple identity assertion and deriving
            the key that decrypts your Passport File;
          </li>
          <li>
            in your browser, to show you which Google or Apple account an identity is associated
            with;
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
          <li>
            <strong>With any successors to all or part of our business.</strong>
          </li>
          <li>
            <strong>As requested or directed by you.</strong>
          </li>
        </ul>
        <p>
          We do not share your information with the applications that ask you for authorization.
          When you approve a request, the application receives the access you approved on your
          Homeserver, not the information described in this Policy.
        </p>
      </LegalSection>
      <LegalSection title="RETENTION">
        <p>
          We do not retain Google or Apple account information (email, name, picture, account
          identifier), your Pubky public key, or your identity secret key on our servers. Those live
          in your browser until you clear it, and the encrypted backup lives in your Google Drive or
          iCloud until you delete it.
        </p>
        <p>
          We do not retain Google or Apple identity assertions or authorization tokens after the
          request that uses them.
        </p>
        <p>
          Server logs are retained for a limited operational period, based on security and
          abuse-prevention needs, legal and regulatory requirements, and dispute resolution
          obligations, and then deleted.
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
            <strong>Withdraw Google or Apple permissions</strong> at any time in your Google or
            Apple account settings. Passport can then no longer read or write your Passport File.
          </li>
          <li>
            <strong>Delete your Passport File and any visible copies</strong> from your Google Drive
            or iCloud. Recovery through that account will no longer be possible with those files.
          </li>
          <li>
            <strong>Clear Passport’s browser storage</strong> to remove the identities held on that
            device. Do this only if you have a usable backup.
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
          address of your Google or Apple account, or your Pubky public key, and indicate that you
          are making a “Privacy Rights” request. If we deny your request and you would like to
          appeal, you may contact us again at the same address.
        </p>
        <p>
          Because your Google or Apple identifiers, identity secret key, and Passport File are held
          by you, on your device and in your Google or Apple account, a request to us cannot delete
          them. We will tell you where the data sits and how to remove it. We can act only on what
          we actually hold, which is server logs and any message you send us.
        </p>
      </LegalSection>
      <LegalSection title="SECURITY">
        <p>
          The Internet is not 100% secure and we cannot promise that your use of Passport will be
          completely safe. Passport encrypts your identity secret key in your browser before it is
          written to your Google Drive or iCloud, restricts its Google and Apple permissions to its
          own files, refuses to be embedded in another site, and avoids recording credentials or
          signup tokens in logs. Protecting your Google or Apple account, your device, and your
          browser remains your responsibility.
        </p>
      </LegalSection>
      <LegalSection title="STORAGE AND TRANSFER OF INFORMATION">
        <p>
          Information we maintain may be stored or hosted in any jurisdiction, including the United
          States, which may not provide the same level of protection as your own country. Where
          personal data is transferred outside the European Economic Area, such transfers are
          carried out on the basis of appropriate safeguards under Articles 44 to 49 GDPR, including
          Standard Contractual Clauses via third-party service providers.
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
      <LegalSection title="CHANGES IN POLICY">
        <p>
          From time to time, we may change this Policy. We will notify you of any material changes
          as required by law, and we will post an updated copy. Please check periodically for
          updates.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
