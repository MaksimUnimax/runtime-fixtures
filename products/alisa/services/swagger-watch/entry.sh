#!/bin/sh
set -eu
case "${1-}" in
  run|import|accept-reviewed)
    exec /usr/bin/flock --nonblock --conflict-exit-code 75 /var/lib/alisa-swagger-watch/.run.lock /usr/bin/env ALISA_SWAGGER_MUTATION_LOCKED=1 /usr/local/bin/node /opt/alisa-swagger-watch/current/cli.mjs "$@"
    ;;
  status|serve)
    exec /usr/local/bin/node /opt/alisa-swagger-watch/current/cli.mjs "$@"
    ;;
  *) exit 64 ;;
esac
