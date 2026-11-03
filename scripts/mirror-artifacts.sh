#!/usr/bin/env bash
# Configuration is supplied by repository governance, never embedded here.
set -euo pipefail
if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${MCL_S3_ARTIFACTS_ENDPOINT:-}" ]]; then
  echo 'Artifact mirror is not configured; repository onboarding remains required.'
  exit 0
fi
aws --endpoint-url "$MCL_S3_ARTIFACTS_ENDPOINT" \
  --region "${MCL_S3_ARTIFACTS_REGION:-garage}" s3 cp --recursive \
  "${1:-.result/logs}/" \
  "s3://${MCL_S3_ARTIFACTS_BUCKET:?required artifact bucket}/oq/${GITHUB_RUN_ID:?required run id}/"
