import { createConfiguredGoogleWrappingKeyRequest } from "../../../../server/wrapping-key/google/GoogleWrappingKeyRequest";

import { createGoogleWrappingKeyPostHandler } from "./handler";

export const POST = createGoogleWrappingKeyPostHandler(createConfiguredGoogleWrappingKeyRequest);
