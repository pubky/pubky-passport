import { createConfiguredGoogleWrappingKeyIssuer } from "../../../../server/wrapping-key/google/GoogleWrappingKeyIssuer";

import { createGoogleWrappingKeyPostHandler } from "./handler";

export const POST = createGoogleWrappingKeyPostHandler(createConfiguredGoogleWrappingKeyIssuer);
