# Composition

Composition is the outermost application layer. It creates an executable feature
by joining core flow code with concrete adapters. Keep it small and stateless:
it selects implementations but does not implement Google, Drive, crypto, Pubky,
or business rules itself.
