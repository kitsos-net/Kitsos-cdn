# Kitsos-cdn
All the Kitsos CDN files are uploaded here, so they can be distributed to the Edge locations.

## OpenAPI URLs

Each API publishes three forms of its OpenAPI document:

- `https://cdn.kitsos.net/api/<service>/latest/openapi.yaml` is the preferred
  hardcodable latest URL. Its uncached redirect always resolves to the latest
  document.
- `https://cdn.kitsos.net/api/<service>/openapi.yaml` serves that latest
  document directly with `Cache-Control: no-store`.
- `https://cdn.kitsos.net/api/<service>/openapi-<version>.yaml` is immutable and
  should be used when a consumer needs a reproducible, pinned document.

The available service names are `keys`, `keys-admin`, `mail`, `verify`, `hme`,
and `utility`.
