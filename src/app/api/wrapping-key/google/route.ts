import { createConfiguredGoogleWrappingKeyRequest } from "../../../../server/wrapping-key/google/googleWrappingKeyRequest";

import { createGoogleWrappingKeyPostHandler } from "./handler";

export const POST = createGoogleWrappingKeyPostHandler(createConfiguredGoogleWrappingKeyRequest);
