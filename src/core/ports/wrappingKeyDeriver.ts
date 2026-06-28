export interface WrappingKeyDeriver {
  deriveWrappingKey(input: { issuer: string; subject: string }): Promise<{ wrappingKey: string }>;
}
