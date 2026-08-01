# Kitsos-cdn
All the Kitsos CDN files are uploaded here, so they can be distributed to the Edge locations.

## OpenAPI URLs

Each API publishes two forms of its OpenAPI document:

- `https://cdn.kitsos.net/api/<service>/openapi.yaml` always serves the latest
  document with `Cache-Control: no-store` and is safe to hardcode when callers
  must follow new documentation releases automatically.
- `https://cdn.kitsos.net/api/<service>/openapi-<version>.yaml` is immutable and
  should be used when a consumer needs a reproducible, pinned document.

The available service names are `keys`, `keys-admin`, `mail`, `verify`, `hme`,
and `utility`.
