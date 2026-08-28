# Operations

| Variable                                | Value                                                  |
| --------------------------------------- | ------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`                      | Google OAuth web client ID                             |
| `HOMEGATE_URL`                          | HTTPS Homegate base URL                                |
| `PUBKY_HOMESERVER_CONNECT_ORIGINS`      | Comma-separated HTTPS origins allowed by CSP           |
| `PASSPORT_SERVER_SECRET_CURRENT_KEY_ID` | Key ID used for new recovery envelopes                 |
| `PASSPORT_SERVER_SECRET_KEYRING_JSON`   | JSON map of IDs to base64 secrets of at least 32 bytes |

To rotate the server secret, deploy the new key alongside existing keys and make its
ID current. Retain an old key while recovery files bearing its ID must remain usable.
Files contain key IDs, never server secrets.

CI should run `pnpm check:critical`. Live-provider staging tests are deliberately
separate; see the `test:staging:pubky` script.
