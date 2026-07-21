# Shared UI Components

This folder is for small presentational components reused by multiple Passport
features, such as buttons, status panels, or layout primitives. Components here do
not start flows, import server code, parse authorization requests, or handle key
material.

Prefer feature-local components until a second real caller demonstrates that a
shared abstraction improves consistency rather than hiding product-specific state.
