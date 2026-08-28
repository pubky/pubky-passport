# Integration

Open Passport from a user action:

```text
https://passport.pubky.app/authorize#d=<encoded-pubkyauth-url>
```

`d` accepts Pubky cookie or grant authorization URLs and must be encoded once. Keep
the originating tab waiting for the relay result; it is the authentication result.

Passport reports UI completion to the validated callback origin with
`pubky-passport.authorization-outcome`. Verify the Passport origin and popup window,
then acknowledge its `messageId` with
`pubky-passport.authorization-outcome-ack`, version `1`. Without an acknowledgement,
Passport uses the validated HTTPS callback.

Never log or persist the URL: it contains a secret. Do not embed Passport in an
iframe.
