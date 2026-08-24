# The one set of CORS headers every service answers with — the gateway's job
# here, as it is Kong's on a hosted project.
#
# Left to themselves the three disagree: PostgREST answers preflight, Storage
# sends no CORS headers at all, and Auth declines a preflight that asks for
# content-type. A browser could reach one of them and not the others. Hiding
# whatever the upstream sent and adding ours leaves exactly one of each header
# — two would be as broken as none.
#
# Included per location rather than set once at server level, because nginx
# only allows add_header inside an `if` in location context.
proxy_hide_header Access-Control-Allow-Origin;
proxy_hide_header Access-Control-Allow-Credentials;
add_header Access-Control-Allow-Origin $cors_origin always;
add_header Access-Control-Allow-Credentials true always;
add_header Access-Control-Expose-Headers "Content-Range, Content-Encoding, Content-Location, Range, Range-Unit, X-Total-Count, Link, X-Supabase-Api-Version" always;

# Preflight is answered here and never reaches the service. Headers set inside
# an `if` replace the ones above rather than adding to them, so the full set is
# repeated.
if ($request_method = OPTIONS) {
  add_header Access-Control-Allow-Origin $cors_origin always;
  add_header Access-Control-Allow-Credentials true always;
  add_header Access-Control-Allow-Methods "GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD" always;
  add_header Access-Control-Allow-Headers "authorization, apikey, content-type, accept, accept-language, x-client-info, x-upsert, x-supabase-api-version, prefer, range, cache-control" always;
  add_header Access-Control-Max-Age 86400 always;
  add_header Content-Length 0 always;
  return 204;
}
