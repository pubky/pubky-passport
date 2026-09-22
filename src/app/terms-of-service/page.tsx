import type { Metadata } from "next";

import { LegalPage, LegalSection, SectionIntroduction } from "@/client/ui/shared/legal/legalPage";

export const metadata: Metadata = {
  title: "Terms of Service | Pubky Passport",
  description: "Terms and conditions for using Pubky Passport.",
};

export default function TermsOfServicePage() {
  return (
    <LegalPage eyebrow="Pubky Passport" title="Terms of Service">
      <p>
        <strong>PUBKY PASSPORT TERMS AND CONDITIONS</strong>
        <br />
        Effective Date: September 21, 2026
      </p>
      <p>
        Thank you for using Pubky Passport, the web application at passport.pubky.app that lets you
        create and recover a Pubky identity and approve authorization requests from other
        applications (the “Passport”). The terms and conditions set forth below (as updated and
        amended from time to time, and collectively with the Privacy Policy and any other materials
        explicitly incorporated by us, these “Terms”) govern your access to and use of Passport.
      </p>
      <p>
        <strong>
          PLEASE REVIEW THE ARBITRATION PROVISION SET FORTH BELOW CAREFULLY, AS IT WILL REQUIRE ALL
          PERSONS TO RESOLVE DISPUTES ON AN INDIVIDUAL BASIS THROUGH FINAL AND BINDING ARBITRATION
          AND TO WAIVE ANY RIGHT TO PROCEED AS A REPRESENTATIVE OR CLASS MEMBER IN ANY CLASS OR
          REPRESENTATIVE PROCEEDING. BY USING PASSPORT, YOU EXPRESSLY ACKNOWLEDGE THAT YOU HAVE READ
          AND UNDERSTAND ALL OF THE TERMS OF THIS PROVISION AND HAVE TAKEN TIME TO CONSIDER THE
          CONSEQUENCES OF THIS IMPORTANT DECISION.
        </strong>
      </p>
      <p>
        <strong>
          THESE TERMS FORM A LEGALLY BINDING AGREEMENT BETWEEN YOU AND SYNONYM (AS DEFINED BELOW).
          BY ACCESSING OR USING PASSPORT, YOU CONFIRM THAT YOU ACCEPT THESE TERMS AND AGREE TO
          COMPLY WITH THEM. IF YOU DO NOT AGREE TO BE BOUND BY THESE TERMS OR OTHER REFERENCED
          DOCUMENTATION, YOU MUST CEASE TO ACCESS OR USE PASSPORT.
        </strong>
      </p>

      <LegalSection title="INTRODUCTION">
        <p>
          In order to assist your understanding of these Terms, we have included, in italicised
          text, an introductory paragraph to each section. These introductions should not be viewed
          as a substitute for reading the full text and are qualified by the text in full. If you
          have any doubt over the meaning of these Terms, please contact us at{" "}
          <a href="mailto:info@synonym.to">info@synonym.to</a> before you use Passport.
        </p>
        <SectionIntroduction>This section introduces Synonym and these Terms.</SectionIntroduction>
        <p>
          These Terms constitute the entire agreement and understanding with respect to the access
          or use of Passport, between you (referred to as “you”, “your”, or “User”) and Synonym
          Software Ltd., a company operating under the laws of the Republic of El Salvador, located
          at 87 Avenida Norte, Calle El Mirador, Edificio Torre Futura, Oficina 06, Nivel 11,
          Colonia Escalón, Del Municipio de San Salvador, Departamento de San Salvador, Código
          Postal 01101, República de El Salvador (referred to as “Synonym”, “we”, “us”, or “our”)
          (each of you and Synonym being a “Party”, and collectively the “Parties”).
        </p>
        <p>
          Passport is a separate product from Pubky App, Pubky Ring, and Pubky Shop. Those products
          have their own terms. Using Passport does not subject you to them, and using them does not
          subject you to these Terms.
        </p>
      </LegalSection>

      <LegalSection title="ACCEPTANCE OF THESE TERMS THROUGH USE">
        <SectionIntroduction>
          This section explains your acceptance of these Terms and our ability to update them.
        </SectionIntroduction>
        <p>
          These Terms may be amended, changed, or updated by Synonym at any time and without prior
          notice to you. You should check back often to confirm that your copy and understanding of
          these Terms is current and correct. Your continued access or use of Passport after the
          effective date of any amendment constitutes your acceptance of these Terms as modified.
          Your only recourse in the case of your unwillingness to continue to be bound by these
          Terms is to stop using Passport.
        </p>
        <p>
          Access or use of Passport is void where such access or use is prohibited by, would
          constitute a violation of, or would be subject to penalties under applicable Laws.
        </p>
      </LegalSection>

      <LegalSection title="WHAT PASSPORT IS, AND WHAT IT IS NOT">
        <SectionIntroduction>
          This section describes the service. Read it before you rely on Passport for anything that
          matters to you.
        </SectionIntroduction>
        <p>Passport runs in your browser. It allows you to:</p>
        <ul>
          <li>
            create a Pubky identity, and where applicable request the creation of an account on a
            Homeserver;
          </li>
          <li>
            keep an encrypted backup of that identity (the “Passport File”) in your own Google
            Drive; and
          </li>
          <li>
            review and approve or decline authorization requests sent to Passport by other
            applications.
          </li>
        </ul>
        <p>
          Passport is a signer and a recovery tool. Passport is not a wallet, an exchange, a
          custodian, a payment service, a bank, or a social application. Synonym does not hold your
          funds and does not charge you a fee for Passport under these Terms. Synonym is not the
          operator of the applications that ask you for authorization and is not a party to your
          relationship with them.
        </p>
      </LegalSection>

      <LegalSection title="REQUIREMENTS TO USE PASSPORT">
        <SectionIntroduction>
          This section explains who may use Passport and what you need.
        </SectionIntroduction>
        <p>You acknowledge and agree that in order to use Passport:</p>
        <ul>
          <li>
            you must be at least eighteen (18) years old, or have the permission of a parent or
            legal guardian who accepts these Terms with you and is responsible for your activity;
          </li>
          <li>
            we must not have previously disabled your access for violation of Law or of any of our
            policies referenced in these Terms;
          </li>
          <li>
            you must use a supported web browser, and you must allow Passport to open as a separate
            window rather than embedded in another site; and
          </li>
          <li>
            you must have a Google Account, because Passport uses Google sign-in and Google Drive as
            described below.
          </li>
        </ul>
        <p>
          If you are using Passport on behalf of a company or organization, you represent that you
          have authority to act on its behalf and that it accepts these Terms.
        </p>
        <p>
          Users who meet the conditions above and who do not use Passport for any Prohibited Use are
          “Eligible Users”. Access or use of Passport by any Person other than an Eligible User is
          void.
        </p>
      </LegalSection>

      <LegalSection title="YOUR GOOGLE ACCOUNT">
        <SectionIntroduction>
          This section explains the role of Google, which is not us.
        </SectionIntroduction>
        <p>
          Passport signs you in with Google and asks for your permission to use your Google Account
          for two purposes: to identify the Google Account associated with an identity, and to store
          and read the Passport File in your Google Drive. Google is a third party. Your use of your
          Google Account is governed by Google’s terms and privacy policy, not by these Terms.
        </p>
        <p>
          You may withdraw Google’s permissions at any time from your Google Account settings. If
          you do, Passport can no longer read or write the Passport File, and recovery through
          Google will not work until you grant permission again. Loss of access to your Google
          Account, deletion of your Google Account, or deletion of the Passport File by you or by
          Google may make recovery impossible.
        </p>
      </LegalSection>

      <LegalSection title="YOUR KEYS AND THE PASSPORT FILE">
        <SectionIntroduction>
          This section is the most important one. It explains that your identity is yours, including
          the risk.
        </SectionIntroduction>
        <p>
          A Pubky identity is controlled by a cryptographic key. When you create or restore an
          identity in Passport, the secret key is held in your browser on your device. It is not
          sent to us.
        </p>
        <p>
          The Passport File is a copy of that secret key, encrypted in your browser before it leaves
          your device. Passport stores it in your Google Drive. Passport may also write additional
          encrypted copies to a visible folder in your Google Drive so that you can see and keep
          them yourself. We do not receive, hold, or store the Passport File, and we cannot read it.
        </p>
        <p>Decrypting a Passport File requires both:</p>
        <ul>
          <li>the encrypted file, which lives in your Google Drive; and</li>
          <li>
            a wrapping key, which Passport’s server derives only after Google has verified an
            identity assertion for the same Google Account, using a secret we hold.
          </li>
        </ul>
        <p>You acknowledge and agree that:</p>
        <ul>
          <li>
            we cannot recover your identity for you. We do not hold your secret key and we cannot
            reconstruct it from the wrapping key alone;
          </li>
          <li>
            if you clear your browser storage, lose your device, or lose your Google Account, and no
            usable Passport File remains, your identity and anything that depends on it may be
            permanently lost;
          </li>
          <li>
            anyone who obtains both your Google Account access and the encrypted file may be able to
            restore your identity, so you must protect your Google Account accordingly;
          </li>
          <li>you should keep your own copy of any recovery material Passport offers you; and</li>
          <li>
            you must not enter a recovery phrase or secret key belonging to another product into a
            site that is not the genuine Passport origin.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="OUR SERVER SECRET AND KEY ROTATION">
        <SectionIntroduction>
          This section explains the one cryptographic input we hold, and its limits.
        </SectionIntroduction>
        <p>
          Passport’s server holds one or more secrets used to derive wrapping keys. Each Passport
          File records the public identifier of the secret used, never the secret itself. We may
          rotate secrets and retain earlier secrets for as long as Passport Files that reference
          them must remain usable.
        </p>
        <p>
          We do not promise to retain any secret indefinitely. If a secret required by an old
          Passport File is no longer available, that file can no longer be decrypted through
          Passport. Loss, compromise, or discontinuation of the service may therefore affect your
          ability to recover an identity, and you accept that risk. Nothing in this section makes
          Synonym a custodian of your identity.
        </p>
      </LegalSection>

      <LegalSection title="AUTHORIZING APPLICATIONS">
        <SectionIntroduction>
          This section explains what happens when another application asks Passport to approve
          something.
        </SectionIntroduction>
        <p>
          Another application may send an authorization request to Passport. Passport shows you the
          requesting application’s stated name, the destination it gave, and the permissions
          requested, including whether those permissions are narrow or broad. You decide whether to
          approve or decline.
        </p>
        <p>You acknowledge and agree that:</p>
        <ul>
          <li>
            the requesting application’s stated name is not a verified identity, and we do not vet,
            endorse, or audit applications that integrate with Passport;
          </li>
          <li>
            approving a request grants that application the permissions shown, on your Homeserver,
            under your identity, and you are responsible for that decision;
          </li>
          <li>
            the approval is delivered to the requesting application through a relay; Passport’s
            on-screen result and any callback are user-interface signals and are not credentials,
            and must not be treated as proof that you are signed in;
          </li>
          <li>
            broad permissions, including permissions over your whole storage, can allow an
            application to read, change, or delete your data; and
          </li>
          <li>
            withdrawing access is done where the permission lives, on your Homeserver or in the
            application, not by closing the Passport window.
          </li>
        </ul>
        <p>
          We may refuse to display or to process a request that is malformed, that does not meet
          Passport’s security requirements, or that we believe is being used to harm users.
        </p>
      </LegalSection>

      <LegalSection title="ACCOUNT CREATION ON A HOMESERVER">
        <SectionIntroduction>
          This section explains onboarding, which involves services other than Passport.
        </SectionIntroduction>
        <p>
          Where Passport helps you create an account on a Homeserver, it asks a Synonym-operated
          verification service to confirm your Google identity assertion and, if that succeeds, to
          issue a signup invitation for a Homeserver. Passport then uses that invitation to create
          the account.
        </p>
        <p>
          Verification exists to limit abuse and automated account creation. It is rate limited, it
          may be unavailable in some regions, and it may refuse a request. The Homeserver that holds
          your account may be operated by Synonym or by a third party, and your use of it is
          governed by that operator’s terms. Passport does not store your Homeserver content and is
          not your Homeserver.
        </p>
      </LegalSection>

      <LegalSection title="ACCEPTABLE USE AND PROHIBITED USES">
        <SectionIntroduction>
          This section explains what you must not do with Passport.
        </SectionIntroduction>
        <p>You agree not to:</p>
        <ul>
          <li>
            use Passport to obtain or approve access to an identity, account, or data that is not
            yours, or to assist anyone in doing so;
          </li>
          <li>
            impersonate Passport, Synonym, or another application, including by hosting a look-alike
            sign-in page or by presenting a misleading application name in an authorization request;
          </li>
          <li>
            use any automated system to access Passport in a manner that sends more requests than a
            human can reasonably produce with a conventional browser, or to create identities or
            accounts in bulk;
          </li>
          <li>
            circumvent, or attempt to circumvent, verification, rate limits, regional restrictions,
            or any security or integrity measure of Passport or of the services it calls;
          </li>
          <li>
            probe, scan, or test the vulnerability of Passport or its infrastructure other than in
            accordance with a security policy we publish, or breach any security or authentication
            measure;
          </li>
          <li>
            reverse engineer, decompile, or interfere with Passport except to the extent that
            applicable Law expressly permits it despite this restriction; or
          </li>
          <li>
            use Passport in breach of applicable Laws, including sanctions, anti-money laundering,
            export control, privacy, and anti-terrorism Laws.
          </li>
        </ul>
        <p>
          Any use as described in this section is a “Prohibited Use”. If Synonym determines or
          suspects that you have engaged in any Prohibited Use, Synonym may address it in its sole
          and absolute discretion, including by restricting your access to Passport and by reporting
          the matter to a government, law enforcement, or other authority.
        </p>
        <p>
          Passport is not a publishing platform and does not host user content. Content you publish
          through another application after authorizing it is governed by that application’s terms.
        </p>
      </LegalSection>

      <LegalSection title="REPORTING A PROBLEM">
        <SectionIntroduction>This section explains how to reach us.</SectionIntroduction>
        <p>
          To report abuse, impersonation of Passport, or a violation of these Terms, email{" "}
          <a href="mailto:report@synonym.to">report@synonym.to</a> and use the word “Complaint” in
          the subject line. To report a security vulnerability, follow the security policy published
          for the Pubky projects. If, in our determination, your report is valid, we will take
          appropriate action in our sole discretion.
        </p>
      </LegalSection>

      <LegalSection title="REGIONAL AVAILABILITY">
        <SectionIntroduction>This section explains geographic restrictions.</SectionIntroduction>
        <p>
          Certain features, including verification methods used during account creation, may not be
          available in all jurisdictions due to legal, regulatory, or operational requirements. We
          reserve the right to restrict access to specific features based on your location. Passport
          is not available to users in Prohibited Jurisdictions.
        </p>
      </LegalSection>

      <LegalSection title="PRIVACY POLICY">
        <p>
          The Pubky Passport <a href="/privacy-policy">Privacy Policy</a> explains how we treat
          personal information in connection with Passport, including what we receive from Google
          and what stays on your device and in your Google Drive. It forms part of these Terms.
        </p>
      </LegalSection>

      <LegalSection title="AVAILABILITY AND NO REPRESENTATION BY SYNONYM">
        <SectionIntroduction>
          This section explains that Passport is provided as is.
        </SectionIntroduction>
        <p>
          Synonym makes no representations, warranties, covenants or guarantees to you of any kind
          and, to the extent permitted by applicable Laws, expressly disclaims all representations,
          warranties, covenants or guarantees, express, implied or statutory, with respect to
          Passport. Passport is offered strictly on an as-is, where-is basis.
        </p>
        <p>
          Without limiting the foregoing, we do not warrant that Passport will be available,
          uninterrupted, compatible with your browser or device, or free from bugs, viruses or other
          harmful components, and we do not warrant that any identity, account, Passport File,
          authorization, or recovery attempt will succeed. You are responsible for configuring your
          own device and for using your own antivirus and anti-malware protection.
        </p>
        <p>
          We may change, suspend, or discontinue Passport or any part of it, including a deployment,
          an endpoint, or support for a Google permission, at any time.
        </p>
      </LegalSection>

      <LegalSection title="THIRD-PARTY MATERIALS">
        <SectionIntroduction>
          This section explains that other people’s services are not ours.
        </SectionIntroduction>
        <p>
          Passport interoperates with Third-Party Materials, including Google sign-in and Google
          Drive, Homeservers and their operators, public key resolution relays, authorization
          relays, and the applications that ask you for authorization. Synonym is not responsible
          for the content, availability, privacy settings, policies, or procedures of Third-Party
          Materials, and their products and services are the sole responsibility of the third party.
          If you decide to access any Third-Party Materials, you do so entirely at your own risk,
          and you are advised to read their terms and privacy policies first.
        </p>
      </LegalSection>

      <LegalSection title="INTELLECTUAL PROPERTY">
        <SectionIntroduction>
          This section explains what you may do with the application itself.
        </SectionIntroduction>
        <p>
          Subject to these Terms, we grant you a limited, revocable, non-exclusive, non-transferable
          licence to use Passport for its intended purpose. We and our licensors retain all right,
          title and interest in Passport, including its software, trade marks, and brand features.
          Where Passport source code is made available under an open-source licence, that licence
          governs your use of that code and nothing in these Terms limits the rights it grants you.
        </p>
      </LegalSection>

      <LegalSection title="TERMINATION">
        <SectionIntroduction>This section explains how each side can stop.</SectionIntroduction>
        <p>
          You may stop using Passport at any time. To remove your data, you can remove the
          identities held in your browser, clear Passport’s browser storage, delete the Passport
          File and any visible copies from your Google Drive, and withdraw Passport’s permissions in
          your Google Account.
        </p>
        <p>
          We may restrict or terminate your access to Passport at any time, including for a
          Prohibited Use, for a legal or regulatory reason, or because we discontinue the service,
          without liability for that termination. Termination does not delete your identity, your
          Homeserver account, or files held in your Google Drive, and it does not by itself make
          your identity unrecoverable.
        </p>
      </LegalSection>

      <LegalSection title="RESPONSIBILITIES, LIMITATION OF LIABILITY AND INDEMNITY">
        <SectionIntroduction>
          This section limits our liability and asks you to cover losses you cause.
        </SectionIntroduction>
        <p>
          To the maximum extent permitted by applicable Law, neither Synonym nor any of its
          Associates assumes any liability or responsibility for any Losses directly or indirectly
          arising out of or related to Passport, including any loss of an identity, a key, a
          Passport File, access to a Google Account, or access to a Homeserver account.
        </p>
        <p>
          You hereby agree to release Synonym and its Associates from liability for any and all such
          Losses, and you shall indemnify and hold Synonym and its Associates harmless from and
          against all such Losses incurred by them as a result of your use of Passport in breach of
          these Terms or in violation of applicable Laws.
        </p>
        <p>
          To the fullest extent permissible by Law, the maximum aggregate monetary liability of
          Synonym under these Terms shall in no event exceed the fees paid by you to Synonym (if
          any) in respect of Passport in relation to which the liability has arisen.
        </p>
      </LegalSection>

      <LegalSection title="FORCE MAJEURE">
        <SectionIntroduction>This section covers events outside our control.</SectionIntroduction>
        <p>
          Synonym is not responsible for Losses caused by delay or failure of Synonym or of Passport
          where the delay or failure is due to an event outside our reasonable control, including
          outages or changes at Google, at a Homeserver operator, or at a relay, network or protocol
          failures, public health events, government acts, and acts of God.
        </p>
      </LegalSection>

      <LegalSection title="MANDATORY RESOLUTION OF DISPUTES THROUGH ARBITRATION">
        <SectionIntroduction>
          This section requires that most disputes be resolved individually through binding
          arbitration.
        </SectionIntroduction>
        <h3>Covered Claims</h3>
        <p>
          Except for excluded claims described in the paragraph below, Synonym and you each agree
          that any dispute, claim or controversy arising out of or relating to (i) these Terms or
          the existence, breach, termination, enforcement, interpretation or validity thereof or
          (ii) your use of Passport at any time, will be subject to and finally resolved by
          confidential, binding arbitration on an individual basis and not in a class,
          representative or consolidated action or proceeding. If you are a person subject to the
          jurisdiction of the United States of America, the interpretation and enforceability of
          this arbitration provision will be governed by the Federal Arbitration Act, 9 U.S.C. §§ 1
          et seq. Arbitration will be conducted through the use of videoconferencing technology
          (unless both parties agree that an in-person hearing is appropriate given the nature of
          the dispute) before a single arbitrator in accordance with the LCIA Rules. The sole
          arbitrator must be a legal practitioner in London, England with at least fifteen (15)
          years of experience in commercial disputes, that holds a current practising certificate.
          If an arbitrator cannot be jointly appointed by the arbitration parties within thirty (30)
          days of the commencement of the arbitration, an arbitrator meeting the above
          qualifications will be selected under the Arbitration Rules of the London Court of
          International Arbitration (LCIA). Judgement upon the award rendered by the arbitrator may
          be entered by any court having jurisdiction thereof. If the arbitral parties do not
          promptly agree on the seat of arbitration if an in-person hearing is selected, the seat
          will be London, England. The language of the arbitral proceedings will be English. No
          discovery shall be conducted except by agreement of the parties or after approval by the
          arbitrator, who shall attempt to minimize the burden of discovery. The arbitrator may
          award any relief that a court of competent jurisdiction could award, including attorneys’
          fees when authorized by laws, and the arbitral decision may be enforced in court. For
          claims less than U.S.$15,000, Synonym will reimburse you for all initiating filing fees in
          the event that the claim is successful. The prevailing party, as determined by the
          arbitrator, will be entitled to its costs of the arbitration (including the arbitrator’s
          fees) and its reasonable attorney’s fees and costs.
        </p>
        <h3>Excluded Claims</h3>
        <p>
          The following claims and causes of action will be excluded from arbitration as described
          in the paragraph above: causes of action or claims in which either Party seeks injunctive
          or other equitable relief for the alleged unlawful use of its intellectual property or its
          confidential information or private data. The Parties shall be at liberty to pursue claims
          or causes of actions excluded from arbitration through any court of competent
          jurisdiction.
        </p>
        <h3>Delegation</h3>
        <p>
          The arbitrator will have the power to hear and determine challenges to its jurisdiction,
          including any objections with respect to the formation, existence, scope, enforceability
          or validity of the arbitration agreement. This authority extends to jurisdictional
          challenges with respect to both the subject matter of the dispute and the parties to the
          arbitration. Further, the arbitrator will have the power to determine the existence,
          validity, or scope of the contract of which an arbitration clause forms a part. For the
          purposes of challenges to the jurisdiction of the arbitrator, each clause in this section
          will be considered as separable from any contract of which it forms a part. Any challenges
          to the jurisdiction of the arbitrator, except challenges based on the award itself, will
          be made not later than the notice of defense or, with respect to a counterclaim, the reply
          to the counterclaim; provided, however, that if a claim or counterclaim is later added or
          amended such a challenge may be made not later than the response to such claim or
          counterclaim as provided under LCIA Rules.
        </p>
        <h3>Class Action Waiver</h3>
        <p>
          You and Synonym expressly intend and agree that: (i) class action and representative
          action procedures are hereby waived and will not be asserted, nor will they apply, in any
          arbitration pursuant to these Terms; (ii) neither you nor Synonym will assert class action
          or representative action claims against the other in arbitration or otherwise; (iii) each
          of you and Synonym will only submit their own, individual claims in arbitration and will
          not seek to represent the interests of any other person, or consolidate claims with any
          other person; (iv) nothing in these Terms will be interpreted as your or Synonym’s intent
          to arbitrate claims on a class or representative basis; and (v) any relief awarded to any
          one User cannot and may not affect any other User. No adjudicator may consolidate or join
          more than one Person’s or Party’s claims and may not otherwise preside over any form of a
          consolidated, representative, or class proceeding.
        </p>
        <h3>Confidentiality</h3>
        <p>
          You and Synonym and any other arbitration parties will maintain the confidential nature of
          the arbitration proceeding and any award, including the hearing, except as may be
          necessary to prepare for or conduct the arbitration hearing on the merits, or except as
          may be necessary in connection with a court application for a preliminary remedy, a
          judicial challenge to an award or its enforcement, or unless otherwise required by Law or
          judicial decision.
        </p>
      </LegalSection>

      <LegalSection title="JURY TRIAL WAIVER">
        <p>
          <strong>
            TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE PARTIES HEREBY IRREVOCABLY AND
            UNCONDITIONALLY WAIVE ALL RIGHT TO TRIAL BY JURY IN ANY LEGAL ACTION OR PROCEEDING OF
            ANY KIND WHATSOEVER ARISING OUT OF OR RELATING TO THESE TERMS OR ANY BREACH THEREOF, ANY
            USE OR ATTEMPTED USE OF PASSPORT BY YOU, AND/OR ANY OTHER MATTER INVOLVING THE USER AND
            SYNONYM.
          </strong>
        </p>
      </LegalSection>

      <LegalSection title="DEFINITIONS">
        <p>
          In these Terms, the following words have the following meanings, unless otherwise
          indicated:
        </p>
        <ul>
          <li>
            <strong>“Associates”</strong> means Synonym, its subsidiaries and affiliates and their
            respective directors, officers, employees, agents and representatives;
          </li>
          <li>
            <strong>“Google Account”</strong> means the account you use to sign in to Google
            services and Google Drive;
          </li>
          <li>
            <strong>“Homeserver”</strong> means a server that stores data for a Pubky identity,
            whether operated by Synonym or by a third party;
          </li>
          <li>
            <strong>“Law”</strong> means all laws, statutes, orders, regulations, rules, treaties,
            and official obligations that apply;
          </li>
          <li>
            <strong>“LCIA Rules”</strong> means LCIA Arbitration Rules 2020;
          </li>
          <li>
            <strong>“Losses”</strong> means, collectively, any claim, application, loss, injury,
            delay, accident, cost, business interruption cost, or any other expense or damage of any
            nature;
          </li>
          <li>
            <strong>“Passport”</strong> means the web application known as Pubky Passport, provided
            by Synonym at passport.pubky.app, and the services we operate for it, including the
            wrapping-key endpoint;
          </li>
          <li>
            <strong>“Passport File”</strong> means the encrypted copy of an identity secret key that
            Passport writes to your Google Drive, including any visible copy;
          </li>
          <li>
            <strong>“Person”</strong> includes an individual, association, partnership, corporation,
            company, or other entity;
          </li>
          <li>
            <strong>“Privacy Policy”</strong> means the Pubky Passport{" "}
            <a href="/privacy-policy">Privacy Policy</a>;
          </li>
          <li>
            <strong>“Prohibited Jurisdiction”</strong> means any of: Cuba, Democratic People’s
            Republic of Korea (North Korea), Iran, Syria, Crimea (a region of Ukraine annexed by the
            Russian Federation), the self-proclaimed Donetsk People’s Republic (a region of Ukraine)
            and the self-proclaimed Luhansk People’s Republic (a region of Ukraine);
          </li>
          <li>
            <strong>“Prohibited Use”</strong> has the meaning given above;
          </li>
          <li>
            <strong>“Pubky identity”</strong> means a cryptographic key pair used to identify you on
            the Pubky protocol, and the public identifier derived from it;
          </li>
          <li>
            <strong>“Third-Party Material(s)”</strong> means sites, software applications, content,
            services, and infrastructure that Synonym does not operate;
          </li>
          <li>
            <strong>“Users”</strong> means all users and others who access Passport.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="MISCELLANEOUS">
        <SectionIntroduction>
          This section covers governing law and the usual final provisions.
        </SectionIntroduction>
        <h3>Governing law</h3>
        <p>
          These Terms shall be governed by and construed and enforced in accordance with the Laws of
          England and Wales and shall be interpreted in all respects as an English law contract.
        </p>
        <h3>No Waiver; Available Remedies</h3>
        <p>
          Any failure by Synonym to exercise any of its rights, powers, or remedies under these
          Terms, or any delay by Synonym in doing so, does not constitute a waiver of any such
          right, power, or remedy. The single or partial exercise of any right, power, or remedy by
          Synonym does not prevent either from exercising any other rights, powers, or remedies. The
          remedies of Synonym are cumulative with and not exclusive of any other remedy conferred by
          the provisions of these Terms, or by law or equity. You agree that the remedies to which
          Synonym is entitled include (i) injunctions to prevent breaches of these Terms and to
          enforce specifically the terms and provisions hereof, and you waive the requirement of any
          posting of a bond in connection with such remedies, (ii) the right to recover the amount
          of any Losses by set off against any amounts that Synonym would otherwise be obligated to
          pay to you, and (iii) the right to seize and recover against any of your assets, or your
          interests therein, that are held by Synonym or any of its Associates.
        </p>
        <h3>Assignment and Third-Party Rights</h3>
        <p>
          These Terms, and any of the rights, duties, and obligations contained or incorporated
          herein, are not assignable by you without prior written consent of Synonym and any attempt
          by you to assign these Terms without Synonym’s written consent is void. These Terms, and
          any of the rights, duties, and obligations contained herein, are freely assignable by
          Synonym, in whole or in part, without notice or your consent (for clarity, this assignment
          right includes the right for Synonym to assign any claim, in whole or in part, arising
          hereunder). Subject to the foregoing, these Terms, and any of the rights, duties, and
          obligations contained or incorporated herein, shall be binding upon and inure to the
          benefit of the heirs, executors, administrators, personal or legal representatives,
          successors and assigns of you and of Synonym. None of the provisions of these Terms, or
          any of the rights, duties, and obligations contained or incorporated herein, are for the
          benefit of or enforceable by any creditors of you or Synonym or any other persons, except:
          (i) such as inure to a successor or assign in accordance herewith; and (ii) that the
          Associates of Synonym are intended third party beneficiaries of the rights and privileges
          expressly stated to apply to the Associates hereunder and shall be entitled to enforce
          such rights and privileges as if a direct party to these Terms. No consent of any Person
          is required for any modification or amendment to these Terms.
        </p>
        <h3>Severability</h3>
        <p>
          If any provision of these Terms or part thereof, as amended from time to time, is
          determined to be invalid, void, or unenforceable, in whole or in part, by any court of
          competent jurisdiction, such invalidity, voidness, or unenforceability attaches only to
          such provision to the extent of its illegality, unenforceability, invalidity, or voidness,
          as may be, and everything else in these Terms continues in full force and effect.
        </p>
        <h3>Electronic Communications and Acceptance</h3>
        <p>
          You agree and consent to receive electronically all communications, agreements, documents,
          receipts, notices and disclosures that Synonym may provide in connection with these Terms
          through publication on any part of Passport or to an email address on file that you have
          previously provided to Synonym. Such notices shall be deemed effective and received by you
          on the date on which the notice is published on any part of Passport or on which the email
          is sent to such email address. These Terms may be accepted electronically, and it is the
          intention of the Parties that such acceptance shall be deemed to be as valid as an
          original signature being applied to these Terms.
        </p>
        <h3>Termination and No Liability for Termination</h3>
        <p>
          We reserve the right, in our sole discretion, to suspend and/or terminate your access to
          Passport for any reason, including if we determine that you violated these Terms or
          applicable Law. In general, we will notify you at the latest from the date the action is
          taken and provide you with an opportunity to remedy the relevant breach or breaches.
          However, advanced notification and/or opportunity to remedy will not be provided if the
          seriousness of the breach requires immediate termination of your access to Passport, or
          when it is impossible to remedy the breach. You acknowledge and agree that we shall not be
          liable to you or any third party for any termination or suspension of your access to
          Passport.
        </p>
        <h3>Contact</h3>
        <p>
          <a href="mailto:info@synonym.to">info@synonym.to</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
