#!/usr/bin/env sh
# Generate local secrets for docker compose. Safe to re-run: existing files are kept.
set -eu
mkdir -p secrets
[ -f secrets/pg_password ] || { openssl rand -base64 24 | tr -d '\n' > secrets/pg_password; echo "created secrets/pg_password"; }
[ -f secrets/jwt_private_key.pem ] || { openssl genpkey -algorithm ed25519 -out secrets/jwt_private_key.pem; echo "created secrets/jwt_private_key.pem"; }
[ -f secrets/auth_enc_key ] || { openssl rand -base64 32 | tr -d '\n' > secrets/auth_enc_key; echo "created secrets/auth_enc_key (back this up: it encrypts TOTP seeds and IdP secrets)"; }
[ -f secrets/api_key_pepper ] || { openssl rand -base64 32 | tr -d '\n' > secrets/api_key_pepper; echo "created secrets/api_key_pepper"; }
chmod 600 secrets/*
