import { createConfiguredGoogleWrappingKeyRequest } from "../../../../server/wrapping-key/google/composition/createConfiguredGoogleWrappingKeyRequest";

import { createGoogleWrappingKeyPostHandler } from "./handler";

export const POST = createGoogleWrappingKeyPostHandler(createConfiguredGoogleWrappingKeyRequest);
